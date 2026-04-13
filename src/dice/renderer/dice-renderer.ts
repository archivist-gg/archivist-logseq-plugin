/**
 * 3D Dice Renderer — forked from obsidian-dice-roller (MIT)
 *
 * Three.js scene with cannon-es physics, fullscreen overlay on host document.
 * Stripped of Obsidian Component/Events base; uses direct callbacks and cleanup arrays.
 */

import {
  Scene,
  PerspectiveCamera,
  WebGLRenderer as ThreeWebGLRenderer,
  SpotLight,
  AmbientLight,
  Mesh,
  PlaneGeometry,
  ShadowMaterial,
  PCFSoftShadowMap,
  Vector3,
  type Object3D,
} from "three";
import {
  World,
  Body,
  Vec3,
  Plane,
  ContactMaterial,
  Material as CannonMaterial,
  NaiveBroadphase,
} from "cannon-es";
import { ResourceTracker } from "./resource";
import {
  D4Dice,
  D6Dice,
  D8Dice,
  D10Dice,
  D12Dice,
  D20Dice,
  D100Dice,
  FudgeDice,
  StuntDice,
  type DiceShape,
} from "./shapes";
import DiceGeometry, {
  D4DiceGeometry,
  D6DiceGeometry,
  D8DiceGeometry,
  D10DiceGeometry,
  D100DiceGeometry,
  D12DiceGeometry,
  D20DiceGeometry,
  FudgeDiceGeometry,
  StuntDiceGeometry,
  type DiceOptions,
} from "./geometries";
import { RenderTypes, type RenderableDice } from "../renderable";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RendererData = {
  diceColor: string;
  textColor: string;
  colorfulDice: boolean;
  scaler: number;
  renderTime: number;
  textFont: string;
};

type FactoryColors = {
  diceColor: string;
  textColor: string;
  textFont: string;
} | undefined;

// ---------------------------------------------------------------------------
// LocalWorld — cannon-es physics container
// ---------------------------------------------------------------------------

class LocalWorld {
  world = new World({ gravity: new Vec3(0, 0, -9.82 * 200) });
  ground = this.getPlane();
  lastCallTime: number | undefined;

  diceMaterial = new CannonMaterial();
  deskMaterial = new CannonMaterial();
  barrierMaterial = new CannonMaterial();

  constructor(public WIDTH: number, public HEIGHT: number) {
    this.world.broadphase = new NaiveBroadphase();
    this.world.allowSleep = true;
    this.ground.position.set(0, 0, 0);
    this.world.addBody(this.ground);
    this.buildWalls();
  }

  add(...dice: DiceShape[]) {
    dice.forEach((die) => {
      this.world.addBody(die.body);
    });
  }

  remove(...dice: DiceShape[]) {
    dice.forEach((die) => this.world.removeBody(die.body));
  }

  step(step: number = 1 / 60) {
    const time = performance.now() / 1000;
    if (!this.lastCallTime) {
      this.world.step(step);
    } else {
      const dt = time - this.lastCallTime;
      this.world.step(step, dt);
    }
    this.lastCallTime = time;
  }

