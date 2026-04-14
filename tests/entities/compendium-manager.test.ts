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

  describe("discover (batch)", () => {
    it("discovers compendiums via bulk datascript query", async () => {
      mockApi.DB.datascriptQuery.mockResolvedValueOnce([
        [{ name: "srd", "original-name": "SRD", properties: {
          "archivist-compendium": true,
          "compendium-description": "System Reference Document",
          "compendium-readonly": true,
          "compendium-homebrew": false,
        }}],
        [{ name: "homebrew", "original-name": "Homebrew", properties: {
          "archivist-compendium": true,
          "compendium-description": "My content",
          "compendium-readonly": false,
          "compendium-homebrew": true,
        }}],
        [{ name: "journal", "original-name": "Journal", properties: {} }],
      ]);

      await manager.discover();

      expect(manager.getAll()).toHaveLength(2);
      expect(manager.getByName("SRD")).toBeDefined();
      expect(manager.getByName("SRD")!.readonly).toBe(true);
      expect(manager.getByName("Homebrew")).toBeDefined();
      expect(manager.getByName("Homebrew")!.homebrew).toBe(true);
      expect(mockApi.DB.datascriptQuery).toHaveBeenCalledTimes(1);
      expect(mockApi.Editor.getPage).not.toHaveBeenCalled();
    });

    it("deduplicates namespace parents with multiple children", async () => {
      mockApi.DB.datascriptQuery.mockResolvedValueOnce([
        [{ name: "srd", "original-name": "SRD", properties: {
          "archivist-compendium": true,
        }}],
        [{ name: "srd", "original-name": "SRD", properties: {
          "archivist-compendium": true,
        }}],
      ]);

      await manager.discover();
      expect(manager.getAll()).toHaveLength(1);
    });
  });

  describe("loadAllEntities (batch)", () => {
    it("loads entities via bulk datascript queries", async () => {
      manager.addCompendium({
        name: "SRD", description: "SRD", readonly: true, homebrew: false,
      });

      mockApi.DB.datascriptQuery
        .mockResolvedValueOnce([
          [{ name: "srd/monsters/goblin", "original-name": "SRD/Monsters/Goblin", properties: {
            archivist: true, "entity-type": "monster", slug: "goblin", name: "Goblin", compendium: "SRD",
          }}],
          [{ name: "srd/spells/fireball", "original-name": "SRD/Spells/Fireball", properties: {
            archivist: true, "entity-type": "spell", slug: "fireball", name: "Fireball", compendium: "SRD",
          }}],
        ])
        .mockResolvedValueOnce([
          ["srd/monsters/goblin", "```monster\nname: Goblin\ncr: \"1/4\"\n```"],
          ["srd/spells/fireball", "```spell\nname: Fireball\nlevel: 3\n```"],
        ]);

      const count = await manager.loadAllEntities();

      expect(count).toBe(2);
      expect(registry.getBySlug("goblin")).toBeDefined();
      expect(registry.getBySlug("goblin")!.entityType).toBe("monster");
      expect(registry.getBySlug("fireball")).toBeDefined();
      expect(registry.getBySlug("fireball")!.entityType).toBe("spell");
      expect(mockApi.DB.datascriptQuery).toHaveBeenCalledTimes(2);
      expect(mockApi.Editor.getPage).not.toHaveBeenCalled();
      expect(mockApi.Editor.getPageBlocksTree).not.toHaveBeenCalled();
    });

    it("skips pages without archivist flag", async () => {
      manager.addCompendium({
        name: "SRD", description: "SRD", readonly: true, homebrew: false,
      });

      mockApi.DB.datascriptQuery
        .mockResolvedValueOnce([
          [{ name: "srd/monsters/goblin", "original-name": "SRD/Monsters/Goblin", properties: {
            archivist: true, "entity-type": "monster", slug: "goblin", name: "Goblin", compendium: "SRD",
          }}],
          [{ name: "srd/notes/session1", "original-name": "SRD/Notes/Session1", properties: {} }],
        ])
        .mockResolvedValueOnce([
          ["srd/monsters/goblin", "```monster\nname: Goblin\n```"],
          ["srd/notes/session1", "Some random notes"],
        ]);

      const count = await manager.loadAllEntities();
      expect(count).toBe(1);
      expect(registry.getBySlug("goblin")).toBeDefined();
    });

    it("handles pages with no matching block content", async () => {
      manager.addCompendium({
        name: "SRD", description: "SRD", readonly: true, homebrew: false,
      });

      mockApi.DB.datascriptQuery
        .mockResolvedValueOnce([
          [{ name: "srd/monsters/goblin", "original-name": "SRD/Monsters/Goblin", properties: {
            archivist: true, "entity-type": "monster", slug: "goblin", name: "Goblin", compendium: "SRD",
          }}],
        ])
        .mockResolvedValueOnce([]);

      const count = await manager.loadAllEntities();
      expect(count).toBe(1);
      expect(registry.getBySlug("goblin")!.data).toEqual({});
    });
  });
});
