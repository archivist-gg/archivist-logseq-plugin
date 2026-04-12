import { describe, it, expect } from "vitest";
import { renderItemBlock } from "@/renderers/item-renderer";

describe("renderItemBlock", () => {
  it("renders structure", () => {
    const html = renderItemBlock({ name: "Flame Tongue", type: "weapon", rarity: "rare", attunement: true });
    expect(html).toContain("archivist-item-block-wrapper");
    expect(html).toContain("Flame Tongue");
    expect(html).toContain("Weapon");
    expect(html).toContain("Rare");
    expect(html).toContain("requires attunement");
  });

  it("renders damage", () => {
    const html = renderItemBlock({ name: "Test", damage: "2d6", damage_type: "fire" });
    expect(html).toContain("Damage:");
    expect(html).toContain("2d6 fire");
  });

  it("renders weight and value", () => {
    const html = renderItemBlock({ name: "Test", weight: 3, value: 100 });
    expect(html).toContain("3 lb.");
    expect(html).toContain("100 gp");
  });

  it("renders description with inline tags", () => {
    const html = renderItemBlock({ name: "Test", entries: ["Deals `damage:2d6` fire damage."] });
    expect(html).toContain("archivist-stat-tag");
  });

  it("renders charges", () => {
    const html = renderItemBlock({ name: "Test", charges: 7, recharge: "dawn" });
    expect(html).toContain("7 charges");
    expect(html).toContain("dawn");
  });

  it("renders curse", () => {
    const html = renderItemBlock({ name: "Test", curse: true });
    expect(html).toContain("Cursed");
  });

  it("renders string attunement", () => {
    const html = renderItemBlock({ name: "Test", attunement: "a spellcaster" });
    expect(html).toContain("requires attunement by a spellcaster");
  });
});
