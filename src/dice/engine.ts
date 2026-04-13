import { Lexer } from "./lexer";
import { StackRoller } from "./stack-roller";
import type { RollerOptions } from "./types";

export class DiceEngine {
  getRoller(notation: string, options?: Partial<RollerOptions>): StackRoller | null {
    const result = Lexer.parse(notation);
    if (!result.success) {
      console.warn("[archivist] Dice parse error:", result.error);
      return null;
    }
    const roller = new StackRoller(result.data);
    if (options?.shouldRender) roller.shouldRender = true;
    return roller;
  }
}
