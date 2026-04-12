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
