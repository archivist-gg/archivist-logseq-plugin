// tests/entities/srd-normalizer.test.ts
import { describe, it, expect } from "vitest";
import {
  normalizeSrdMonster,
  normalizeSrdItem,
  normalizeSrdSpell,
} from "@/entities/srd-normalizer";

describe("normalizeSrdMonster", () => {
  it("maps SRD fields to plugin schema", () => {
    const raw = {
      name: "Goblin",
      size: "Small",
      type: "humanoid",
      alignment: "neutral evil",
      armor_class: 15,
      armor_desc: "leather armor, shield",
      hit_points: 7,
      hit_dice: "2d6",
      speed: { walk: 30 },
      strength: 8,
      dexterity: 14,
      constitution: 10,
      intelligence: 10,
      wisdom: 8,
      charisma: 8,
      challenge_rating: "1/4",
      senses: "darkvision 60 ft., passive Perception 9",
      languages: "Common, Goblin",
    };

    const result = normalizeSrdMonster(raw);
    expect(result.name).toBe("Goblin");
    expect(result.size).toBe("Small");
    expect(result.ac).toEqual([{ ac: 15, from: ["leather armor, shield"] }]);
    expect(result.hp).toEqual({ average: 7, formula: "2d6" });
    expect(result.speed).toEqual({ walk: 30 });
    expect((result.abilities as any).str).toBe(8);
    expect((result.abilities as any).dex).toBe(14);
    expect(result.cr).toBe("1/4");
    expect(result.senses).toEqual(["darkvision 60 ft."]);
    expect(result.passive_perception).toBe(9);
    expect(result.languages).toEqual(["Common", "Goblin"]);
  });

  it("normalizes actions with tag conversion", () => {
    const raw = {
      name: "Goblin",
      strength: 8,
      dexterity: 14,
      constitution: 10,
      intelligence: 10,
      wisdom: 8,
      charisma: 8,
      challenge_rating: "1/4",
      actions: [
        {
          name: "Scimitar",
          desc: "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage.",
        },
      ],
    };

    const result = normalizeSrdMonster(raw);
    const actions = result.actions as { name: string; entries: string[] }[];
    expect(actions).toBeDefined();
    expect(actions[0].name).toBe("Scimitar");
    expect(actions[0].entries[0]).toContain("`atk:");
    expect(actions[0].entries[0]).toContain("`damage:");
  });
});

describe("normalizeSrdItem", () => {
  it("maps desc to entries array", () => {
    const raw = {
      name: "Bag of Holding",
      type: "Wondrous item",
      rarity: "uncommon",
      desc: "This bag has an interior space.\n\nIt weighs 15 pounds.",
      requires_attunement: "",
    };

    const result = normalizeSrdItem(raw);
    expect(result.entries).toEqual([
      "This bag has an interior space.",
      "It weighs 15 pounds.",
    ]);
    expect(result.attunement).toBe(false);
    expect(result.desc).toBeUndefined();
  });

  it("maps requires_attunement to attunement", () => {
    const result = normalizeSrdItem({
      name: "Test",
      requires_attunement: "requires attunement by a cleric",
    });
    expect(result.attunement).toBe("by a cleric");
  });
});

describe("normalizeSrdSpell", () => {
  it("maps SRD spell fields to plugin schema", () => {
    const raw = {
      name: "Fireball",
      spell_level: 3,
      school: "Evocation",
      casting_time: "1 action",
      range: "150 feet",
      components: "V, S, M",
      duration: "Instantaneous",
      requires_concentration: false,
      can_be_cast_as_ritual: false,
      desc: "A bright streak flashes.\n\nEach creature takes 8d6 fire damage.",
      higher_level: "Damage increases by 1d6 for each slot level above 3rd.",
      dnd_class: "Sorcerer, Wizard",
    };

    const result = normalizeSrdSpell(raw);
    expect(result.name).toBe("Fireball");
    expect(result.level).toBe(3);
    expect(result.school).toBe("Evocation");
    expect(result.concentration).toBe(false);
    expect(result.ritual).toBe(false);
    expect(result.description).toEqual([
      "A bright streak flashes.",
      "Each creature takes 8d6 fire damage.",
    ]);
    expect(result.at_higher_levels).toEqual([
      "Damage increases by 1d6 for each slot level above 3rd.",
    ]);
    expect(result.classes).toEqual(["Sorcerer", "Wizard"]);
  });
});