  buildWalls() {
    this.world.addContactMaterial(
      new ContactMaterial(this.deskMaterial, this.diceMaterial, {
        friction: 0.01,
        restitution: 0.5,
        contactEquationRelaxation: 3,
        contactEquationStiffness: 1e8,
      })
    );
    this.world.addContactMaterial(
      new ContactMaterial(this.barrierMaterial, this.diceMaterial, {
        friction: 0.01,
        restitution: 1,
        contactEquationRelaxation: 3,
        contactEquationStiffness: 1e8,
      })
    );
    this.world.addContactMaterial(
      new ContactMaterial(this.diceMaterial, this.diceMaterial, {
        friction: 0.1,
        restitution: 0.5,
        contactEquationRelaxation: 3,
        contactEquationStiffness: 1e8,
      })
    );
    this.world.addBody(
      new Body({
        allowSleep: false,
        mass: 0,
        shape: new Plane(),
        material: this.deskMaterial,
      })
    );

    let barrier = new Body({
      allowSleep: false,
      mass: 0,
      shape: new Plane(),
      material: this.barrierMaterial,
    });
    barrier.quaternion.setFromAxisAngle(new Vec3(1, 0, 0), Math.PI / 2);
    barrier.position.set(0, this.HEIGHT * 0.93, 0);
    this.world.addBody(barrier);

    barrier = new Body({
      allowSleep: false,
      mass: 0,
      shape: new Plane(),
      material: this.barrierMaterial,
    });
    barrier.quaternion.setFromAxisAngle(new Vec3(1, 0, 0), -Math.PI / 2);
    barrier.position.set(0, -this.HEIGHT * 0.93, 0);
    this.world.addBody(barrier);

    barrier = new Body({
      allowSleep: false,
      mass: 0,
      shape: new Plane(),
      material: this.barrierMaterial,
    });
    barrier.quaternion.setFromAxisAngle(new Vec3(0, 1, 0), -Math.PI / 2);
    barrier.position.set(this.WIDTH * 0.93, 0, 0);
    this.world.addBody(barrier);

    barrier = new Body({
      allowSleep: false,
      mass: 0,
      shape: new Plane(),
      material: this.barrierMaterial,
    });
    barrier.quaternion.setFromAxisAngle(new Vec3(0, 1, 0), Math.PI / 2);
    barrier.position.set(-this.WIDTH * 0.93, 0, 0);
    this.world.addBody(barrier);
  }

  getPlane() {
    return new Body({
      type: Body.STATIC,
      shape: new Plane(),
    });
  }
}

// ---------------------------------------------------------------------------
// DiceRendererClass
// ---------------------------------------------------------------------------

export class DiceRendererClass {
  hostDocument: Document | null = null;
  private container: HTMLDivElement | null = null;
  private loaded = false;
  private cleanupFns: (() => void)[] = [];

  renderTime = 3000;

  // Three / cannon state
  tracker = new ResourceTracker();       // persistent scene objects (lights, desk)
  rollTracker = new ResourceTracker();   // per-roll dice shapes (disposed between rolls)
  renderer!: ThreeWebGLRenderer;
  scene!: Scene;
  world!: LocalWorld;
  camera!: PerspectiveCamera;

  private current: Set<DiceShape[]> = new Set();
  ambientLight!: AmbientLight;
  light!: SpotLight;
  shadows = true;
  desk: any;
  iterations = 0;
  frame_rate = 1 / 60;
  private animating = false;
  animation = 0;

  // Dice factory state (inlined)
  private dice: Record<string, DiceGeometry> = {};
  private factoryWidth = 0;
  private factoryHeight = 0;
  private factoryOptions: Partial<DiceOptions> = {
    diceColor: "#202020",
    textColor: "#ffffff",
    textFont: "Arial",
  };
  private factoryScaler = 1;
  private factoryColorful = false;

  // Resolve callbacks for pending dice throws
  private finished: WeakMap<DiceShape[], () => void> = new WeakMap();

  static DEFAULT_EXTRA_FRAMES = 30;
  static Threshold = 5;
  extraFrames = DiceRendererClass.DEFAULT_EXTRA_FRAMES;

  data!: RendererData;

  // ---------------------------------------------------------------------------
  // Dimensions helpers
  // ---------------------------------------------------------------------------

  get WIDTH() {
    return this.container ? this.container.clientWidth / 2 : 0;
  }
  get HEIGHT() {
    return this.container ? this.container.clientHeight / 2 : 0;
  }
  get ASPECT() {
    return this.WIDTH / this.HEIGHT;
  }
  get scale() {
    return (this.WIDTH * this.WIDTH + this.HEIGHT * this.HEIGHT) / 13;
  }
  get canvasEl() {
    if (!this.renderer) return null;
    return this.renderer.domElement;
  }
  get mw() {
    return Math.max(this.WIDTH, this.HEIGHT);
  }

  colors = {
    ambient: 0xffffff,
    spotlight: 0xffffff,
  };

  display: { [key: string]: number | null } = {
    currentWidth: null,
    currentHeight: null,
    containerWidth: null,
    containerHeight: null,
    aspect: null,
    scale: null,
  };
  cameraHeight: { [key: string]: number | null } = {
    max: null,
    close: null,
    medium: null,
    far: null,
  };

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  setData(data: RendererData) {
    this.data = data;
    this.factoryOptions = {
      diceColor: data.diceColor,
      textColor: data.textColor,
      textFont: data.textFont,
    };
    this.factoryScaler = data.scaler;
    this.factoryColorful = data.colorfulDice;
    this.factoryWidth = this.WIDTH;
    this.factoryHeight = this.HEIGHT;
    this.buildDice();
  }

