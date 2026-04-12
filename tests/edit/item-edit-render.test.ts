import { describe, it, expect } from "vitest";
import { renderItemEditMode } from "../../src/edit/item-edit-render";

const testItem = {
  name: "Flame Tongue Longsword",
  type: "Weapon",
  rarity: "Rare",
  attunement: true,
  weight: 3,
  entries: ["You can use a bonus action to speak this magic sword's command word."],
};

describe("renderItemEditMode", () => {
  it("renders name input", () => {
    const html = renderItemEditMode(testItem as any, null);
    expect(html).toContain('data-field="name"');
    expect(html).toContain('value="Flame Tongue Longsword"');
  });

  it("renders type and rarity selects", () => {
    const html = renderItemEditMode(testItem as any, null);
    expect(html).toContain('data-field="type"');
    expect(html).toContain('data-field="rarity"');
  });

  it("renders attunement checkbox", () => {
    const html = renderItemEditMode(testItem as any, null);
    expect(html).toContain('data-field="attunement"');
    expect(html).toContain("checked");
  });

  it("renders entries textarea", () => {
    const html = renderItemEditMode(testItem as any, null);
    expect(html).toContain('data-field="entries"');
    expect(html).toContain("command word");
  });

  it("adds editing class", () => {
    const html = renderItemEditMode(testItem as any, null);
    expect(html).toContain("editing");
  });
});
