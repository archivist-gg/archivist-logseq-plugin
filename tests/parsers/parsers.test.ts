import { describe, it, expect } from "vitest";
import { parseMonster } from "@/parsers/monster-parser";
import { parseSpell } from "@/parsers/spell-parser";
import { parseItem } from "@/parsers/item-parser";
import { parseInlineTag } from "@/parsers/inline-tag-parser";
import { abilityModifier, formatModifier } from "@/parsers/yaml-utils";

describe("parseMonster", () => {
  it("parses a minimal monster", () => {
    const result = parseMonster("name: Goblin");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Goblin");
    }
  });

  it("parses a full monster with all fields", () => {
    const yaml = `
name: Adult Red Dragon
size: Huge
type: dragon
alignment: chaotic evil
cr: "17"
ac:
  - ac: 19
    from:
      - natural armor
hp:
  average: 256
  formula: 19d12+133
speed:
  walk: 40
  fly: 80
  climb: 40
abilities:
  str: 27
  dex: 10
  con: 25
  int: 16
  wis: 13
  cha: 21
saves:
  dex: 6
  con: 13
  wis: 7
  cha: 11
skills:
  perception: 13
  stealth: 6
senses:
  - blindsight 60 ft.
  - darkvision 120 ft.
passive_perception: 23
languages:
  - Common
  - Draconic
damage_immunities:
  - fire
condition_immunities:
  - frightened
traits:
  - name: Legendary Resistance (3/Day)
    entries:
      - "If the dragon fails a saving throw, it can choose to succeed instead."
actions:
  - name: Multiattack
    entries:
      - "The dragon makes three attacks: one with its bite and two with its claws."
legendary:
  - name: Detect
    entries:
      - "The dragon makes a Wisdom (Perception) check."
legendary_actions: 3
legendary_resistance: 3
columns: 2
`;
    const result = parseMonster(yaml);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const m = result.data;
    expect(m.name).toBe("Adult Red Dragon");
    expect(m.size).toBe("Huge");
    expect(m.cr).toBe("17");
    expect(m.ac?.[0].ac).toBe(19);
    expect(m.hp?.average).toBe(256);
    expect(m.speed?.fly).toBe(80);
    expect(m.abilities?.str).toBe(27);
    expect(m.saves?.con).toBe(13);
    expect(m.damage_immunities).toEqual(["fire"]);
    expect(m.traits).toHaveLength(1);
    expect(m.actions).toHaveLength(1);
    expect(m.legendary).toHaveLength(1);
    expect(m.columns).toBe(2);
  });

  it("fails on missing name", () => {
    const result = parseMonster("size: Medium");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("name");
    }
  });
});

describe("parseSpell", () => {
  it("parses a full spell", () => {
    const yaml = `
name: Fireball
level: 3
school: evocation
casting_time: 1 action
range: 150 feet
components: V, S, M (a tiny ball of bat guano and sulfur)
duration: Instantaneous
classes:
  - sorcerer
  - wizard
description:
  - "A bright streak flashes from your pointing finger."
at_higher_levels:
  - "The damage increases by 1d6 for each slot level above 3rd."
`;
    const result = parseSpell(yaml);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.name).toBe("Fireball");
    expect(result.data.level).toBe(3);
    expect(result.data.classes).toEqual(["sorcerer", "wizard"]);
  });
});

describe("parseItem", () => {
  it("parses a full item", () => {
    const yaml = `
name: Flame Tongue
type: weapon (any sword)
rarity: rare
attunement: true
damage: 2d6
damage_type: fire
entries:
  - "While ablaze, it deals an extra 2d6 fire damage."
`;
    const result = parseItem(yaml);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.name).toBe("Flame Tongue");
    expect(result.data.attunement).toBe(true);
    expect(result.data.damage).toBe("2d6");
  });
});

describe("parseInlineTag", () => {
  it("parses dice tag", () => {
    const tag = parseInlineTag("dice:2d6+3");
    expect(tag).not.toBeNull();
    expect(tag!.type).toBe("dice");
    expect(tag!.content).toBe("2d6+3");
  });

  it("parses atk tag", () => {
    const tag = parseInlineTag("atk:+7");
    expect(tag!.type).toBe("atk");
    expect(tag!.content).toBe("+7");
  });

  it("parses dc tag", () => {
    const tag = parseInlineTag("dc:15");
    expect(tag!.type).toBe("dc");
  });

  it("aliases roll to dice", () => {
    const tag = parseInlineTag("roll:1d20");
    expect(tag!.type).toBe("dice");
  });

  it("returns null for invalid tags", () => {
    expect(parseInlineTag("hello world")).toBeNull();
    expect(parseInlineTag("unknown:value")).toBeNull();
    expect(parseInlineTag("dice:")).toBeNull();
  });
});

describe("abilityModifier", () => {
  it("calculates modifiers correctly", () => {
    expect(abilityModifier(10)).toBe(0);
    expect(abilityModifier(20)).toBe(5);
    expect(abilityModifier(8)).toBe(-1);
    expect(abilityModifier(1)).toBe(-5);
  });
});

describe("formatModifier", () => {
  it("formats with sign", () => {
    expect(formatModifier(0)).toBe("+0");
    expect(formatModifier(5)).toBe("+5");
    expect(formatModifier(-1)).toBe("-1");
  });
});