  // ---------------------------------------------------------------------------
  // Factory methods (inlined from DiceFactory)
  // ---------------------------------------------------------------------------

  private get factoryColors(): FactoryColors {
    if (this.factoryColorful) return undefined;
    return {
      diceColor: this.factoryOptions.diceColor!,
      textColor: this.factoryOptions.textColor!,
      textFont: this.factoryOptions.textFont!,
    };
  }

  private buildDice() {
    this.disposeDice();

    const w = this.factoryWidth;
    const h = this.factoryHeight;
    const c = this.factoryColors;
    const s = this.factoryScaler;

    this.dice.d100 = new D100DiceGeometry(w, h, c, s).create();
    this.dice.d20 = new D20DiceGeometry(w, h, c, s).create();
    this.dice.d12 = new D12DiceGeometry(w, h, c, s).create();
    this.dice.d10 = new D10DiceGeometry(w, h, c, s).create();
    this.dice.d8 = new D8DiceGeometry(w, h, c, s).create();
    this.dice.d6 = new D6DiceGeometry(w, h, c, s).create();
    this.dice.d4 = new D4DiceGeometry(w, h, c, s).create();
    this.dice.fudge = new FudgeDiceGeometry(w, h, c, s).create();
    this.dice.stunt = new StuntDiceGeometry(w, h, c, s).create();
  }

  private disposeDice() {
    for (const d of Object.values(this.dice)) {
      this.disposeChildren(d.geometry.children);
    }
    this.dice = {};
  }

  private disposeChildren(...children: any[]) {
    children.forEach((child: any) => {
      if ("dispose" in child) child.dispose();
      if (child.children) this.disposeChildren(...child.children);
    });
  }

  private cloneDice(name: string) {
    if (!(name in this.dice)) {
      throw new Error(`Dice type "${name}" does not exist!`);
    }
    return this.dice[name].clone();
  }

  getDiceForRoller(roller: { getType(): string }): DiceShape[] {
    const vector = this.getVector();
    const w = this.factoryWidth;
    const h = this.factoryHeight;
    const dice: DiceShape[] = [];

    switch (roller.getType()) {
      case RenderTypes.D4:
        dice.push(new D4Dice(w, h, this.cloneDice("d4"), vector));
        break;
      case RenderTypes.FUDGE:
        dice.push(new D6Dice(w, h, this.cloneDice("fudge"), vector));
        break;
      case RenderTypes.STUNT:
        dice.push(new D6Dice(w, h, this.cloneDice("stunt"), vector));
        break;
      case RenderTypes.D6:
        dice.push(new D6Dice(w, h, this.cloneDice("d6"), vector));
        break;
      case RenderTypes.D8:
        dice.push(new D8Dice(w, h, this.cloneDice("d8"), vector));
        break;
      case RenderTypes.D10:
        dice.push(new D10Dice(w, h, this.cloneDice("d10"), vector));
        break;
      case RenderTypes.D12:
        dice.push(new D12Dice(w, h, this.cloneDice("d12"), vector));
        break;
      case RenderTypes.D20:
        dice.push(new D20Dice(w, h, this.cloneDice("d20"), vector));
        break;
      case RenderTypes.D100:
        dice.push(
          new D100Dice(w, h, this.cloneDice("d100"), vector),
          new D10Dice(w, h, this.cloneDice("d10"), vector)
        );
        break;
      case RenderTypes.NONE:
        break;
    }
    return dice;
  }

  // ---------------------------------------------------------------------------
  // Container overlay
  // ---------------------------------------------------------------------------

