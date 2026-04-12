# Phase 2: Entity & Compendium System -- Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the entity registry, compendium storage, SRD import, and entity search from the Obsidian plugin to Logseq using namespaced pages, Datascript queries, and command palette actions.

**Architecture:** Portable pure-logic modules (EntityRegistry, SrdStore, normalizers, tag converter) are copied verbatim from archivist-obsidian. CompendiumManager is rewritten to use Logseq's page/block API instead of Obsidian's Vault API. Entity pages use Logseq namespaces (`SRD/Monsters/Goblin`) with page properties for discoverability. Users reference entities via native `[[]]` links and `{{embed}}` -- no custom renderer macro needed.

**Tech Stack:** TypeScript, Vite, `@logseq/libs`, `js-yaml`, Vitest

**Source project:** `/Users/shinoobi/w/archivist-obsidian/src/`
**Target project:** `/Users/shinoobi/w/archivist-logseq/src/`

---

### Task 1: Copy EntityRegistry

**Files:**
- Create: `src/entities/entity-registry.ts`
- Test: `tests/entities/entity-registry.test.ts`

- [ ] **Step 1: Copy the file verbatim**

Copy from archivist-obsidian. This file is pure logic with zero platform dependencies.

```bash
mkdir -p /Users/shinoobi/w/archivist-logseq/src/entities
cp /Users/shinoobi/w/archivist-obsidian/src/entities/entity-registry.ts /Users/shinoobi/w/archivist-logseq/src/entities/entity-registry.ts
```

- [ ] **Step 2: Write verification tests**

```typescript
// tests/entities/entity-registry.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { EntityRegistry, RegisteredEntity } from "@/entities/entity-registry";

function makeEntity(overrides: Partial<RegisteredEntity> = {}): RegisteredEntity {
  return {
    slug: "goblin",
    name: "Goblin",
    entityType: "monster",
    filePath: "SRD/Monsters/Goblin",
    data: { name: "Goblin", cr: "1/4" },
    compendium: "SRD",
    readonly: true,
    homebrew: false,
    ...overrides,
  };
}

describe("EntityRegistry", () => {
  let registry: EntityRegistry;

  beforeEach(() => {
    registry = new EntityRegistry();
  });

  it("registers and retrieves by slug", () => {
    const entity = makeEntity();
    registry.register(entity);
    expect(registry.getBySlug("goblin")).toEqual(entity);
    expect(registry.count()).toBe(1);
  });

  it("replaces entity with same slug", () => {
    registry.register(makeEntity());
    const updated = makeEntity({ data: { name: "Goblin", cr: "1" } });
    registry.register(updated);
    expect(registry.count()).toBe(1);
    expect(registry.getBySlug("goblin")!.data.cr).toBe("1");
  });

  it("unregisters by slug", () => {
    registry.register(makeEntity());
    registry.unregister("goblin");
    expect(registry.getBySlug("goblin")).toBeUndefined();
    expect(registry.count()).toBe(0);
  });

  it("searches with ranking: exact > prefix > contains", () => {
    registry.register(makeEntity({ slug: "goblin", name: "Goblin" }));
    registry.register(makeEntity({ slug: "goblin-boss", name: "Goblin Boss" }));
    registry.register(makeEntity({ slug: "hobgoblin", name: "Hobgoblin" }));

    const results = registry.search("goblin");
    expect(results[0].slug).toBe("goblin"); // exact
    expect(results[1].slug).toBe("goblin-boss"); // prefix
    expect(results[2].slug).toBe("hobgoblin"); // contains
  });

  it("searches filtered by entityType", () => {
    registry.register(makeEntity({ slug: "goblin", name: "Goblin", entityType: "monster" }));
    registry.register(makeEntity({ slug: "fireball", name: "Fireball", entityType: "spell" }));

    const monsters = registry.search("", "monster");
    expect(monsters.length).toBe(1);
    expect(monsters[0].slug).toBe("goblin");
  });

  it("returns all type strings", () => {
    registry.register(makeEntity({ slug: "goblin", entityType: "monster" }));
    registry.register(makeEntity({ slug: "fireball", entityType: "spell" }));
    expect(registry.getTypes().sort()).toEqual(["monster", "spell"]);
  });

  it("clears all entries", () => {
    registry.register(makeEntity());
    registry.clear();
    expect(registry.count()).toBe(0);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/shinoobi/w/archivist-logseq && npx vitest run tests/entities/entity-registry.test.ts
```

