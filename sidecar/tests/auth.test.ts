import { describe, it, expect } from "vitest";
import { timingSafeEqualStr, ALLOWED_ORIGINS } from "../src/auth.js";

describe("timingSafeEqualStr", () => {
  it("returns true for identical non-empty strings", () => {
    expect(timingSafeEqualStr("abc123", "abc123")).toBe(true);
  });

  it("returns false for different-length strings without throwing", () => {
    expect(() => timingSafeEqualStr("a", "ab")).not.toThrow();
    expect(timingSafeEqualStr("a", "ab")).toBe(false);
  });

  it("returns false for same-length different strings", () => {
    expect(timingSafeEqualStr("abcdef", "abcdeg")).toBe(false);
  });

  it("returns false for empty inputs", () => {
    expect(timingSafeEqualStr("", "")).toBe(false);
    expect(timingSafeEqualStr("x", "")).toBe(false);
    expect(timingSafeEqualStr("", "x")).toBe(false);
  });
});

describe("ALLOWED_ORIGINS", () => {
  it("is a Set of allowed Origin strings", () => {
    expect(ALLOWED_ORIGINS).toBeInstanceOf(Set);
    expect(ALLOWED_ORIGINS.size).toBeGreaterThanOrEqual(1);
  });

  it("does NOT allow app://obsidian.md (Obsidian does not consume the bridge)", () => {
    expect(ALLOWED_ORIGINS.has("app://obsidian.md")).toBe(false);
  });
});
