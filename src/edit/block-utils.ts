// src/edit/block-utils.ts

export interface BlockContext {
  blockUuid: string;
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
 */
export async function getCompendiumContext(
  blockUuid: string,
  api: {
    Editor: {
      getBlockPage: (uuid: string) => Promise<{ properties?: Record<string, unknown>; originalName?: string } | null>;
      getPage: (name: string) => Promise<{ properties?: Record<string, unknown> } | null>;
    };
  },
): Promise<CompendiumContext | null> {
  const page = await api.Editor.getBlockPage(blockUuid);
  if (!page?.properties) return null;

  const isEntity = page.properties["archivist"] === true;
  if (!isEntity) return null;

  const slug = String(page.properties["slug"] ?? "");
  const compendiumName = String(page.properties["compendium"] ?? "");
  const entityType = String(page.properties["entity-type"] ?? "monster") as CompendiumContext["entityType"];

  if (!slug || !compendiumName) return null;

  // Check if the compendium is readonly
  const compendiumPage = await api.Editor.getPage(compendiumName);
  const readonly = compendiumPage?.properties?.["compendium-readonly"] === true;

  return { slug, compendium: compendiumName, entityType, readonly };
}
