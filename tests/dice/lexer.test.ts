import { describe, it, expect } from "vitest";
import { Lexer } from "@/dice/lexer";

describe("Lexer", () => {
  describe("parse", () => {
    it("parses simple dice expression", () => {
      const result = Lexer.parse("2d6");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBe(1);
        expect(result.data[0].type).toBe("dice");
        expect(result.data[0].value).toBe("2d6");
      }
    });

    it("parses dice with addition", () => {
      const result = Lexer.parse("1d20+5");
      expect(result.success).toBe(true);
      if (result.success) {
        const types = result.data.map((t) => t.type);
        expect(types).toContain("dice");
        expect(types).toContain("math");
      }
    });

    it("parses keep-high modifier", () => {
      const result = Lexer.parse("4d6kh3");
      expect(result.success).toBe(true);
      if (result.success) {
        const diceToken = result.data.find((t) => t.type === "dice");
        expect(diceToken).toBeDefined();
      }
    });

    it("parses fudge dice", () => {
      const result = Lexer.parse("4dF");
      expect(result.success).toBe(true);
      if (result.success) {
        const fudge = result.data.find((t) => t.type === "fudge");
        expect(fudge).toBeDefined();
      }
    });

    it("parses complex expression", () => {
      const result = Lexer.parse("2d6+1d4+3");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBeGreaterThan(0);
      }
    });

    it("parses percentage dice", () => {
      const result = Lexer.parse("1d100");
      expect(result.success).toBe(true);
    });

    it("parses exploding dice", () => {
      const result = Lexer.parse("2d6!");
      expect(result.success).toBe(true);
    });

    it("parses reroll modifier", () => {
      const result = Lexer.parse("2d6r1");
      expect(result.success).toBe(true);
    });

    it("returns error for empty input", () => {
      const result = Lexer.parse("");
      expect(result.success).toBe(false);
    });
  });
});
