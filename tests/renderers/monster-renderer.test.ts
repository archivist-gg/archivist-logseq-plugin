import { describe, it, expect } from "vitest";
import { renderMonsterBlock } from "@/renderers/monster-renderer";
import type { Monster } from "@/types/monster";

const GOBLIN: Monster = {
  name: "Goblin",
  size: "Small",
  type: "humanoid (goblinoid)",
  alignment: "neutral evil",
  cr: "1/4",
  ac: [{ ac: 15, from: ["leather armor", "shield"] }],
  hp: { average: 7, formula: "2d6" },
  speed: { walk: 30 },
  abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
  skills: { stealth: 6 },
  senses: ["darkvision 60 ft."],
  passive_perception: 9,
  languages: ["Common", "Goblin"],
  traits: [
    { name: "Nimble Escape", entries: ["The goblin can take the Disengage or Hide action as a bonus action on each of its turns."] },
  ],
  actions: [
    { name: "Scimitar", entries: ["Melee Weapon Attack: `atk:DEX` to hit, reach 5 ft., one target. Hit: `damage:1d6+DEX` slashing damage."] },
  ],
};

describe("renderMonsterBlock", () => {
  it("renders wrapper and block structure", () => {
    const html = renderMonsterBlock(GOBLIN);
    expect(html).toContain("archivist-monster-block-wrapper");
    expect(html).toContain("archivist-monster-block");
  });

  it("renders name and type", () => {
    const html = renderMonsterBlock(GOBLIN);
    expect(html).toContain("Goblin");
    expect(html).toContain("Small Humanoid (Goblinoid), Neutral Evil");
  });

  it("renders AC with source", () => {
    const html = renderMonsterBlock(GOBLIN);
    expect(html).toContain("Armor Class");
    expect(html).toContain("15 (Leather Armor, Shield)");
  });

  it("renders HP with dice pill", () => {
    const html = renderMonsterBlock(GOBLIN);
    expect(html).toContain("Hit Points");
    expect(html).toContain("7");
    expect(html).toContain("archivist-stat-tag");
  });

  it("renders ability scores", () => {
    const html = renderMonsterBlock(GOBLIN);
    expect(html).toContain("abilities-table");
    expect(html).toContain("STR");
    expect(html).toContain("8");
    expect(html).toContain("(-1)");
    expect(html).toContain("14");
    expect(html).toContain("(+2)");
  });

  it("renders secondary properties", () => {
    const html = renderMonsterBlock(GOBLIN);
    expect(html).toContain("Stealth +6");
    expect(html).toContain("darkvision 60 ft.");
    expect(html).toContain("passive Perception 9");
    expect(html).toContain("Common, Goblin");
    expect(html).toContain("1/4");
  });

  it("renders traits", () => {
    const html = renderMonsterBlock(GOBLIN);
    expect(html).toContain("Nimble Escape");
  });

  it("resolves formula tags in actions", () => {
    const html = renderMonsterBlock(GOBLIN);
    // DEX 14 = +2, CR 1/4 = +2 prof => atk = +4
    expect(html).toContain("+4");
  });

  it("renders SVG bars", () => {
    const html = renderMonsterBlock(GOBLIN);
    expect(html).toContain("stat-block-bar");
  });

  it("renders two-column mode", () => {
    const html = renderMonsterBlock(GOBLIN, 2);
    expect(html).toContain("archivist-monster-two-col");
  });

  it("renders legendary section", () => {
    const dragon: Monster = {
      name: "Dragon",
      legendary: [{ name: "Detect", entries: ["The dragon makes a Perception check."] }],
      legendary_actions: 3,
      legendary_resistance: 3,
    };
    const html = renderMonsterBlock(dragon);
    expect(html).toContain("Legendary Actions");
    expect(html).toContain("3 legendary actions");
    expect(html).toContain("Legendary Resistance");
  });

  it("renders minimal monster", () => {
    const html = renderMonsterBlock({ name: "Test" });
    expect(html).toContain("Test");
    expect(html).toContain("archivist-monster-block");
  });
});
