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

  it("renders save + save-as-new + cancel for writable compendium", () => {
    const html = renderSideButtons({
      state: "editing",
      showColumnToggle: false,
      isColumnActive: false,
      compendiumContext: { slug: "goblin", compendium: "Homebrew", entityType: "monster", readonly: false },
    });
    expect(html).toContain('data-action="save"');
    expect(html).toContain('data-action="save-as-new"');
    expect(html).toContain('data-action="cancel"');
    expect(html).not.toContain('data-action="save-to-compendium"');
  });

  it("renders only save-as-new + cancel for readonly compendium", () => {
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

  it("renders save + save-to-compendium + cancel without compendium context", () => {
    const html = renderSideButtons({
      state: "editing",
      showColumnToggle: false,
      isColumnActive: false,
      compendiumContext: null,
    });
    expect(html).toContain('data-action="save"');
    expect(html).toContain('data-action="save-to-compendium"');
    expect(html).toContain('data-action="cancel"');
    expect(html).not.toContain('data-action="save-as-new"');
  });
});
