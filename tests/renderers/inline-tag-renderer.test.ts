import { describe, it, expect } from "vitest";
import { renderInlineTag } from "@/renderers/inline-tag-renderer";

describe("renderInlineTag", () => {
  it("renders a dice tag", () => {
    const html = renderInlineTag({ type: "dice", content: "2d6+3", formula: null });
    expect(html).toContain("archivist-stat-tag");
    expect(html).toContain("archivist-stat-tag-dice");
    expect(html).toContain("2d6+3");
  });

  it("renders an atk tag with 'to hit' format", () => {
    const html = renderInlineTag({ type: "atk", content: "+7", formula: null });
    expect(html).toContain("archivist-stat-tag-atk");
    expect(html).toContain("+7 to hit");
  });

  it("renders a dc tag with 'DC' prefix", () => {
    const html = renderInlineTag({ type: "dc", content: "15", formula: null });
    expect(html).toContain("archivist-stat-tag-dc");
    expect(html).toContain("DC 15");
  });

  it("renders a damage tag", () => {
    const html = renderInlineTag({ type: "damage", content: "3d8+4", formula: null });
    expect(html).toContain("archivist-stat-tag-damage");
    expect(html).toContain("3d8+4");
  });

  it("renders a mod tag", () => {
    const html = renderInlineTag({ type: "mod", content: "+5", formula: null });
    expect(html).toContain("archivist-stat-tag-dice");
    expect(html).toContain("+5");
  });

  it("renders a check tag", () => {
    const html = renderInlineTag({ type: "check", content: "Perception", formula: null });
    expect(html).toContain("archivist-stat-tag-dc");
    expect(html).toContain("Perception");
  });
});
