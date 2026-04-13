import { describe, it, expect } from "vitest";
import { findInlineTagRanges } from "@/extensions/inline-tag-extension";

describe("findInlineTagRanges", () => {
  it("finds a dice tag in text", () => {
    const text = "Roll `dice:2d6+3` for damage";
    const ranges = findInlineTagRanges(text, 0);
    expect(ranges).toEqual([
      { from: 5, to: 17, tagText: "dice:2d6+3" },
    ]);
  });

  it("finds multiple tags in text", () => {
    const text = "`atk:+7` to hit, `damage:2d6+4` slashing";
    const ranges = findInlineTagRanges(text, 0);
    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toEqual({ from: 0, to: 8, tagText: "atk:+7" });
    expect(ranges[1]).toEqual({ from: 17, to: 31, tagText: "damage:2d6+4" });
  });

  it("ignores regular code spans that are not inline tags", () => {
    const text = "`const x = 5` and `dice:1d6`";
    const ranges = findInlineTagRanges(text, 0);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].tagText).toBe("dice:1d6");
  });

  it("applies offset to positions", () => {
    const text = "`dc:15`";
    const ranges = findInlineTagRanges(text, 100);
    expect(ranges).toEqual([
      { from: 100, to: 107, tagText: "dc:15" },
    ]);
  });

  it("returns empty for text with no tags", () => {
    const text = "No tags here, just `regular code`";
    const ranges = findInlineTagRanges(text, 0);
    expect(ranges).toEqual([]);
  });

  it("handles all supported tag types", () => {
    const text = "`dice:1d20` `atk:+5` `dc:14` `damage:3d8` `mod:+3` `check:Perception`";
    const ranges = findInlineTagRanges(text, 0);
    expect(ranges).toHaveLength(6);
  });
});
