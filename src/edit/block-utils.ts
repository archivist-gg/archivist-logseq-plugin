// src/edit/block-utils.ts

/**
 * Logseq normalizes property keys (hyphens -> camelCase/underscores).
 * Try the original key plus all normalized variants.
 */
function prop(props: Record<string, any>, key: string, fallback?: any): any {
  if (key in props) return props[key];
  const camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  if (camel in props) return props[camel];
  const snake = key.replace(/-/g, "_");
  if (snake in props) return props[snake];
  const flat = key.replace(/-/g, "");
  if (flat in props) return props[flat];
  return fallback;
}

export interface CompendiumContext {
  slug: string;
  compendium: string;
  entityType: "monster" | "spell" | "item";
  readonly: boolean;
}

/**
 * Walk up the DOM from a rendered stat block element to find the nearest
 * .ls-block[blockid] ancestor. Returns the block UUID or null.
 */
export function findBlockUuid(el: HTMLElement): string | null {
  const block = el.closest(".ls-block[blockid]");
  if (!block) return null;
  return block.getAttribute("blockid");
}

/**
 * Given a block UUID, query Logseq's API to determine if this block lives
 * on an entity page. If so, return the compendium context.
 *
 * Logseq has no `getBlockPage` method. Instead we call `getBlock(uuid)` to
 * get the block (which includes `page: { id }`), then `getPage(id)` to
 * resolve the page with its properties.
 */
export async function getCompendiumContext(
  blockUuid: string,
  api: {
    Editor: {
      getBlock: (uuid: string) => Promise<{ page?: { id: number } } | null>;
      getPage: (idOrName: number | string) => Promise<{ properties?: Record<string, unknown>; originalName?: string } | null>;
    };
  },
): Promise<CompendiumContext | null> {
  const block = await api.Editor.getBlock(blockUuid);
  if (!block?.page?.id) return null;

  const page = await api.Editor.getPage(block.page.id);
  if (!page?.properties) return null;

  const props = page.properties;
  const isEntity = prop(props, "archivist") === true;
  if (!isEntity) return null;

  const slug = String(prop(props, "slug", ""));
  const compendiumName = String(prop(props, "compendium", ""));
  const VALID_ENTITY_TYPES = new Set<CompendiumContext["entityType"]>(["monster", "spell", "item"]);
  let rawType = String(prop(props, "entity-type", ""));
  // Backward compat: "magic-item" was renamed to "item"
  if (rawType === "magic-item") rawType = "item";
  if (!VALID_ENTITY_TYPES.has(rawType as CompendiumContext["entityType"])) return null;
  const entityType = rawType as CompendiumContext["entityType"];

  if (!slug || !compendiumName) return null;

  // Check if the compendium is readonly
  const compendiumPage = await api.Editor.getPage(compendiumName);
  const compendiumProps = compendiumPage?.properties ?? {};
  const readonly = prop(compendiumProps, "compendium-readonly", false) === true;

  return { slug, compendium: compendiumName, entityType, readonly };
}
