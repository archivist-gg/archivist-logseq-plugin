import { DiceRoller } from "./dice-roller";

export class FudgeRoller extends DiceRoller {
  override getType() {
    return "fudge";
  }
  override canRender() {
    return true;
  }
  possibilities: number[] = [-1, 0, 1];
}
