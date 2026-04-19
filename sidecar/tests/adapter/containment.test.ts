import { describe, it, expect } from "vitest";
import { resolveWithinRoot } from "../../src/adapter/NodeFileAdapter.js";
import * as path from "node:path";

const ROOT = "/tmp/bridge-root";

describe("resolveWithinRoot", () => {
  it("accepts a simple relative path", () => {
    expect(resolveWithinRoot(ROOT, "foo.md")).toBe(path.join(ROOT, "foo.md"));
  });

  it("accepts a nested relative path", () => {
    expect(resolveWithinRoot(ROOT, "dir/sub/foo.md")).toBe(path.join(ROOT, "dir/sub/foo.md"));
  });

  it("rejects ../ escape", () => {
    expect(() => resolveWithinRoot(ROOT, "../etc/passwd")).toThrow(/traversal/i);
  });

  it("rejects absolute paths outside root", () => {
    expect(() => resolveWithinRoot(ROOT, "/etc/passwd")).toThrow(/traversal/i);
  });

  it("accepts absolute path exactly equal to root", () => {
    expect(resolveWithinRoot(ROOT, ROOT)).toBe(path.resolve(ROOT));
  });

  it("rejects prefix-sibling (/tmp/bridge-roots)", () => {
    expect(() => resolveWithinRoot(ROOT, "/tmp/bridge-roots/x")).toThrow(/traversal/i);
  });
});
