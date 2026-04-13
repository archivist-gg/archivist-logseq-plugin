import type { EntityRegistry, RegisteredEntity } from "../entities/entity-registry";

// ---------------------------------------------------------------------------
// Module-level registry ref (set by index.ts at plugin load)
// ---------------------------------------------------------------------------

let registryRef: EntityRegistry | null = null;

export function setCompendiumSuggestRegistry(registry: EntityRegistry): void {
  registryRef = registry;
}

// ---------------------------------------------------------------------------
// Trigger detection (testable, no CM6 dependency)
// ---------------------------------------------------------------------------

const VALID_PREFIXES = new Set(["monster", "spell", "item"]);

export interface CompendiumTrigger {
  from: number;
  query: string;
  entityType: string | undefined;
}

/**
 * Detect {{ compendium trigger in text before cursor.
 * `cursorPos` is unused but kept for API symmetry -- the function operates
 * entirely on `textBeforeCursor`.
 */
export function detectCompendiumTrigger(
  textBeforeCursor: string,
  _cursorPos: number,
): CompendiumTrigger | null {
  const lastOpen = textBeforeCursor.lastIndexOf("{{");
  if (lastOpen === -1) return null;

  const afterOpen = textBeforeCursor.substring(lastOpen + 2);
  // Already closed -- no trigger
  if (afterOpen.includes("}}")) return null;

  // Check for type prefix
  const colonIdx = afterOpen.indexOf(":");
  let entityType: string | undefined;
  let query: string;

  if (colonIdx !== -1) {
    const prefix = afterOpen.substring(0, colonIdx).toLowerCase().trim();
    if (VALID_PREFIXES.has(prefix)) {
      entityType = prefix;
      query = afterOpen.substring(colonIdx + 1).trim();
    } else {
      // Unknown prefix -- treat entire thing as query
      entityType = undefined;
      query = afterOpen;
    }
  } else {
    query = afterOpen;
  }

  return { from: lastOpen, query, entityType };
}

// ---------------------------------------------------------------------------
// CM6 Completion Source (constructed at runtime from host CM6 module)
// ---------------------------------------------------------------------------

/**
 * Factory that receives the host CM6 module and returns an Extension
 * providing autocompletion for {{type:slug}} references.
 */
export function createCompendiumCompletion(cm: any): any {
  // autocompletion may come from @codemirror/autocomplete
  const autocompletion = cm.autocompletion;
  if (!autocompletion) {
    console.warn("[archivist] autocompletion not available from CM6 host module");
    return [];
  }

  function completionSource(context: any): any {
    if (!registryRef) return null;

    const line = context.state.doc.lineAt(context.pos);
    const textBefore = line.text.substring(0, context.pos - line.from);

    const trigger = detectCompendiumTrigger(textBefore, context.pos);
    if (!trigger) return null;

    const results = registryRef.search(trigger.query, trigger.entityType, 20);
    if (results.length === 0) return null;

    const from = line.from + trigger.from;

    return {
      from,
      to: context.pos,
      options: results.map((entity: RegisteredEntity) => ({
        label: entity.name,
        detail: entity.entityType,
        info: entity.compendium,
        apply: `{{${entity.entityType}:${entity.slug}}}`,
      })),
    };
  }

  return autocompletion({
    override: [completionSource],
  });
}
