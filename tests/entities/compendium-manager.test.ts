import { describe, it, expect, beforeEach, vi } from "vitest";
import { CompendiumManager } from "@/entities/compendium-manager";
import { EntityRegistry } from "@/entities/entity-registry";

function createMockLogseqApi() {
  const pages = new Map<
    string,
    {
      name: string;
      properties: Record<string, any>;
      blocks: { uuid: string; content: string }[];
    }
  >();

  return {
    Editor: {
      getPage: vi.fn(async (name: string) => {
        const page = pages.get(name.toLowerCase());
        return page
          ? {
              name: page.name,
              originalName: page.name,
              properties: page.properties,
            }
          : null;
      }),
      createPage: vi.fn(
        async (name: string, properties: Record<string, any>) => {
          const page = { name, properties, blocks: [] };
          pages.set(name.toLowerCase(), page);
          return { name, originalName: name, properties };
        },
      ),
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
    const comp = await manager.create(
      "Homebrew",
      "My custom content",
      true,
      false,
    );
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
    expect(mockApi.Editor.deletePage).toHaveBeenCalledWith(
      "SRD/Monsters/Goblin",
    );
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
