import { describe, it, expect } from "vitest";
import {
  el,
  escapeHtml,
  createSvgBar,
  createPropertyLine,
  renderTextWithInlineTags,
  convert5eToolsTags,
  appendMarkdownText,
  renderErrorBlock,
  lucideIcon,
} from "@/renderers/renderer-utils";

describe("escapeHtml", () => {
  it("escapes dangerous characters", () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"
    );
  });

  it("escapes ampersands", () => {
    expect(escapeHtml("A & B")).toBe("A &amp; B");
  });

  it("escapes single quotes", () => {
    expect(escapeHtml("it's")).toBe("it&#39;s");
  });

  it("passes through safe strings", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });
});

describe("el", () => {
  it("creates a simple element", () => {
    expect(el("div", "my-class", "hello")).toBe('<div class="my-class">hello</div>');
  });

  it("handles array content", () => {
    expect(el("div", "wrap", ["<span>a</span>", "<span>b</span>"])).toBe(
      '<div class="wrap"><span>a</span><span>b</span></div>'
    );
  });

  it("handles attributes", () => {
    expect(el("div", "cls", "text", { "data-id": "1" })).toBe(
      '<div class="cls" data-id="1">text</div>'
    );
  });

  it("escapes attribute values", () => {
    expect(el("div", "cls", "", { title: 'a "b" c' })).toBe(
      '<div class="cls" title="a &quot;b&quot; c"></div>'
    );
  });
});

describe("createSvgBar", () => {
  it("returns an SVG string with correct structure", () => {
    const svg = createSvgBar();
    expect(svg).toContain("<svg");
    expect(svg).toContain("stat-block-bar");
    expect(svg).toContain("0,0 400,2.5 0,5");
  });
});

describe("createPropertyLine", () => {
  it("creates a property line", () => {
    const html = createPropertyLine("Armor Class", "18 (plate)");
    expect(html).toContain("property-line");
    expect(html).toContain("Armor Class");
    expect(html).toContain("18 (plate)");
  });

  it("adds 'last' class when isLast is true", () => {
    const html = createPropertyLine("Speed", "30 ft.", true);
    expect(html).toContain("property-line last");
  });
});

describe("lucideIcon", () => {
  it("returns SVG for known icons", () => {
    const svg = lucideIcon("swords");
    expect(svg).toContain("<svg");
    expect(svg).toContain("archivist-icon");
  });

  it("returns empty string for unknown icons", () => {
    expect(lucideIcon("nonexistent")).toBe("");
  });
});

describe("convert5eToolsTags", () => {
  it("converts hit tags", () => {
    expect(convert5eToolsTags("{@hit 7}")).toContain("`atk:+7`");
  });

  it("converts damage tags", () => {
    expect(convert5eToolsTags("{@damage 2d6+4}")).toContain("`damage:2d6+4`");
  });

  it("converts DC tags", () => {
    expect(convert5eToolsTags("{@dc 15}")).toContain("`dc:15`");
  });

  it("converts bold tags", () => {
    expect(convert5eToolsTags("{@b hello}")).toBe("**hello**");
  });

  it("converts attack type labels", () => {
    expect(convert5eToolsTags("{@atk mw}")).toBe("Melee Weapon Attack:");
  });
});

describe("appendMarkdownText", () => {
  it("converts bold", () => {
    expect(appendMarkdownText("**bold**")).toContain("<strong>bold</strong>");
  });

  it("converts italic", () => {
    expect(appendMarkdownText("*italic*")).toContain("<em>italic</em>");
  });

  it("converts links", () => {
    const html = appendMarkdownText("[text](https://example.com)");
    expect(html).toContain('<a href="https://example.com"');
  });

  it("escapes HTML in plain text", () => {
    expect(appendMarkdownText("a <b> c")).toContain("&lt;b&gt;");
  });
});

describe("renderTextWithInlineTags", () => {
  it("renders dice tags as styled pills", () => {
    const html = renderTextWithInlineTags("Deals `dice:2d6` damage");
    expect(html).toContain("archivist-stat-tag");
    expect(html).toContain("2d6");
  });

  it("resolves formula tags with monster context", () => {
    const ctx = {
      abilities: { str: 20, dex: 14, con: 16, int: 10, wis: 12, cha: 8 },
      proficiencyBonus: 4,
    };
    const html = renderTextWithInlineTags("`atk:STR` to hit", true, ctx);
    expect(html).toContain("+9");
  });

  it("passes plain text through", () => {
    expect(renderTextWithInlineTags("plain text")).toBe("plain text");
  });
});

describe("renderErrorBlock", () => {
  it("renders error with message", () => {
    const html = renderErrorBlock("Missing field: name");
    expect(html).toContain("archivist-error-block");
    expect(html).toContain("Missing field: name");
  });
});
