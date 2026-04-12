// tests/entities/entity-vault-store.test.ts
import { describe, it, expect } from "vitest";
import {
  slugify,
  ensureUniqueSlug,
  generateEntityMarkdown,
  parseEntityFile,
  TYPE_FOLDER_MAP,
} from "@/entities/entity-vault-store";

describe("slugify", () => {
  it("converts name to kebab-case", () => {
    expect(slugify("Ancient Red Dragon")).toBe("ancient-red-dragon");
  });

  it("strips non-alphanumeric characters", () => {
    expect(slugify("Potion of Healing (Greater)")).toBe("potion-of-healing-greater");
  });

  it("collapses multiple hyphens", () => {
    expect(slugify("Staff  of  Power")).toBe("staff-of-power");
  });
});

describe("ensureUniqueSlug", () => {
  it("returns slug unchanged if unique", () => {
    expect(ensureUniqueSlug("goblin", new Set(["orc"]))).toBe("goblin");
  });

  it("appends -custom on collision", () => {
    expect(ensureUniqueSlug("goblin", new Set(["goblin"]))).toBe("goblin-custom");
  });

  it("appends -custom-2 on double collision", () => {
    expect(ensureUniqueSlug("goblin", new Set(["goblin", "goblin-custom"]))).toBe("goblin-custom-2");
  });
});

describe("generateEntityMarkdown / parseEntityFile roundtrip", () => {
  it("generates markdown and parses it back", () => {
    const entity = {
      slug: "goblin",
      name: "Goblin",
      entityType: "monster",
      compendium: "SRD",
      data: { name: "Goblin", cr: "1/4", size: "Small" },
    };

    const markdown = generateEntityMarkdown(entity);
    expect(markdown).toContain("archivist: true");
    expect(markdown).toContain("```monster");

    const parsed = parseEntityFile(markdown);
    expect(parsed).not.toBeNull();
    expect(parsed!.slug).toBe("goblin");
    expect(parsed!.name).toBe("Goblin");
    expect(parsed!.entityType).toBe("monster");
    expect(parsed!.compendium).toBe("SRD");
    expect(parsed!.data.cr).toBe("1/4");
  });
});

describe("TYPE_FOLDER_MAP", () => {
  it("maps monster to Monsters", () => {
    expect(TYPE_FOLDER_MAP["monster"]).toBe("Monsters");
  });

  it("maps magic-item to Magic Items", () => {
    expect(TYPE_FOLDER_MAP["magic-item"]).toBe("Magic Items");
  });
});
