import { describe, it, expect } from "vitest";
import { renderSpellBlock } from "@/renderers/spell-renderer";
import type { Spell } from "@/types/spell";

const FIREBALL: Spell = {
  name: "Fireball",
  level: 3,
  school: "evocation",
  casting_time: "1 action",
  range: "150 feet",
  components: "V, S, M (a tiny ball of bat guano and sulfur)",
  duration: "Instantaneous",
  classes: ["sorcerer", "wizard"],
  description: ["A bright streak flashes from your pointing finger."],
  at_higher_levels: ["The damage increases by `damage:1d6` for each slot above 3rd."],
};

describe("renderSpellBlock", () => {
  it("renders structure", () => {
    const html = renderSpellBlock(FIREBALL);
    expect(html).toContain("archivist-spell-block-wrapper");
    expect(html).toContain("Fireball");
    expect(html).toContain("3rd-level evocation");
  });

  it("renders properties", () => {
    const html = renderSpellBlock(FIREBALL);
    expect(html).toContain("Casting Time:");
    expect(html).toContain("1 action");
    expect(html).toContain("Range:");
    expect(html).toContain("150 feet");
  });

  it("renders at higher levels with inline tags", () => {
    const html = renderSpellBlock(FIREBALL);
    expect(html).toContain("At Higher Levels.");
    expect(html).toContain("archivist-stat-tag");
  });

  it("renders classes", () => {
    const html = renderSpellBlock(FIREBALL);
    expect(html).toContain("Sorcerer, Wizard");
  });

  it("renders cantrip", () => {
    const html = renderSpellBlock({ name: "Fire Bolt", level: 0, school: "Evocation" });
    expect(html).toContain("Evocation cantrip");
  });

  it("renders concentration tag", () => {
    const html = renderSpellBlock({ name: "Bless", concentration: true });
    expect(html).toContain("Concentration");
  });

  it("renders ritual tag", () => {
    const html = renderSpellBlock({ name: "Find Familiar", ritual: true });
    expect(html).toContain("Ritual");
  });
});
