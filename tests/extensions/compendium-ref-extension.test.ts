import { describe, it, expect } from "vitest";
import { findCompendiumRefRanges } from "@/extensions/compendium-ref-extension";

describe("findCompendiumRefRanges", () => {
  it("finds a typed ref", () => {
    const text = "See {{monster:goblin}} for stats";
    const ranges = findCompendiumRefRanges(text, 0);
    expect(ranges).toEqual([
      { from: 4, to: 22, refText: "{{monster:goblin}}", entityType: "monster", slug: "goblin" },
    ]);
  });

  it("finds an untyped ref", () => {
    const text = "Check {{goblin}} here";
    const ranges = findCompendiumRefRanges(text, 0);
    expect(ranges).toEqual([
      { from: 6, to: 16, refText: "{{goblin}}", entityType: null, slug: "goblin" },
    ]);
  });

  it("finds multiple refs in text", () => {
    const text = "{{monster:goblin}} and {{spell:fireball}}";
    const ranges = findCompendiumRefRanges(text, 0);
    expect(ranges).toHaveLength(2);
    expect(ranges[0].slug).toBe("goblin");
    expect(ranges[1].slug).toBe("fireball");
  });

  it("applies offset to positions", () => {
    const text = "{{monster:goblin}}";
    const ranges = findCompendiumRefRanges(text, 50);
    expect(ranges[0].from).toBe(50);
    expect(ranges[0].to).toBe(68);
  });

  it("returns empty for text with no refs", () => {
    const text = "No refs here";
    const ranges = findCompendiumRefRanges(text, 0);
    expect(ranges).toEqual([]);
  });

  it("handles refs with spaces inside", () => {
    const text = "{{ monster : goblin }}";
    const ranges = findCompendiumRefRanges(text, 0);
    // parseCompendiumRef handles trimming internally
    expect(ranges).toHaveLength(1);
    expect(ranges[0].slug).toBe("goblin");
  });
});
