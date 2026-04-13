import * as yaml from "js-yaml";
import { parseCompendiumRef } from "./compendium-ref-parser";
import { parseMonster } from "../parsers/monster-parser";
import { parseSpell } from "../parsers/spell-parser";
import { parseItem } from "../parsers/item-parser";
import { renderMonsterBlock } from "../renderers/monster-renderer";
import { renderSpellBlock } from "../renderers/spell-renderer";
import { renderItemBlock } from "../renderers/item-renderer";
import { escapeHtml, lucideIcon } from "../renderers/renderer-utils";
import type { EntityRegistry, RegisteredEntity } from "../entities/entity-registry";
import type { CompendiumManager } from "../entities/compendium-manager";

// ---------------------------------------------------------------------------
// Module-level refs (set by index.ts at plugin load)
// ---------------------------------------------------------------------------

let registryRef: EntityRegistry | null = null;
let managerRef: CompendiumManager | null = null;

export function setCompendiumRefRegistry(registry: EntityRegistry): void {
  registryRef = registry;
}

export function setCompendiumRefManager(manager: CompendiumManager): void {
  managerRef = manager;
}

// ---------------------------------------------------------------------------
// Testable range finder (no CM6 dependency)
// ---------------------------------------------------------------------------

export interface CompendiumRefRange {
  from: number;
  to: number;
  refText: string;
  entityType: string | null;
  slug: string;
}

const COMPENDIUM_REF_RE = /\{\{[^}]+\}\}/g;

/**
 * Scan text for {{type:slug}} patterns and return their positions.
 * `offset` is added to all positions (for use with visible ranges).
 */
export function findCompendiumRefRanges(text: string, offset: number): CompendiumRefRange[] {
  const ranges: CompendiumRefRange[] = [];
  COMPENDIUM_REF_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = COMPENDIUM_REF_RE.exec(text)) !== null) {
    const parsed = parseCompendiumRef(match[0]);
    if (!parsed) continue;

    ranges.push({
      from: offset + match.index,
      to: offset + match.index + match[0].length,
      refText: match[0],
      entityType: parsed.entityType,
      slug: parsed.slug,
    });
  }

  return ranges;
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function renderEntityHtml(entity: RegisteredEntity, columns?: number): string {
  const yamlStr = yaml.dump(entity.data, { lineWidth: -1, noRefs: true });
  const type = entity.entityType;

  if (type === "monster") {
    const result = parseMonster(yamlStr);
    if (result.success) return renderMonsterBlock(result.data, columns ?? 1);
  } else if (type === "spell") {
    const result = parseSpell(yamlStr);
    if (result.success) return renderSpellBlock(result.data);
  } else if (type === "item") {
    const result = parseItem(yamlStr);
    if (result.success) return renderItemBlock(result.data);
  }

  return `<div class="archivist-compendium-ref-error">Cannot render ${escapeHtml(type)}: ${escapeHtml(entity.slug)}</div>`;
}

function renderNotFound(refText: string, entityType: string | null, slug: string): string {
  const iconSvg = lucideIcon("alert-triangle");
  const refLabel = entityType ? `${entityType}:${slug}` : slug;
  return [
    '<div class="archivist-compendium-ref-error">',
    `<div class="archivist-not-found-icon">${iconSvg}</div>`,
    '<div class="archivist-not-found-text">',
    '<div class="archivist-not-found-label">Entity not found</div>',
    `<div class="archivist-not-found-ref">${escapeHtml(refLabel)}</div>`,
    "</div></div>",
  ].join("");
}

function renderBadge(compendium: string): string {
  return `<div class="archivist-compendium-badge">${escapeHtml(compendium)}</div>`;
}

// ---------------------------------------------------------------------------
// CM6 Widget & Plugin (constructed at runtime from host CM6 module)
// ---------------------------------------------------------------------------

/**
 * Factory that receives the host CM6 module and returns an Extension
 * and the refresh StateEffect.
 */
export function createCompendiumRefExtension(cm: any): { plugin: any; compendiumRefreshEffect: any } {
  const { ViewPlugin, Decoration, WidgetType, StateEffect } = cm;

  // Refresh effect -- dispatch to force decoration rebuild
  const compendiumRefreshEffect = StateEffect.define();

  class CompendiumRefWidget extends WidgetType {
    constructor(
      private refText: string,
      private entityType: string | null,
      private slug: string,
    ) {
      super();
    }

    toDOM(): HTMLElement {
      const container = document.createElement("div");
      container.className = "archivist-compendium-ref archivist-block";

      if (!registryRef) {
        container.innerHTML = renderNotFound(this.refText, this.entityType, this.slug);
        return container;
      }

      const entity = registryRef.getBySlug(this.slug);

      if (!entity) {
        container.innerHTML = renderNotFound(this.refText, this.entityType, this.slug);
        return container;
      }

      // Type mismatch check
      if (this.entityType && entity.entityType !== this.entityType) {
        container.innerHTML = renderNotFound(this.refText, this.entityType, this.slug);
        return container;
      }

      // Safe: renderEntityHtml + renderBadge escape all user content via escapeHtml
      const blockHtml = renderEntityHtml(entity);
      container.innerHTML = blockHtml + renderBadge(entity.compendium);

      // Prevent Logseq click-through
      container.addEventListener("mousedown", (e: MouseEvent) => e.stopPropagation());
      container.addEventListener("click", (e: MouseEvent) => e.stopPropagation());

      return container;
    }

    eq(other: CompendiumRefWidget): boolean {
      return this.refText === other.refText;
    }

    ignoreEvent(): boolean {
      return true;
    }
  }

  function buildDecorations(view: any): any {
    const decorations: Array<{ from: number; to: number; deco: any }> = [];
    const cursorPos = view.state.selection.main.head;

    for (const { from, to } of view.visibleRanges) {
      const text = view.state.doc.sliceString(from, to);
      const ranges = findCompendiumRefRanges(text, from);

      for (const range of ranges) {
        // Skip when cursor is inside the ref (let user edit)
        if (cursorPos > range.from && cursorPos < range.to) continue;

        decorations.push({
          from: range.from,
          to: range.to,
          deco: Decoration.replace({
            widget: new CompendiumRefWidget(range.refText, range.entityType, range.slug),
          }),
        });
      }
    }

    decorations.sort((a, b) => a.from - b.from);

    if (decorations.length === 0) return Decoration.none;
    return Decoration.set(
      decorations.map((d) => d.deco.range(d.from, d.to)),
    );
  }

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: any;

      constructor(view: any) {
        this.decorations = buildDecorations(view);
      }

      update(update: any) {
        const hasRefresh = update.transactions.some((tr: any) =>
          tr.effects.some((e: any) => e.is(compendiumRefreshEffect)),
        );
        if (hasRefresh || update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = buildDecorations(update.view);
        }
      }
    },
    {
      decorations: (v: any) => v.decorations,
    },
  );

  return { plugin, compendiumRefreshEffect };
}
