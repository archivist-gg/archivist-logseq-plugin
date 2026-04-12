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
