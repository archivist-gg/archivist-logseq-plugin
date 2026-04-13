import type { LexicalToken } from "./lexer";
import type { RenderableDice } from "./renderable";

export abstract class Roller<T> {
  abstract roll(): Promise<T>;

  getRandomBetween(min: number, max: number): number {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return Math.floor((buf[0] / (0xffffffff + 1)) * (max - min + 1)) + min;
  }
}

export abstract class RenderableRoller<T> extends Roller<T> {
  lexemes: LexicalToken[] = [];
  shouldRender = false;
  isRendering = false;
  children: RenderableDice<any>[] = [];

  abstract rollSync(): T;
  abstract get result(): T;

  async renderChildren(): Promise<void> {
    const controller = new AbortController();
    const promises = this.children
      .filter((c) => c.shouldRender && c.canRender())
      .map((c) => c.render(controller));
    await Promise.allSettled(promises);
  }
}