Expected: All 7 tests pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/shinoobi/w/archivist-logseq
git add src/entities/entity-registry.ts tests/entities/entity-registry.test.ts
git commit -m "feat: copy EntityRegistry from archivist-obsidian with tests"
```

---

### Task 2: Copy entity-vault-store utilities

**Files:**
- Create: `src/entities/entity-vault-store.ts`
- Test: `tests/entities/entity-vault-store.test.ts`

- [ ] **Step 1: Copy the file verbatim**

```bash
cp /Users/shinoobi/w/archivist-obsidian/src/entities/entity-vault-store.ts /Users/shinoobi/w/archivist-logseq/src/entities/entity-vault-store.ts
```

- [ ] **Step 2: Write verification tests**

```typescript
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
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/shinoobi/w/archivist-logseq && npx vitest run tests/entities/entity-vault-store.test.ts
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/shinoobi/w/archivist-logseq
git add src/entities/entity-vault-store.ts tests/entities/entity-vault-store.test.ts
git commit -m "feat: copy entity-vault-store utilities from archivist-obsidian with tests"
```

---

### Task 3: Copy SRD normalizers and tag converter

**Files:**
- Create: `src/entities/srd-normalizer.ts`
- Create: `src/entities/srd-tag-converter.ts`
- Test: `tests/entities/srd-normalizer.test.ts`

- [ ] **Step 1: Copy both files verbatim**

```bash
cp /Users/shinoobi/w/archivist-obsidian/src/entities/srd-normalizer.ts /Users/shinoobi/w/archivist-logseq/src/entities/srd-normalizer.ts
cp /Users/shinoobi/w/archivist-obsidian/src/entities/srd-tag-converter.ts /Users/shinoobi/w/archivist-logseq/src/entities/srd-tag-converter.ts
```

Import paths (`"./srd-tag-converter"` and `"../dnd/math"`) already resolve correctly -- `dnd/` is at `src/dnd/` in both projects.

- [ ] **Step 2: Write verification tests**

```typescript
// tests/entities/srd-normalizer.test.ts
import { describe, it, expect } from "vitest";
import {
  normalizeSrdMonster,
  normalizeSrdItem,
  normalizeSrdSpell,
} from "@/entities/srd-normalizer";

describe("normalizeSrdMonster", () => {
  it("maps SRD fields to plugin schema", () => {
    const raw = {
      name: "Goblin",
      size: "Small",
      type: "humanoid",
      alignment: "neutral evil",
      armor_class: 15,
      armor_desc: "leather armor, shield",
      hit_points: 7,
      hit_dice: "2d6",
      speed: { walk: 30 },
      strength: 8,
      dexterity: 14,
      constitution: 10,
      intelligence: 10,
      wisdom: 8,
      charisma: 8,
      challenge_rating: "1/4",
      senses: "darkvision 60 ft., passive Perception 9",
      languages: "Common, Goblin",
    };

    const result = normalizeSrdMonster(raw);
    expect(result.name).toBe("Goblin");
    expect(result.size).toBe("Small");
    expect(result.ac).toEqual([{ ac: 15, from: ["leather armor, shield"] }]);
    expect(result.hp).toEqual({ average: 7, formula: "2d6" });
    expect(result.speed).toEqual({ walk: 30 });
    expect((result.abilities as any).str).toBe(8);
    expect((result.abilities as any).dex).toBe(14);
    expect(result.cr).toBe("1/4");
    expect(result.senses).toEqual(["darkvision 60 ft."]);
    expect(result.passive_perception).toBe(9);
    expect(result.languages).toEqual(["Common", "Goblin"]);
  });

  it("normalizes actions with tag conversion", () => {
    const raw = {
      name: "Goblin",
      strength: 8,
      dexterity: 14,
      constitution: 10,
      intelligence: 10,
      wisdom: 8,
      charisma: 8,
      challenge_rating: "1/4",
      actions: [
        {
          name: "Scimitar",
          desc: "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage.",
        },
      ],
    };

    const result = normalizeSrdMonster(raw);
    const actions = result.actions as { name: string; entries: string[] }[];
    expect(actions).toBeDefined();
    expect(actions[0].name).toBe("Scimitar");
    expect(actions[0].entries[0]).toContain("`atk:");
    expect(actions[0].entries[0]).toContain("`damage:");
  });
});

describe("normalizeSrdItem", () => {
  it("maps desc to entries array", () => {
    const raw = {
      name: "Bag of Holding",
      type: "Wondrous item",
      rarity: "uncommon",
      desc: "This bag has an interior space.\n\nIt weighs 15 pounds.",
      requires_attunement: "",
    };

    const result = normalizeSrdItem(raw);
    expect(result.entries).toEqual([
      "This bag has an interior space.",
      "It weighs 15 pounds.",
    ]);
    expect(result.attunement).toBe(false);
    expect(result.desc).toBeUndefined();
  });

  it("maps requires_attunement to attunement", () => {
    const result = normalizeSrdItem({
      name: "Test",
      requires_attunement: "requires attunement by a cleric",
    });
    expect(result.attunement).toBe("by a cleric");
  });
});

