import { describe, it, expect } from "vitest";
import { detectCompendiumTrigger } from "@/extensions/compendium-suggest";

describe("detectCompendiumTrigger", () => {
  it("detects {{ trigger", () => {
    const result = detectCompendiumTrigger("Some text {{gob", 15);
    expect(result).toEqual({ from: 10, query: "gob", entityType: undefined });
  });

  it("detects typed prefix", () => {
    const result = detectCompendiumTrigger("{{monster:gob", 13);
    expect(result).toEqual({ from: 0, query: "gob", entityType: "monster" });
  });

  it("returns null when no {{ found", () => {
    const result = detectCompendiumTrigger("just text", 9);
    expect(result).toBeNull();
  });

  it("returns null when {{ is already closed", () => {
    const result = detectCompendiumTrigger("{{monster:goblin}} more", 23);
    expect(result).toBeNull();
  });

  it("handles spell prefix", () => {
    const result = detectCompendiumTrigger("{{spell:fire", 12);
    expect(result).toEqual({ from: 0, query: "fire", entityType: "spell" });
  });

  it("handles item prefix", () => {
    const result = detectCompendiumTrigger("{{item:sword", 12);
    expect(result).toEqual({ from: 0, query: "sword", entityType: "item" });
  });

  it("handles unknown prefix as untyped query", () => {
    const result = detectCompendiumTrigger("{{dragon:fire", 13);
    expect(result).toEqual({ from: 0, query: "dragon:fire", entityType: undefined });
  });

  it("handles empty query after {{", () => {
    const result = detectCompendiumTrigger("{{", 2);
    expect(result).toEqual({ from: 0, query: "", entityType: undefined });
  });
});
