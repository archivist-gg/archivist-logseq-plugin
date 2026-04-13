import { describe, it, expect } from "vitest";
import { DiceEngine } from "@/dice/engine";

describe("DiceEngine", () => {
  const engine = new DiceEngine();

  it("creates a roller for simple dice", () => {
    const roller = engine.getRoller("2d6+3");
    expect(roller).not.toBeNull();
  });

  it("returns null for invalid notation", () => {
    const roller = engine.getRoller("");
    expect(roller).toBeNull();
  });

  it("roller produces valid result", async () => {
    const roller = engine.getRoller("1d20+5");
    expect(roller).not.toBeNull();
    if (!roller) return;
    await roller.roll();
    expect(roller.result).toBeGreaterThanOrEqual(6);
    expect(roller.result).toBeLessThanOrEqual(25);
  });

  it("sets shouldRender from options", () => {
    const roller = engine.getRoller("1d6", { shouldRender: true });
    expect(roller).not.toBeNull();
    if (!roller) return;
    expect(roller.shouldRender).toBe(true);
  });

  it("handles complex expressions", async () => {
    const roller = engine.getRoller("4d6kh3");
    expect(roller).not.toBeNull();
    if (!roller) return;
    await roller.roll();
    expect(roller.result).toBeGreaterThanOrEqual(3);
    expect(roller.result).toBeLessThanOrEqual(18);
  });
});
