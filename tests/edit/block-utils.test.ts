// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { findBlockUuid } from "../../src/edit/block-utils";

describe("findBlockUuid", () => {
  it("finds blockid from ancestor .ls-block element", () => {
    const block = document.createElement("div");
    block.classList.add("ls-block");
    block.setAttribute("blockid", "abc-123-def");
    const inner = document.createElement("div");
    const target = document.createElement("div");
    inner.appendChild(target);
    block.appendChild(inner);

    expect(findBlockUuid(target)).toBe("abc-123-def");
  });

  it("returns null when no .ls-block ancestor exists", () => {
    const orphan = document.createElement("div");
    expect(findBlockUuid(orphan)).toBeNull();
  });

  it("finds nearest .ls-block in nested structure", () => {
    const outer = document.createElement("div");
    outer.classList.add("ls-block");
    outer.setAttribute("blockid", "outer-id");
    const inner = document.createElement("div");
    inner.classList.add("ls-block");
    inner.setAttribute("blockid", "inner-id");
    const target = document.createElement("div");
    inner.appendChild(target);
    outer.appendChild(inner);

    expect(findBlockUuid(target)).toBe("inner-id");
  });
});
