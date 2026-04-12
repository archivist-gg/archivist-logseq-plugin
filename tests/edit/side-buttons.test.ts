// tests/edit/side-buttons.test.ts
import { describe, it, expect } from "vitest";
import { renderSideButtons } from "../../src/edit/side-buttons";

describe("renderSideButtons", () => {
  it("renders source + columns + edit + trash for monster in default state", () => {
    const html = renderSideButtons({
      state: "default",
      showColumnToggle: true,
      isColumnActive: false,
      compendiumContext: null,
    });
    expect(html).toContain('data-action="source"');
    expect(html).toContain('data-action="column-toggle"');
    expect(html).toContain('data-action="edit"');
    expect(html).toContain('data-action="trash"');
  });

  it("renders source + edit + trash for spell (no column toggle)", () => {
    const html = renderSideButtons({
      state: "default",
      showColumnToggle: false,
      isColumnActive: false,
      compendiumContext: null,
    });
    expect(html).toContain('data-action="source"');
    expect(html).not.toContain('data-action="column-toggle"');
    expect(html).toContain('data-action="edit"');
    expect(html).toContain('data-action="trash"');
  });

  it("renders save + save-as-new + cancel in editing state with compendium", () => {
    const html = renderSideButtons({
      state: "editing",
      showColumnToggle: false,
      isColumnActive: false,
      compendiumContext: { slug: "goblin", compendium: "SRD", entityType: "monster", readonly: false },
    });
    expect(html).toContain('data-action="save"');
    expect(html).toContain('data-action="save-as-new"');
    expect(html).toContain('data-action="cancel"');
  });

  it("hides save button for readonly compendium", () => {
    const html = renderSideButtons({
      state: "editing",
      showColumnToggle: false,
      isColumnActive: false,
      compendiumContext: { slug: "goblin", compendium: "SRD", entityType: "monster", readonly: true },
    });
    expect(html).not.toContain('data-action="save"');
    expect(html).toContain('data-action="save-as-new"');
    expect(html).toContain('data-action="cancel"');
  });

  it("renders save + cancel without compendium context", () => {
    const html = renderSideButtons({
      state: "editing",
      showColumnToggle: false,
      isColumnActive: false,
      compendiumContext: null,
    });
    expect(html).toContain('data-action="save"');
    expect(html).not.toContain('data-action="save-as-new"');
    expect(html).toContain('data-action="cancel"');
  });
});
