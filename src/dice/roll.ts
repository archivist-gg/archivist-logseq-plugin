import { DiceEngine } from "./engine";
import { setDiceRendererRef } from "./dice-roller";

let engine: DiceEngine | null = null;
let rendererMod: typeof import("./renderer/dice-renderer") | null = null;

/**
 * Roll dice with 3D animation. Lazily initializes the dice renderer
 * on first call — Three.js and cannon-es are only loaded when the
 * user actually rolls dice.
 */
export async function rollDice(
  notation: string,
  renderTime?: number,
): Promise<void> {
  // Lazy-init renderer on first roll
  if (!rendererMod) {
    rendererMod = await import("./renderer/dice-renderer");
    const hostDoc = parent?.document ?? (typeof top !== "undefined" ? top?.document : null) ?? document;
    if (hostDoc) {
      rendererMod.initDiceRenderer(hostDoc, renderTime);
      // Wire the renderer into dice-roller.ts so DiceRoller can access
      // 3D shapes without statically importing Three.js/cannon-es.
      if (rendererMod.diceRenderer) {
        setDiceRendererRef(rendererMod.diceRenderer);
      }
    }
  }

  // Apply current renderTime on every roll (user may change setting mid-session)
  if (rendererMod?.diceRenderer && renderTime !== undefined) {
    rendererMod.diceRenderer.renderTime = renderTime;
  }

  if (!engine) engine = new DiceEngine();

  const roller = engine.getRoller(notation, { shouldRender: true });
  if (!roller) return;

  await roller.roll(true);

  showResult(notation, roller.result);
}

function showResult(notation: string, result: number): void {
  const doc = rendererMod?.diceRenderer?.hostDocument;
  if (!doc) return;

  const el = doc.createElement("div");
  el.className = "archivist-dice-result";

  const label = doc.createElement("span");
  label.textContent = notation;
  Object.assign(label.style, { opacity: "0.7", fontSize: "14px" });

  const value = doc.createElement("span");
  value.textContent = String(result);
  Object.assign(value.style, { fontSize: "28px", fontWeight: "bold" });

  el.appendChild(label);
  el.appendChild(doc.createElement("br"));
  el.appendChild(value);

  Object.assign(el.style, {
    position: "fixed",
    top: "48px",
    right: "16px",
    background: "rgba(0,0,0,0.85)",
    color: "#fff",
    padding: "14px 28px",
    borderRadius: "10px",
    textAlign: "center",
    zIndex: "100000",
    pointerEvents: "none",
    fontFamily: "system-ui, sans-serif",
    transition: "opacity 0.5s",
  });
  doc.body.appendChild(el);

  const duration = rendererMod?.diceRenderer?.renderTime ?? 3000;
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 500);
  }, duration);
}
