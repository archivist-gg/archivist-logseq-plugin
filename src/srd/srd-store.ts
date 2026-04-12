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
