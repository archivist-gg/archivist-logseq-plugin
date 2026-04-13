import type { SrdStore } from "../srd/srd-store";
import type { EntityRegistry } from "./entity-registry";
import type { CompendiumManager, LogseqApi } from "./compendium-manager";
import {
  normalizeSrdMonster,
  normalizeSrdSpell,
  normalizeSrdItem,
} from "./srd-normalizer";

// ---------------------------------------------------------------------------
// importSrdToLogseq
// ---------------------------------------------------------------------------

/**
 * Imports all SRD entities into Logseq as namespaced pages under an "SRD"
 * compendium.
 *
 * 1. Checks if the SRD compendium already exists — bails if yes (returns 0).
 * 2. Creates the SRD compendium via CompendiumManager.
 * 3. Iterates all entity types from SrdStore and normalizes each entity.
 * 4. Saves each entity as a Logseq page via CompendiumManager.saveEntity().
 * 5. Reports progress every 50 entities via the optional callback.
 * 6. Returns the total count of created entities.
 */
export async function importSrdToLogseq(
  srdStore: SrdStore,
  manager: CompendiumManager,
  registry: EntityRegistry,
  api: LogseqApi,
  onProgress?: (current: number, total: number) => void,
): Promise<number> {
  // 1. Bail if SRD compendium already exists
  if (manager.getByName("SRD")) {
    return 0;
  }

  // 2. Create the SRD compendium
  await manager.create("SRD", "System Reference Document (5e)", false, true);

  // 3. Collect all entities across all types
  const types = srdStore.getTypes();
  const allEntities: {
    slug: string;
    name: string;
    entityType: string;
    data: Record<string, unknown>;
  }[] = [];

  for (const entityType of types) {
    const entities = srdStore.getAllOfType(entityType);
    allEntities.push(...entities);
  }

  const total = allEntities.length;
  if (total === 0) return 0;

  // 4. Import each entity
  let created = 0;
  for (let i = 0; i < allEntities.length; i++) {
    const entity = allEntities[i];

    // Normalize SRD data via the appropriate normalizer
    let entityData = entity.data;
    if (entity.entityType === "monster") {
      entityData = normalizeSrdMonster(entityData);
    } else if (entity.entityType === "spell") {
      entityData = normalizeSrdSpell(entityData);
    } else if (entity.entityType === "item") {
      entityData = normalizeSrdItem(entityData);
    }

    // Ensure the name field is present in the normalized data
    if (!entityData.name) {
      entityData = { ...entityData, name: entity.name };
    }

    await manager.saveEntity("SRD", entity.entityType, entityData);
    created++;

    // Report progress every 50 entities
    if (onProgress && (i + 1) % 50 === 0) {
      onProgress(i + 1, total);
    }
  }

  // Final progress report
  if (onProgress && total % 50 !== 0) {
    onProgress(total, total);
  }

  return created;
}
