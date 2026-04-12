import { describe, it, expect } from "vitest";
import { parseCompendiumRef } from "@/extensions/compendium-ref-parser";

describe("parseCompendiumRef", () => {
  it("parses typed ref", () => {
    const result = parseCompendiumRef("{{monster:goblin}}");
    expect(result).toEqual({ entityType: "monster", slug: "goblin" });
  });

  it("parses untyped ref", () => {
    const result = parseCompendiumRef("{{goblin}}");
    expect(result).toEqual({ entityType: null, slug: "goblin" });
  });

  it("returns null for invalid format", () => {
    expect(parseCompendiumRef("not a ref")).toBeNull();
    expect(parseCompendiumRef("{{}}")).toBeNull();
  });

  it("rejects invalid type prefix", () => {
    const result = parseCompendiumRef("{{dragon:goblin}}");
    expect(result).toEqual({ entityType: null, slug: "dragon:goblin" });
  });
});
