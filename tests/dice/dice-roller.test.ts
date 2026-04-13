import { describe, it, expect } from "vitest";
import { DiceRoller } from "@/dice/dice-roller";

describe("DiceRoller", () => {
  it("rolls a single d6", async () => {
    const roller = new DiceRoller("1d6");
    await roller.roll();
    expect(roller.result).toBeGreaterThanOrEqual(1);
    expect(roller.result).toBeLessThanOrEqual(6);
  });

  it("rolls multiple dice", async () => {
    const roller = new DiceRoller("3d6");
    await roller.roll();
    expect(roller.result).toBeGreaterThanOrEqual(3);
    expect(roller.result).toBeLessThanOrEqual(18);
  });

  it("handles a d20", async () => {
    const roller = new DiceRoller("1d20");
    await roller.roll();
    expect(roller.result).toBeGreaterThanOrEqual(1);
    expect(roller.result).toBeLessThanOrEqual(20);
  });

  it("handles static numbers", async () => {
    const roller = new DiceRoller("5");
    await roller.roll();
    expect(roller.result).toBe(5);
  });

  it("rollSync works", () => {
    const roller = new DiceRoller("2d6");
    roller.rollSync();
    expect(roller.result).toBeGreaterThanOrEqual(2);
    expect(roller.result).toBeLessThanOrEqual(12);
  });

  it("canRender returns true for standard dice", () => {
    const roller = new DiceRoller("1d20");
    expect(roller.canRender()).toBe(true);
  });

  it("canRender returns false for custom ranges", () => {
    const roller = new DiceRoller("1d[2,4,6]");
    expect(roller.canRender()).toBe(false);
  });

  it("keeps high with kh modifier", async () => {
    const roller = new DiceRoller("4d6");
    roller.modifiers.set("kh", { conditionals: [], data: 3, value: "kh3" });
    await roller.roll();
    expect(roller.result).toBeGreaterThanOrEqual(3);
    expect(roller.result).toBeLessThanOrEqual(18);
  });
});
