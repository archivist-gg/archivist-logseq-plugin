import type { DiceShape } from "./renderer/shapes";

export interface RenderableDice<T> {
  canRender(): boolean;
  getType(): RenderTypes;
  roll(): Promise<void>;
  rollSync(): void;
  render(abortController: AbortController): Promise<void>;
  shouldRender: boolean;
  getValue(shapes?: DiceShape[]): Promise<T>;
  getValueSync(): T;
}

export const RenderTypes = {
  NONE: "none",
  D4: "D4",
  D6: "D6",
  D8: "D8",
  D10: "D10",
  D12: "D12",
  D20: "D20",
  D100: "D100",
  FUDGE: "fudge",
  STUNT: "stunt",
} as const;
export type RenderTypes = (typeof RenderTypes)[keyof typeof RenderTypes];