describe("normalizeSrdSpell", () => {
  it("maps SRD spell fields to plugin schema", () => {
    const raw = {
      name: "Fireball",
      spell_level: 3,
      school: "Evocation",
      casting_time: "1 action",
      range: "150 feet",
      components: "V, S, M",
      duration: "Instantaneous",
      requires_concentration: false,
      can_be_cast_as_ritual: false,
      desc: "A bright streak flashes.\n\nEach creature takes 8d6 fire damage.",
      higher_level: "Damage increases by 1d6 for each slot level above 3rd.",
      dnd_class: "Sorcerer, Wizard",
    };

    const result = normalizeSrdSpell(raw);
    expect(result.name).toBe("Fireball");
    expect(result.level).toBe(3);
    expect(result.school).toBe("Evocation");
    expect(result.concentration).toBe(false);
    expect(result.ritual).toBe(false);
    expect(result.description).toEqual([
      "A bright streak flashes.",
      "Each creature takes 8d6 fire damage.",
    ]);
    expect(result.at_higher_levels).toEqual([
      "Damage increases by 1d6 for each slot level above 3rd.",
    ]);
    expect(result.classes).toEqual(["Sorcerer", "Wizard"]);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/shinoobi/w/archivist-logseq && npx vitest run tests/entities/srd-normalizer.test.ts
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/shinoobi/w/archivist-logseq
git add src/entities/srd-normalizer.ts src/entities/srd-tag-converter.ts tests/entities/srd-normalizer.test.ts
git commit -m "feat: copy SRD normalizers and tag converter from archivist-obsidian with tests"
```

---

### Task 4: Copy SrdStore and SRD JSON data

**Files:**
- Create: `src/srd/srd-store.ts` (adapted -- `require()` to `import`)
- Create: `src/srd/data/monsters.json` (and 8 other JSON files)
- Test: `tests/srd/srd-store.test.ts`

- [ ] **Step 1: Copy the JSON data files**

```bash
mkdir -p /Users/shinoobi/w/archivist-logseq/src/srd/data
cp /Users/shinoobi/w/archivist-obsidian/src/srd/data/monsters.json /Users/shinoobi/w/archivist-logseq/src/srd/data/
cp /Users/shinoobi/w/archivist-obsidian/src/srd/data/spells.json /Users/shinoobi/w/archivist-logseq/src/srd/data/
cp /Users/shinoobi/w/archivist-obsidian/src/srd/data/magicitems.json /Users/shinoobi/w/archivist-logseq/src/srd/data/
cp /Users/shinoobi/w/archivist-obsidian/src/srd/data/armor.json /Users/shinoobi/w/archivist-logseq/src/srd/data/
cp /Users/shinoobi/w/archivist-obsidian/src/srd/data/weapons.json /Users/shinoobi/w/archivist-logseq/src/srd/data/
cp /Users/shinoobi/w/archivist-obsidian/src/srd/data/feats.json /Users/shinoobi/w/archivist-logseq/src/srd/data/
cp /Users/shinoobi/w/archivist-obsidian/src/srd/data/conditions.json /Users/shinoobi/w/archivist-logseq/src/srd/data/
cp /Users/shinoobi/w/archivist-obsidian/src/srd/data/classes.json /Users/shinoobi/w/archivist-logseq/src/srd/data/
cp /Users/shinoobi/w/archivist-obsidian/src/srd/data/backgrounds.json /Users/shinoobi/w/archivist-logseq/src/srd/data/
```

- [ ] **Step 2: Create adapted SrdStore with ES imports**

The Obsidian version uses `require()` to load JSON. For Vite bundling, we use ES `import`. The rest of the logic is identical.

```typescript
// src/srd/srd-store.ts
import monstersData from "./data/monsters.json";
import spellsData from "./data/spells.json";
import magicitemsData from "./data/magicitems.json";
import armorData from "./data/armor.json";
import weaponsData from "./data/weapons.json";
import featsData from "./data/feats.json";
import conditionsData from "./data/conditions.json";
import classesData from "./data/classes.json";
import backgroundsData from "./data/backgrounds.json";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SrdEntity {
  slug: string;
  name: string;
  entityType: string;
  data: Record<string, unknown>;
}

export type SrdEntityType =
  | "monster"
  | "spell"
  | "magic-item"
  | "armor"
  | "weapon"
  | "feat"
  | "condition"
  | "class"
  | "background";

export type SrdDataSources = Record<string, Record<string, unknown>[]>;

const TYPE_MAP: Record<string, SrdEntityType> = {
  monsters: "monster",
  spells: "spell",
  magicitems: "magic-item",
  armor: "armor",
  weapons: "weapon",
  feats: "feat",
  conditions: "condition",
  classes: "class",
  backgrounds: "background",
};

// ---------------------------------------------------------------------------
// SrdStore
// ---------------------------------------------------------------------------

export class SrdStore {
  private bySlug = new Map<string, SrdEntity>();
  private byType = new Map<string, SrdEntity[]>();

  loadFromData(sources: SrdDataSources): void {
    this.bySlug.clear();
    this.byType.clear();

    for (const [sourceKey, items] of Object.entries(sources)) {
      const entityType = TYPE_MAP[sourceKey];
      if (!entityType) continue;

      const bucket: SrdEntity[] = [];

      for (const raw of items) {
        const slug = String(raw.slug ?? "");
        const name = String(raw.name ?? "");
        if (!slug || !name) continue;

        const entity: SrdEntity = { slug, name, entityType, data: raw };
        this.bySlug.set(slug, entity);
        bucket.push(entity);
      }

      if (bucket.length > 0) {
        this.byType.set(entityType, bucket);
      }
    }
  }

  loadFromBundledJson(): void {
    const sources: SrdDataSources = {
      monsters: monstersData as unknown as Record<string, unknown>[],
      spells: spellsData as unknown as Record<string, unknown>[],
      magicitems: magicitemsData as unknown as Record<string, unknown>[],
      armor: armorData as unknown as Record<string, unknown>[],
      weapons: weaponsData as unknown as Record<string, unknown>[],
      feats: featsData as unknown as Record<string, unknown>[],
      conditions: conditionsData as unknown as Record<string, unknown>[],
      classes: classesData as unknown as Record<string, unknown>[],
      backgrounds: backgroundsData as unknown as Record<string, unknown>[],
    };
    this.loadFromData(sources);
  }

  getBySlug(slug: string): SrdEntity | undefined {
    return this.bySlug.get(slug);
  }

  search(query: string, entityType?: string, limit = 20): SrdEntity[] {
    const q = query.toLowerCase();
    const pool = entityType
      ? (this.byType.get(entityType) ?? [])
      : Array.from(this.bySlug.values());

    const matches = pool
      .filter((e) => e.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();
        if (aName === q && bName !== q) return -1;
        if (bName === q && aName !== q) return 1;
        if (aName.startsWith(q) && !bName.startsWith(q)) return -1;
        if (bName.startsWith(q) && !aName.startsWith(q)) return 1;
        return aName.localeCompare(bName);
      });

    return matches.slice(0, limit);
  }

  getAllOfType(entityType: string): SrdEntity[] {
    return this.byType.get(entityType) ?? [];
  }

  getTypes(): string[] {
    return Array.from(this.byType.keys());
  }

  count(): number {
    return this.bySlug.size;
  }
}
```

- [ ] **Step 3: Write verification tests**

```typescript
// tests/srd/srd-store.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { SrdStore } from "@/srd/srd-store";

describe("SrdStore", () => {
  let store: SrdStore;

  beforeEach(() => {
    store = new SrdStore();
  });

  it("loads from inline data", () => {
    store.loadFromData({
      monsters: [
        { slug: "goblin", name: "Goblin", size: "Small" },
        { slug: "orc", name: "Orc", size: "Medium" },
      ],
    });
    expect(store.count()).toBe(2);
    expect(store.getBySlug("goblin")?.name).toBe("Goblin");
    expect(store.getBySlug("goblin")?.entityType).toBe("monster");
  });

  it("loads from bundled JSON", () => {
    store.loadFromBundledJson();
    expect(store.count()).toBeGreaterThan(300);
    expect(store.getTypes().length).toBeGreaterThanOrEqual(5);

    const goblin = store.getBySlug("goblin");
    expect(goblin).toBeDefined();
    expect(goblin!.name).toBe("Goblin");
    expect(goblin!.entityType).toBe("monster");
  });

  it("searches with ranking", () => {
    store.loadFromData({
      monsters: [
        { slug: "goblin", name: "Goblin" },
        { slug: "goblin-boss", name: "Goblin Boss" },
        { slug: "hobgoblin", name: "Hobgoblin" },
      ],
    });

    const results = store.search("goblin");
    expect(results[0].slug).toBe("goblin");
    expect(results[1].slug).toBe("goblin-boss");
    expect(results[2].slug).toBe("hobgoblin");
  });

  it("searches filtered by type", () => {
    store.loadFromBundledJson();
    const monsters = store.search("dragon", "monster", 5);
    expect(monsters.length).toBeGreaterThan(0);
    expect(monsters.every((e) => e.entityType === "monster")).toBe(true);
  });

  it("getAllOfType returns all entities of a type", () => {
    store.loadFromBundledJson();
    const spells = store.getAllOfType("spell");
    expect(spells.length).toBeGreaterThan(100);
  });
});
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/shinoobi/w/archivist-logseq && npx vitest run tests/srd/srd-store.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/shinoobi/w/archivist-logseq
git add src/srd/ tests/srd/srd-store.test.ts
git commit -m "feat: add SrdStore with ES imports and bundled SRD JSON data"
```

---

### Task 5: Copy compendium-ref-parser

**Files:**
- Create: `src/extensions/compendium-ref-parser.ts`
- Test: `tests/extensions/compendium-ref-parser.test.ts`

- [ ] **Step 1: Copy the file**

```bash
mkdir -p /Users/shinoobi/w/archivist-logseq/src/extensions
cp /Users/shinoobi/w/archivist-obsidian/src/extensions/compendium-ref-parser.ts /Users/shinoobi/w/archivist-logseq/src/extensions/compendium-ref-parser.ts
```

- [ ] **Step 2: Write verification tests**

```typescript
// tests/extensions/compendium-ref-parser.test.ts
import { describe, it, expect } from "vitest";
import { parseCompendiumRef } from "@/extensions/compendium-ref-parser";

describe("parseCompendiumRef", () => {
  it("parses typed ref", () => {
    const result = parseCompendiumRef("{{monster:goblin}}");
    expect(result).toEqual({ entityType: "monster", slug: "goblin" });
  });

  it("parses untyped ref", () => {
    const result = parseCompendiumRef("{{goblin}}");
    expect(result).toEqual({ entityType: null, slug: "goblin" });
  });

  it("returns null for invalid format", () => {
    expect(parseCompendiumRef("not a ref")).toBeNull();
    expect(parseCompendiumRef("{{}}")).toBeNull();
  });

  it("rejects invalid type prefix", () => {
    const result = parseCompendiumRef("{{dragon:goblin}}");
    expect(result).toEqual({ entityType: null, slug: "dragon:goblin" });
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/shinoobi/w/archivist-logseq && npx vitest run tests/extensions/compendium-ref-parser.test.ts
```

Expected: All 4 tests pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/shinoobi/w/archivist-logseq
git add src/extensions/compendium-ref-parser.ts tests/extensions/compendium-ref-parser.test.ts
git commit -m "feat: copy compendium-ref-parser from archivist-obsidian with tests"
```

---

### Task 6: Write CompendiumManager for Logseq

This is the core rewrite. Replaces Obsidian Vault API calls with Logseq page/block API.

**Files:**
- Create: `src/entities/compendium-manager.ts`
- Test: `tests/entities/compendium-manager.test.ts`

- [ ] **Step 1: Write tests first (mocking Logseq API)**

```typescript
// tests/entities/compendium-manager.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { CompendiumManager } from "@/entities/compendium-manager";
import { EntityRegistry } from "@/entities/entity-registry";

function createMockLogseqApi() {
  const pages = new Map<string, { name: string; properties: Record<string, any>; blocks: { uuid: string; content: string }[] }>();

  return {
    Editor: {
      getPage: vi.fn(async (name: string) => {
        const page = pages.get(name.toLowerCase());
        return page ? { name: page.name, originalName: page.name, properties: page.properties } : null;
      }),
      createPage: vi.fn(async (name: string, properties: Record<string, any>) => {
        const page = { name, properties, blocks: [] };
        pages.set(name.toLowerCase(), page);
        return { name, originalName: name, properties };
      }),
      deletePage: vi.fn(async (name: string) => {
        pages.delete(name.toLowerCase());
      }),
      getPageBlocksTree: vi.fn(async (name: string) => {
        const page = pages.get(name.toLowerCase());
        if (!page) return [];
        return page.blocks.map((b) => ({ uuid: b.uuid, content: b.content }));
      }),
      appendBlockInPage: vi.fn(async (name: string, content: string) => {
        const page = pages.get(name.toLowerCase());
        if (page) {
          const block = { uuid: `block-${Date.now()}`, content };
          page.blocks.push(block);
          return block;
        }
        return null;
      }),
      updateBlock: vi.fn(async () => {}),
    },
    DB: {
      datascriptQuery: vi.fn(async () => []),
    },
    UI: {
      showMsg: vi.fn(async () => ""),
    },
    _pages: pages,
  };
}

describe("CompendiumManager", () => {
  let registry: EntityRegistry;
  let mockApi: ReturnType<typeof createMockLogseqApi>;
  let manager: CompendiumManager;

  beforeEach(() => {
    registry = new EntityRegistry();
    mockApi = createMockLogseqApi();
    manager = new CompendiumManager(registry, mockApi as any);
  });

  it("creates a compendium page with correct properties", async () => {
    const comp = await manager.create("Homebrew", "My custom content", true, false);
    expect(comp.name).toBe("Homebrew");
    expect(comp.homebrew).toBe(true);
    expect(comp.readonly).toBe(false);

    expect(mockApi.Editor.createPage).toHaveBeenCalledWith(
      "Homebrew",
      expect.objectContaining({
        "archivist-compendium": true,
        "compendium-description": "My custom content",
        "compendium-readonly": false,
        "compendium-homebrew": true,
      }),
      expect.objectContaining({ redirect: false }),
    );
  });

  it("saves an entity as a namespaced page", async () => {
    await manager.create("SRD", "System Reference Document", false, true);

    const entity = await manager.saveEntity("SRD", "monster", {
      name: "Goblin",
      cr: "1/4",
    });

    expect(entity.slug).toBe("goblin");
    expect(entity.name).toBe("Goblin");
    expect(entity.entityType).toBe("monster");
    expect(entity.compendium).toBe("SRD");
    expect(registry.getBySlug("goblin")).toBeDefined();

    expect(mockApi.Editor.createPage).toHaveBeenCalledWith(
      "SRD/Monsters/Goblin",
      expect.objectContaining({
        archivist: true,
        "entity-type": "monster",
        slug: "goblin",
        name: "Goblin",
        compendium: "SRD",
      }),
      expect.objectContaining({ redirect: false }),
    );

    expect(mockApi.Editor.appendBlockInPage).toHaveBeenCalledWith(
      "SRD/Monsters/Goblin",
      expect.stringContaining("```monster"),
    );
  });

  it("deletes an entity page and unregisters it", async () => {
    await manager.create("SRD", "SRD", false, true);
    await manager.saveEntity("SRD", "monster", { name: "Goblin" });

    expect(registry.getBySlug("goblin")).toBeDefined();

    await manager.deleteEntity("goblin");
    expect(registry.getBySlug("goblin")).toBeUndefined();
    expect(mockApi.Editor.deletePage).toHaveBeenCalledWith("SRD/Monsters/Goblin");
  });

  it("getAll returns all compendiums", async () => {
    await manager.create("SRD", "SRD", false, true);
    await manager.create("Homebrew", "Custom", true, false);

    const all = manager.getAll();
    expect(all.length).toBe(2);
  });

  it("getWritable excludes readonly compendiums", async () => {
    await manager.create("SRD", "SRD", false, true);
    await manager.create("Homebrew", "Custom", true, false);

    const writable = manager.getWritable();
    expect(writable.length).toBe(1);
    expect(writable[0].name).toBe("Homebrew");
  });

  it("throws when saving to nonexistent compendium", async () => {
    await expect(
      manager.saveEntity("Nonexistent", "monster", { name: "Goblin" }),
    ).rejects.toThrow("Compendium not found");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/shinoobi/w/archivist-logseq && npx vitest run tests/entities/compendium-manager.test.ts
```

Expected: FAIL -- module not found.

- [ ] **Step 3: Implement CompendiumManager**

Create `src/entities/compendium-manager.ts` with the full implementation. The file defines:

- `Compendium` interface (name, description, readonly, homebrew)
- `LogseqApi` interface (typed subset of the Logseq API used by this module)
- Helper functions: `buildEntityPageName()`, `sanitizePageName()`, `codeBlockLang()`, `buildFencedCodeBlock()`, `extractYamlFromBlock()`
- `CompendiumManager` class with methods: `getAll()`, `getWritable()`, `getByName()`, `addCompendium()`, `discover()`, `loadAllEntities()`, `create()`, `saveEntity()`, `updateEntity()`, `deleteEntity()`, `countReferences()`

Key implementation details:
- Constructor takes `(registry: EntityRegistry, api: LogseqApi)` -- no Vault dependency
- `discover()` uses Datascript query to find pages with `archivist-compendium:: true`
- `loadAllEntities()` uses Datascript query to find pages with `archivist:: true`, reads first block for YAML
- `saveEntity()` calls `createPage()` with properties + `appendBlockInPage()` with fenced code block
- `buildEntityPageName("SRD", "monster", "Goblin")` returns `"SRD/Monsters/Goblin"`
- `buildFencedCodeBlock("monster", data)` returns `` ```monster\n{yaml}\n``` ``
- `extractYamlFromBlock(content)` parses fenced code block content from a block string

Full code is in the spec at `docs/superpowers/specs/2026-04-12-logseq-port-phase2-entity-compendium-design.md`, CompendiumManager Rewrite section. Use the Obsidian version at `archivist-obsidian/src/entities/compendium-manager.ts` as a reference for the public interface -- all method signatures stay the same, only the internals change.

- [ ] **Step 4: Run tests**

```bash
cd /Users/shinoobi/w/archivist-logseq && npx vitest run tests/entities/compendium-manager.test.ts
```

Expected: All 6 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/shinoobi/w/archivist-logseq
git add src/entities/compendium-manager.ts tests/entities/compendium-manager.test.ts
git commit -m "feat: add CompendiumManager rewritten for Logseq page/block API"
```

---

### Task 7: Write entity-importer for Logseq

**Files:**
- Create: `src/entities/entity-importer.ts`
- Test: `tests/entities/entity-importer.test.ts`

- [ ] **Step 1: Write tests first**

```typescript
// tests/entities/entity-importer.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { importSrdToLogseq } from "@/entities/entity-importer";
import { SrdStore } from "@/srd/srd-store";
import { EntityRegistry } from "@/entities/entity-registry";
import { CompendiumManager } from "@/entities/compendium-manager";

function createMockLogseqApi() {
  const pages = new Map<string, any>();

  return {
    Editor: {
      getPage: vi.fn(async (name: string) => pages.get(name.toLowerCase()) ?? null),
      createPage: vi.fn(async (name: string, properties: any) => {
        const page = { name, originalName: name, properties, blocks: [] };
        pages.set(name.toLowerCase(), page);
        return page;
      }),
      deletePage: vi.fn(async () => {}),
      getPageBlocksTree: vi.fn(async (name: string) => {
        const page = pages.get(name.toLowerCase());
        return page?.blocks ?? [];
      }),
      appendBlockInPage: vi.fn(async (name: string, content: string) => {
        const page = pages.get(name.toLowerCase());
        if (page) {
          const block = { uuid: `block-${Math.random()}`, content };
          page.blocks.push(block);
          return block;
        }
        return null;
      }),
      updateBlock: vi.fn(async () => {}),
    },
    DB: { datascriptQuery: vi.fn(async () => []) },
    UI: { showMsg: vi.fn(async () => "") },
    _pages: pages,
  };
}

describe("importSrdToLogseq", () => {
  let srdStore: SrdStore;
  let registry: EntityRegistry;
  let manager: CompendiumManager;
  let mockApi: ReturnType<typeof createMockLogseqApi>;

  beforeEach(() => {
    srdStore = new SrdStore();
    srdStore.loadFromData({
      monsters: [
        { slug: "goblin", name: "Goblin", size: "Small", type: "humanoid", strength: 8, dexterity: 14, constitution: 10, intelligence: 10, wisdom: 8, charisma: 8, challenge_rating: "1/4" },
        { slug: "orc", name: "Orc", size: "Medium", type: "humanoid", strength: 16, dexterity: 12, constitution: 16, intelligence: 7, wisdom: 11, charisma: 10, challenge_rating: "1/2" },
      ],
      spells: [
        { slug: "fireball", name: "Fireball", spell_level: 3, school: "Evocation", desc: "A bright streak." },
      ],
    });

    mockApi = createMockLogseqApi();
    registry = new EntityRegistry();
    manager = new CompendiumManager(registry, mockApi as any);
  });

  it("creates SRD compendium page and entity pages", async () => {
    const count = await importSrdToLogseq(srdStore, manager, registry, mockApi as any);

    expect(count).toBe(3);
    expect(registry.count()).toBe(3);
    expect(registry.getBySlug("goblin")).toBeDefined();
    expect(registry.getBySlug("fireball")).toBeDefined();
    expect(manager.getByName("SRD")).toBeDefined();
  });

  it("skips import if SRD already exists", async () => {
    await importSrdToLogseq(srdStore, manager, registry, mockApi as any);
    const firstCount = registry.count();

    const count = await importSrdToLogseq(srdStore, manager, registry, mockApi as any);
    expect(count).toBe(0);
    expect(registry.count()).toBe(firstCount);
  });

  it("calls progress callback", async () => {
    const onProgress = vi.fn();
    await importSrdToLogseq(srdStore, manager, registry, mockApi as any, onProgress);
    expect(onProgress).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/shinoobi/w/archivist-logseq && npx vitest run tests/entities/entity-importer.test.ts
```

Expected: FAIL -- module not found.

- [ ] **Step 3: Implement entity-importer**

Create `src/entities/entity-importer.ts`. The function `importSrdToLogseq` does:

1. Check if SRD compendium already exists via `manager.getByName("SRD")` -- bail if yes
2. Create SRD compendium via `manager.create("SRD", ...)`
3. Iterate all entity types from `srdStore.getTypes()` + `srdStore.getAllOfType()`
4. For each entity: normalize via the appropriate normalizer, then call `manager.saveEntity()`
5. Report progress every 50 entities via callback
6. Return count of created entities

Signature:
```typescript
export async function importSrdToLogseq(
  srdStore: SrdStore,
  manager: CompendiumManager,
  registry: EntityRegistry,
  api: LogseqApi,
  onProgress?: (current: number, total: number) => void,
): Promise<number>
```

Use `archivist-obsidian/src/entities/entity-importer.ts` as reference for the normalizer dispatch logic (lines 104-111: monster -> `normalizeSrdMonster`, spell -> `normalizeSrdSpell`, magic-item -> `normalizeSrdItem`).

- [ ] **Step 4: Run tests**

```bash
cd /Users/shinoobi/w/archivist-logseq && npx vitest run tests/entities/entity-importer.test.ts
```

Expected: All 3 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/shinoobi/w/archivist-logseq
git add src/entities/entity-importer.ts tests/entities/entity-importer.test.ts
git commit -m "feat: add SRD entity importer for Logseq page creation"
```

---

### Task 8: Build entity search UI

**Files:**
- Create: `src/ui/entity-search.ts`
- Create: `src/ui/entity-search.css`
- Modify: `index.html` (add search container div)

- [ ] **Step 1: Add search container to index.html**

Add `<div id="archivist-search-root"></div>` to the body of `index.html`, after the existing `<div id="app"></div>`.

- [ ] **Step 2: Create search UI CSS**

Create `src/ui/entity-search.css` with styles for:
- `#archivist-search-root` -- fixed overlay backdrop, hidden by default, visible when `.visible` class added
- `.archivist-search-modal` -- centered 520px wide modal container
- `.archivist-search-input` -- full-width text input
- `.archivist-search-filters` -- row of type filter buttons
- `.archivist-search-filter` / `.archivist-search-filter.active` -- pill-style toggle buttons
- `.archivist-search-results` -- scrollable results container (max-height 340px)
- `.archivist-search-result` / `.archivist-search-result.selected` -- individual result row with hover/selected state
- `.archivist-search-result-type.{monster,spell,item,...}` -- color-coded type badges
- `.archivist-search-empty` -- centered placeholder text

All colors use Logseq CSS variables (`--ls-primary-background-color`, `--ls-border-color`, etc.) with fallback values.

- [ ] **Step 3: Create entity search module**

Create `src/ui/entity-search.ts` that exports:
- `initEntitySearch(registry: EntityRegistry): void` -- sets up DOM inside `#archivist-search-root`, attaches event listeners
- `showSearch(): Promise<void>` -- shows overlay, resets state, focuses input
- `hideSearch(): void` -- hides overlay, restores editing cursor

The module uses **DOM API methods (createElement, textContent, appendChild)** instead of innerHTML for building the UI. Key behaviors:
- Input events trigger `EntityRegistry.search()` and re-render results
- Arrow keys navigate selection, Enter selects, Escape closes
- Type filter buttons toggle `activeFilter` state
- On entity selection: if user was editing a block, insert `{{embed [[pageName]]}}` via `Editor.insertAtEditingCursor()`; otherwise navigate to entity page via `App.pushState()`
- Backdrop click closes the overlay

- [ ] **Step 4: Commit**

```bash
cd /Users/shinoobi/w/archivist-logseq
git add src/ui/entity-search.ts src/ui/entity-search.css index.html
git commit -m "feat: add entity search overlay UI with keyboard navigation"
```

---

### Task 9: Wire everything into index.ts

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add Phase 2 imports to index.ts**

Add these imports at the top:
```typescript
import searchCss from "./ui/entity-search.css?raw";
import { SrdStore } from "./srd/srd-store";
import { EntityRegistry } from "./entities/entity-registry";
import { CompendiumManager } from "./entities/compendium-manager";
import { importSrdToLogseq } from "./entities/entity-importer";
import { initEntitySearch, showSearch } from "./ui/entity-search";
```

- [ ] **Step 2: Append search CSS to provideStyle call**

Change `logseq.provideStyle(css)` to `logseq.provideStyle(css + "\n" + searchCss)`.

- [ ] **Step 3: Add Phase 2 initialization after the existing Phase 1 code**

After the slash command registrations, add:

```typescript
// --- Phase 2: Entity & Compendium System ---
const srdStore = new SrdStore();
srdStore.loadFromBundledJson();

const registry = new EntityRegistry();
const manager = new CompendiumManager(registry, logseq as any);

await manager.discover();
await manager.loadAllEntities();

initEntitySearch(registry);

logseq.App.registerCommandPalette(
  { key: "archivist-import-srd", label: "Archivist: Import SRD Compendium" },
  async () => {
    const existing = manager.getByName("SRD");
    if (existing) {
      await logseq.UI.showMsg("SRD compendium already imported", "warning");
      return;
    }
    await logseq.UI.showMsg("Importing SRD compendium...", "success", { timeout: 3000 });
    const count = await importSrdToLogseq(
      srdStore, manager, registry, logseq as any,
      (current, total) => {
        logseq.UI.showMsg(
          `Importing SRD: ${current}/${total} entities...`,
          "success",
          { key: "srd-import-progress", timeout: 10000 },
        );
      },
    );
    await logseq.UI.showMsg(
      `SRD import complete: ${count} entities imported`,
      "success",
      { key: "srd-import-progress", timeout: 5000 },
    );
  },
);

logseq.App.registerCommandPalette(
  { key: "archivist-search-entity", label: "Archivist: Search Entity" },
  async () => { await showSearch(); },
);
```

- [ ] **Step 4: Update console.log to reflect Phase 2**

Change the log to: `console.log("Archivist TTRPG Blocks loaded (Phase 1 + 2)");`

- [ ] **Step 5: Build and verify no TypeScript errors**

```bash
cd /Users/shinoobi/w/archivist-logseq && npx vite build
```

Expected: Build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/shinoobi/w/archivist-logseq
git add src/index.ts
git commit -m "feat: wire Phase 2 entity system into plugin entry point"
```

---

### Task 10: Integration verification -- build and deploy

**Files:**
- None new -- verification only

- [ ] **Step 1: Run all tests**

```bash
cd /Users/shinoobi/w/archivist-logseq && npx vitest run
```

Expected: All tests pass across all test files.

- [ ] **Step 2: Build the plugin**

```bash
cd /Users/shinoobi/w/archivist-logseq && npx vite build
```

Expected: Build succeeds. Check `dist/` output exists.

- [ ] **Step 3: Verify bundle size is reasonable**

```bash
ls -lh /Users/shinoobi/w/archivist-logseq/dist/assets/*.js
```

Expected: Main JS bundle should be ~2.5-3MB (mostly SRD JSON data). CSS should be small.

- [ ] **Step 4: Commit**

```bash
cd /Users/shinoobi/w/archivist-logseq
git add -A
git commit -m "chore: Phase 2 integration verification -- all tests pass, build succeeds"
```

---

## Task Dependency Graph

```
Task 1 (EntityRegistry)        ──┐
Task 2 (entity-vault-store)    ──┼──> Task 6 (CompendiumManager) ──> Task 7 (entity-importer) ──┐
Task 3 (normalizers)           ──┘                                                                ├──> Task 9 (Wire index.ts) ──> Task 10 (Integration)
Task 4 (SrdStore + JSON)       ─────────────────────────────────────────────────────────────────┘
Task 5 (compendium-ref-parser) ────> (standalone, no downstream deps in Phase 2)
Task 8 (Search UI)             ──────────────────────────────────────────────────────────────────────> Task 9
```

Tasks 1-5 are independent and can run in parallel.
Task 6 depends on Tasks 1-2.
Task 7 depends on Tasks 3, 4, 6.
Task 8 is independent until Task 9.
Task 9 depends on Tasks 6, 7, 8.
Task 10 depends on Task 9.
