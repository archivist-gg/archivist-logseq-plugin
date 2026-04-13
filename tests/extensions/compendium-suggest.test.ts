import { describe, it, expect } from "vitest";
import { detectCompendiumTrigger } from "@/extensions/compendium-suggest";

describe("detectCompendiumTrigger", () => {
  // --- Legacy {{type:query syntax ---
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

  // --- Logseq {{renderer :type, query}} syntax ---
  it("detects renderer syntax with type and query", () => {
    const result = detectCompendiumTrigger("{{renderer :monster, gob", 24);
    expect(result).toEqual({ from: 0, query: "gob", entityType: "monster" });
  });

  it("detects renderer syntax with type only (no comma yet)", () => {
    const result = detectCompendiumTrigger("{{renderer :monster", 19);
    expect(result).toEqual({ from: 0, query: "", entityType: "monster" });
  });

  it("detects renderer keyword alone", () => {
    const result = detectCompendiumTrigger("{{renderer", 10);
    expect(result).toEqual({ from: 0, query: "", entityType: undefined });
  });

  it("detects renderer with spell type", () => {
    const result = detectCompendiumTrigger("{{renderer :spell, fire", 23);
    expect(result).toEqual({ from: 0, query: "fire", entityType: "spell" });
  });

  it("detects renderer with item type", () => {
    const result = detectCompendiumTrigger("{{renderer :item, sword", 23);
    expect(result).toEqual({ from: 0, query: "sword", entityType: "item" });
  });
});
