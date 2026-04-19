import { describe, it, expect } from "vitest";
import { appendMarkdownText } from "../../src/renderers/renderer-utils";

describe("appendMarkdownText URL scheme allowlist", () => {
  it("renders https links as anchors with rel=noopener", () => {
    const html = appendMarkdownText("[ok](https://example.com)");
    expect(html).toContain(`href="https://example.com"`);
    expect(html).toContain(`rel="noopener"`);
    expect(html).toContain(`target="_blank"`);
    expect(html).toContain(">ok</a>");
  });

  it("renders mailto links", () => {
    const html = appendMarkdownText("[me](mailto:a@b.test)");
    expect(html).toContain(`href="mailto:a@b.test"`);
    expect(html).toContain(">me</a>");
  });

  it("renders in-doc anchors", () => {
    const html = appendMarkdownText("[top](#anchor)");
    expect(html).toContain(`href="#anchor"`);
    expect(html).toContain(">top</a>");
  });

  it("degrades javascript: URLs to plain text (no anchor)", () => {
    // Fixture avoids nested parens so the upstream link regex doesn't capture
    // a truncated URL — the security property (scheme blocking) is what the
    // test asserts, independent of payload body.
    const html = appendMarkdownText("[x](javascript:alert)");
    expect(html).not.toContain("<a ");
    expect(html).toBe("x");
  });

  it("degrades data: URLs to plain text", () => {
    const html = appendMarkdownText("[x](data:text/html,notascript)");
    expect(html).not.toContain("<a ");
    expect(html).toBe("x");
  });

  it("degrades vbscript: URLs to plain text", () => {
    const html = appendMarkdownText("[x](vbscript:msgbox)");
    expect(html).not.toContain("<a ");
    expect(html).toBe("x");
  });

  it("degrades obsidian: URLs to plain text (cross-vault vector)", () => {
    const html = appendMarkdownText("[x](obsidian://open?vault=Evil)");
    expect(html).not.toContain("<a ");
    expect(html).toBe("x");
  });
});
