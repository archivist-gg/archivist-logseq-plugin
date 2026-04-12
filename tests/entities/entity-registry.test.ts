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
