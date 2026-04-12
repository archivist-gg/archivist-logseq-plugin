import { describe, it, expect } from "vitest";
import { renderMonsterEditMode } from "../../src/edit/monster-edit-render";

const testMonster = {
  name: "Goblin",
  size: "Small",
  type: "humanoid (goblinoid)",
  alignment: "neutral evil",
  ac: [{ ac: 15, from: ["leather armor", "shield"] }],
  hp: { average: 7, formula: "2d6" },
  speed: { walk: 30 },
  abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
  cr: "1/4",
  traits: [{ name: "Nimble Escape", entries: ["The goblin can take the Disengage or Hide action as a bonus action."] }],
  actions: [{ name: "Scimitar", entries: ["`atk:DEX` `damage:1d6+DEX` slashing damage."] }],
};

describe("renderMonsterEditMode", () => {
  it("renders name input with monster name", () => {
    const html = renderMonsterEditMode(testMonster as any, null);
    expect(html).toContain('data-field="name"');
    expect(html).toContain('value="Goblin"');
  });

  it("renders ability score inputs for all 6 abilities", () => {
    const html = renderMonsterEditMode(testMonster as any, null);
    for (const abil of ["str", "dex", "con", "int", "wis", "cha"]) {
      expect(html).toContain(`data-field="abilities.${abil}"`);
    }
  });

  it("renders AC input", () => {
    const html = renderMonsterEditMode(testMonster as any, null);
    expect(html).toContain('data-field="ac.ac"');
    expect(html).toContain('value="15"');
  });

  it("renders speed walk input", () => {
    const html = renderMonsterEditMode(testMonster as any, null);
    expect(html).toContain('data-field="speed.walk"');
    expect(html).toContain('value="30"');
  });

  it("renders section tabs", () => {
    const html = renderMonsterEditMode(testMonster as any, null);
    expect(html).toContain("archivist-section-tabs");
  });

  it("renders feature cards for existing sections", () => {
    const html = renderMonsterEditMode(testMonster as any, null);
    expect(html).toContain("Nimble Escape");
    expect(html).toContain("Scimitar");
  });

  it("adds editing class to block", () => {
    const html = renderMonsterEditMode(testMonster as any, null);
    expect(html).toContain("editing");
  });
});
