import { describe, it, expect } from "vitest";
import { Lexer } from "@/dice/lexer";
import { StackRoller, BasicStackRoller } from "@/dice/stack-roller";

describe("BasicStackRoller", () => {
  it("evaluates a simple dice roll", () => {
    const result = Lexer.parse("1d6");
    expect(result.success).toBe(true);
    if (!result.success) return;
    const roller = new BasicStackRoller(result.data);
    const value = roller.rollSync();
    expect(value).toBeGreaterThanOrEqual(1);
    expect(value).toBeLessThanOrEqual(6);
  });

  it("evaluates a static number", () => {
    const result = Lexer.parse("5");
    expect(result.success).toBe(true);
    if (!result.success) return;
    const roller = new BasicStackRoller(result.data);
    const value = roller.rollSync();
    expect(value).toBe(5);
  });

  it("evaluates addition", () => {
    const result = Lexer.parse("3+4");
    expect(result.success).toBe(true);
    if (!result.success) return;
    const roller = new BasicStackRoller(result.data);
    const value = roller.rollSync();
    expect(value).toBe(7);
  });

  it("evaluates multiplication", () => {
    const result = Lexer.parse("3*4");
    expect(result.success).toBe(true);
    if (!result.success) return;
    const roller = new BasicStackRoller(result.data);
    const value = roller.rollSync();
    expect(value).toBe(12);
  });
});

describe("StackRoller", () => {
  it("evaluates 2d6+3", async () => {
    const result = Lexer.parse("2d6+3");
    expect(result.success).toBe(true);
    if (!result.success) return;
    const roller = new StackRoller(result.data);
    await roller.roll();
    expect(roller.result).toBeGreaterThanOrEqual(5);
    expect(roller.result).toBeLessThanOrEqual(15);
  });

  it("evaluates 1d20+5", async () => {
    const result = Lexer.parse("1d20+5");
    expect(result.success).toBe(true);
    if (!result.success) return;
    const roller = new StackRoller(result.data);
    await roller.roll();
    expect(roller.result).toBeGreaterThanOrEqual(6);
    expect(roller.result).toBeLessThanOrEqual(25);
  });

  it("evaluates rollSync", () => {
    const result = Lexer.parse("2d6+3");
    expect(result.success).toBe(true);
    if (!result.success) return;
    const roller = new StackRoller(result.data);
    roller.rollSync();
    expect(roller.result).toBeGreaterThanOrEqual(5);
    expect(roller.result).toBeLessThanOrEqual(15);
  });

  it("evaluates complex expression 2d6+1d4+3", async () => {
    const result = Lexer.parse("2d6+1d4+3");
    expect(result.success).toBe(true);
    if (!result.success) return;
    const roller = new StackRoller(result.data);
    await roller.roll();
    expect(roller.result).toBeGreaterThanOrEqual(6);
    expect(roller.result).toBeLessThanOrEqual(19);
  });

  it("evaluates subtraction", async () => {
    const result = Lexer.parse("10-3");
    expect(result.success).toBe(true);
    if (!result.success) return;
    const roller = new StackRoller(result.data);
    await roller.roll();
    expect(roller.result).toBe(7);
  });
});
