import { describe, it, expect } from "vitest";
import { renderSpellEditMode } from "../../src/edit/spell-edit-render";

const testSpell = {
  name: "Fireball",
  level: 3,
  school: "Evocation",
  casting_time: "1 action",
  range: "150 feet",
  components: "V, S, M (a tiny ball of bat guano and sulfur)",
  duration: "Instantaneous",
  concentration: false,
  ritual: false,
  description: ["Each creature in a 20-foot-radius sphere must make a Dexterity saving throw."],
  at_higher_levels: ["When you cast this spell using a spell slot of 4th level or higher, the damage increases by 1d6."],
  classes: ["Sorcerer", "Wizard"],
};

describe("renderSpellEditMode", () => {
  it("renders name input", () => {
    const html = renderSpellEditMode(testSpell as any, null);
    expect(html).toContain('data-field="name"');
    expect(html).toContain('value="Fireball"');
  });

  it("renders level and school selects", () => {
    const html = renderSpellEditMode(testSpell as any, null);
    expect(html).toContain('data-field="level"');
    expect(html).toContain('data-field="school"');
  });

  it("renders property inputs", () => {
    const html = renderSpellEditMode(testSpell as any, null);
    expect(html).toContain('data-field="casting_time"');
    expect(html).toContain('data-field="range"');
    expect(html).toContain('data-field="components"');
    expect(html).toContain('data-field="duration"');
  });

  it("renders description textarea", () => {
    const html = renderSpellEditMode(testSpell as any, null);
    expect(html).toContain('data-field="description"');
    expect(html).toContain("20-foot-radius sphere");
  });

  it("adds editing class", () => {
    const html = renderSpellEditMode(testSpell as any, null);
    expect(html).toContain("editing");
  });
});
