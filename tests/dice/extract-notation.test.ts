import { describe, it, expect } from "vitest";
import { extractDiceNotation, isRollable } from "@/renderers/renderer-utils";

describe("isRollable", () => {
  it("dice is rollable", () => expect(isRollable("dice")).toBe(true));
  it("damage is rollable", () => expect(isRollable("damage")).toBe(true));
  it("atk is rollable", () => expect(isRollable("atk")).toBe(true));
  it("mod is rollable", () => expect(isRollable("mod")).toBe(true));
  it("dc is NOT rollable", () => expect(isRollable("dc")).toBe(false));
  it("check is NOT rollable", () => expect(isRollable("check")).toBe(false));
});

describe("extractDiceNotation", () => {
  it("passes dice content through", () => {
    expect(extractDiceNotation({ type: "dice", content: "2d6+3" })).toBe("2d6+3");
  });

  it("strips damage type text", () => {
    expect(extractDiceNotation({ type: "damage", content: "2d6+3 fire" })).toBe("2d6+3");
  });

  it("converts atk to d20 roll", () => {
    expect(extractDiceNotation({ type: "atk", content: "+7" })).toBe("1d20+7");
  });

  it("converts mod to d20 roll", () => {
    expect(extractDiceNotation({ type: "mod", content: "+3" })).toBe("1d20+3");
  });

  it("returns null for dc", () => {
    expect(extractDiceNotation({ type: "dc", content: "15" })).toBeNull();
  });

  it("returns null for check", () => {
    expect(extractDiceNotation({ type: "check", content: "Perception" })).toBeNull();
  });

  it("handles damage with no type text", () => {
    expect(extractDiceNotation({ type: "damage", content: "3d8" })).toBe("3d8");
  });

  it("handles negative modifier", () => {
    expect(extractDiceNotation({ type: "atk", content: "-1" })).toBe("1d20-1");
  });
});