  private createContainer(): HTMLDivElement {
    const div = this.hostDocument!.createElement("div");
    div.className = "archivist-dice-renderer";
    Object.assign(div.style, {
      position: "fixed",
      inset: "0",
      zIndex: "99999",
      pointerEvents: "none",
      transition: "opacity 0.5s",
    });
    return div;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  load(hostDoc: Document): void {
    this.hostDocument = hostDoc;
    this.loaded = true;

    this.renderer = new ThreeWebGLRenderer({
      alpha: true,
      antialias: true,
    });

    this.container = this.createContainer();
    this.container.style.opacity = "0";
    this.container.style.display = "none";
    this.renderer.shadowMap.enabled = this.shadows;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    this.renderer.setClearColor(0x000000, 0);

    this.scene = new Scene();

    // Scene/world init is deferred to start() when the container is in
    // the DOM with real dimensions. But we MUST call setData() here so
    // that this.dice is populated before any getDiceForRoller() call.
    // The geometries are built with placeholder dimensions now and get
    // rebuilt with real viewport dimensions when start() calls initScene().
    this.setData({
      diceColor: "#202020",
      textColor: "#aaaaaa",
      colorfulDice: false,
      scaler: 1,
      renderTime: this.renderTime,
      textFont: "Arial",
    });

    // Resize handler with cleanup
    const onResize = () => this.initScene();
    const hostWindow = this.hostDocument!.defaultView ?? window;
    hostWindow.addEventListener("resize", onResize);
    this.cleanupFns.push(() => hostWindow.removeEventListener("resize", onResize));
  }

  unload(): void {
    this.loaded = false;
    cancelAnimationFrame(this.animation);

    if (this.container) {
      this.container.remove();
      while (this.container.firstChild) {
        this.container.removeChild(this.container.firstChild);
      }
    }
    if (this.renderer) {
      this.renderer.domElement.remove();
      this.renderer.renderLists.dispose();
      this.renderer.dispose();
    }

    this.disposeDice();
    this.tracker.dispose();

    [...this.current.values()].flat().forEach((dice) => {
      this.world.world.removeBody(dice.body);
    });
    this.current = new Set();

    // Run all registered cleanup functions
    for (const fn of this.cleanupFns) {
      try {
        fn();
      } catch {
        // ignore cleanup errors
      }
    }
    this.cleanupFns = [];
  }

  // ---------------------------------------------------------------------------
  // Start / Stop
  // ---------------------------------------------------------------------------

  start() {
    if (this.animating) {
      this.stop();
    }
    if (!this.loaded) {
      if (!this.hostDocument) {
        throw new Error("DiceRenderer: call load(hostDoc) before start()");
      }
      this.load(this.hostDocument);
    }

    // Show container FIRST so clientWidth/clientHeight are available
    // for scene dimension calculations. This matches the original
    // Obsidian plugin's onload() which appends before initScene().
    if (this.container && this.hostDocument) {
      if (!this.container.parentNode) {
        this.hostDocument.body.appendChild(this.container);
      }
      this.container.style.display = "";
      this.container.style.opacity = "1";
    }

    // Now init scene (camera, lights, desk) and physics with real dimensions
    this.initScene();
    this.initWorld();

    // Build dice geometries if not yet built (first roll) or if
    // dimensions changed. setDimensions() inside initScene() already
    // calls buildDice() when this.data is set.
    if (!this.data) {
      this.setData({
        diceColor: "#202020",
        textColor: "#aaaaaa",
        colorfulDice: false,
        scaler: 1,
        renderTime: this.renderTime,
        textFont: "Arial",
      });
    }

    this.animating = true;
    this.extraFrames = DiceRendererClass.DEFAULT_EXTRA_FRAMES;
    this.render();
  }

  stop() {
    // Resolve any pending throw promises
    if (this.animating) {
      for (const shape of [...this.current]) {
        if (this.finished.has(shape)) {
          this.finished.get(shape)!();
          this.finished.delete(shape);
        }
        for (const dice of shape) {
          dice.stopped = true;
        }
      }
    }
    this.animating = false;
    cancelAnimationFrame(this.animation);

    // Remove current dice from scene and physics world, but keep
    // the renderer, scene, geometries, and dice cache alive for reuse.
    for (const shapes of this.current) {
      for (const dice of shapes) {
        if (dice.geometry) this.scene?.remove(dice.geometry);
        if (this.world) this.world.world.removeBody(dice.body);
      }
    }
    this.current = new Set();
    this.rollTracker.dispose();

    // Hide overlay but keep it in the DOM for fast re-show
    if (this.container) {
      this.container.style.opacity = "0";
      this.container.style.display = "none";
    }
  }

  // ---------------------------------------------------------------------------
  // Shadows
  // ---------------------------------------------------------------------------

  enableShadows() {
    this.shadows = true;
    if (this.renderer) this.renderer.shadowMap.enabled = this.shadows;
    if (this.light) this.light.castShadow = this.shadows;
    if (this.desk) this.desk.receiveShadow = this.shadows;
  }
  disableShadows() {
    this.shadows = false;
    if (this.renderer) this.renderer.shadowMap.enabled = this.shadows;
    if (this.light) this.light.castShadow = this.shadows;
    if (this.desk) this.desk.receiveShadow = this.shadows;
  }

  // ---------------------------------------------------------------------------
  // Scene setup
  // ---------------------------------------------------------------------------

  setDimensions(dimensions?: { w: number; h: number }) {
    this.display.currentWidth = this.container!.clientWidth / 2;
    this.display.currentHeight = this.container!.clientHeight / 2;

    if (dimensions) {
      this.display.containerWidth = dimensions.w;
      this.display.containerHeight = dimensions.h;
    } else {
      this.display.containerWidth = this.display.currentWidth;
      this.display.containerHeight = this.display.currentHeight;
    }
    this.display.aspect = Math.min(
      this.display.currentWidth! / this.display.containerWidth!,
      this.display.currentHeight! / this.display.containerHeight!
    );
    this.display.scale = Math.sqrt(
      this.display.containerWidth! * this.display.containerWidth! +
        this.display.containerHeight! * this.display.containerHeight!
    ) / 13;

    this.renderer.setSize(
      this.display.currentWidth! * 2,
      this.display.currentHeight! * 2
    );

    this.cameraHeight.max =
      this.display.currentHeight! /
      this.display.aspect! /
      Math.tan((10 * Math.PI) / 180);

    this.factoryWidth = this.display.currentWidth!;
    this.factoryHeight = this.display.currentHeight!;

    if (this.data) {
      this.buildDice();
    }

    this.cameraHeight.medium = this.cameraHeight.max! / 1.5;
    this.cameraHeight.far = this.cameraHeight.max!;
    this.cameraHeight.close = this.cameraHeight.max! / 2;
  }

  initCamera() {
    if (this.camera) this.scene.remove(this.camera);
    this.camera = new PerspectiveCamera(
      20,
      this.display.currentWidth! / this.display.currentHeight!,
      1,
      this.cameraHeight.max! * 1.3
    );
    this.camera.position.z = this.cameraHeight.far!;
    this.camera.lookAt(new Vector3(0, 0, 0));
  }

  initLighting() {
    const maxwidth = Math.max(
      this.display.containerWidth!,
      this.display.containerHeight!
    );

    if (this.light) this.scene.remove(this.light);
    if (this.ambientLight) this.scene.remove(this.ambientLight);

    this.light = new SpotLight(this.colors.spotlight, 0.25);
    this.light.position.set(-maxwidth / 2, maxwidth / 2, maxwidth * 3);
    this.light.target.position.set(0, 0, 0);
    this.light.distance = maxwidth * 5;
    this.light.angle = Math.PI / 4;
    this.light.castShadow = this.shadows;
    this.light.shadow.camera.near = maxwidth / 10;
    this.light.shadow.camera.far = maxwidth * 5;
    this.light.shadow.camera.fov = 50;
    this.light.shadow.bias = 0.001;
    this.light.shadow.mapSize.width = 1024;
    this.light.shadow.mapSize.height = 1024;
    this.scene.add(this.tracker.track(this.light));

    this.ambientLight = new AmbientLight(0xffffff, 0.9);
    this.scene.add(this.tracker.track(this.ambientLight));
  }

  initDesk() {
    if (this.desk) this.scene.remove(this.desk);
    const shadowplane = new ShadowMaterial();
    shadowplane.opacity = 0.5;
    this.desk = new Mesh(
      new PlaneGeometry(
        this.display.containerWidth! * 6,
        this.display.containerHeight! * 6,
        1,
        1
      ),
      shadowplane
    );
    this.desk.receiveShadow = this.shadows;
    this.scene.add(this.tracker.track(this.desk));
  }

  initScene() {
    this.setDimensions();
    this.initCamera();
    this.initLighting();
    this.initDesk();

    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }

  initWorld() {
    this.world = new LocalWorld(this.WIDTH, this.HEIGHT);
    this.iterations = 0;
  }

  // ---------------------------------------------------------------------------
  // Dice adding
  // ---------------------------------------------------------------------------

  async addDice(dice: DiceShape[]): Promise<void> {
    return new Promise((resolve) => {
      if (!this.animating) {
        this.start();
      }
      for (const shape of dice) {
        shape.recreate(this.getVector(), this.WIDTH, this.HEIGHT);
        this.scene.add(this.rollTracker.track(shape.geometry));
        this.world.add(shape);
      }
      this.current.add(dice);
      this.finished.set(dice, () => {
        resolve();
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Render loop
  // ---------------------------------------------------------------------------

  throwFinished(): boolean {
    let res = true;
    for (const shapes of this.current) {
      let finished = true;
      for (const dice of shapes) {
        if (dice.iterations > 10 / this.frame_rate) {
          dice.stopped = true;
        }
        if (dice.stopped === true) continue;
        const a = dice.body.angularVelocity;
        const v = dice.body.velocity;
        if (
          Math.abs(a.length()) < DiceRendererClass.Threshold &&
          Math.abs(v.length()) < DiceRendererClass.Threshold
        ) {
          if (this.iterations - dice.iterations > 5) {
            dice.stopped = true;
            continue;
          }
          finished = false;
          res = false;
        } else {
          dice.iterations++;
          dice.stopped = false;
          finished = false;
          res = false;
        }
      }
      if (finished && this.finished.has(shapes)) {
        this.finished.get(shapes)!();
        this.finished.delete(shapes);
      }
    }
    return res;
  }

  unrender() {
    if (this.container) {
      this.container.style.opacity = "0";
    }
    cancelAnimationFrame(this.animation);
    setTimeout(() => this.stop(), 500);
  }

  resizeRendererToDisplaySize(): boolean {
    const canvas = this.renderer.domElement;
    const hostWindow = this.hostDocument?.defaultView ?? window;
    const pixelRatio = hostWindow.devicePixelRatio;
    const width = (canvas.clientWidth * pixelRatio) | 0;
    const height = (canvas.clientHeight * pixelRatio) | 0;
    const needResize = canvas.width !== width || canvas.height !== height;
    if (needResize) {
      this.renderer.setSize(width, height, false);
    }
    return needResize;
  }

  render() {
    if (this.throwFinished()) {
      if (this.extraFrames > 10) {
        this.extraFrames--;
      } else {
        try {
          if (!this.data?.renderTime) {
            // Wait for a click to dismiss
            const hostBody = this.hostDocument?.body;
            if (hostBody) {
              const unrender = () => {
                this.stop();
                hostBody.removeEventListener("click", unrender);
              };
              hostBody.addEventListener("click", unrender);
              this.cleanupFns.push(() =>
                hostBody.removeEventListener("click", unrender)
              );
            }
          } else {
            const id = setTimeout(() => this.unrender(), this.data.renderTime);
            this.cleanupFns.push(() => clearTimeout(id));
          }
        } catch (e) {
          console.error("[archivist dice-renderer]", e);
        }
        return;
      }
    }
    this.animation = requestAnimationFrame(() => this.render());

    if (this.resizeRendererToDisplaySize()) {
      const canvas = this.canvasEl;
      if (canvas) {
        this.camera.aspect = canvas.clientWidth / canvas.clientHeight;
        this.camera.updateProjectionMatrix();
      }
    }

    this.world.step(this.frame_rate);
    this.iterations++;
    [...this.current.values()].forEach((g) => g.forEach((d) => d.set()));

    this.renderer.render(this.scene, this.camera);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  getVector(): { x: number; y: number } {
    return {
      x: (Math.random() * 2 - 1) * this.WIDTH,
      y: -(Math.random() * 2 - 1) * this.HEIGHT,
    };
  }

  dispose(...children: Object3D[]) {
    children.forEach((child) => {
      if (child.children) this.dispose(...child.children);
      child.clear();
    });
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export let diceRenderer: DiceRendererClass | null = null;

export function initDiceRenderer(
  hostDoc: Document,
  renderTime?: number
): DiceRendererClass {
  diceRenderer = new DiceRendererClass();
  if (renderTime !== undefined) diceRenderer.renderTime = renderTime;
  diceRenderer.load(hostDoc);
  return diceRenderer;
}
