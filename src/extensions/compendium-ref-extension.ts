import * as yaml from "js-yaml";
import { parseCompendiumRef } from "./compendium-ref-parser";
import { parseMonster } from "../parsers/monster-parser";
import { parseSpell } from "../parsers/spell-parser";
import { parseItem } from "../parsers/item-parser";
import { renderMonsterBlock } from "../renderers/monster-renderer";
import { renderSpellBlock } from "../renderers/spell-renderer";
import { renderItemBlock } from "../renderers/item-renderer";
import { escapeHtml, lucideIcon } from "../renderers/renderer-utils";
import { renderSideButtons, wireSideButtonEvents } from "../edit/side-buttons";
import type { SideButtonCallbacks } from "../edit/side-buttons";
import { renderMonsterEditMode, wireMonsterEditEvents } from "../edit/monster-edit-render";
import { renderSpellEditMode, wireSpellEditEvents } from "../edit/spell-edit-render";
import { renderItemEditMode, wireItemEditEvents } from "../edit/item-edit-render";
import { showCompendiumPicker } from "../edit/compendium-picker";
import type { CompendiumContext } from "../edit/block-utils";
import type { EditCallbacks } from "../index";
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

    toDOM(view: any): HTMLElement {
      const container = document.createElement("div");
      container.className = "archivist-compendium-ref archivist-block";

      if (!registryRef) {
        // Safe: renderNotFound escapes all user content via escapeHtml
        container.innerHTML = renderNotFound(this.refText, this.entityType, this.slug);
        return container;
      }

      const entity = registryRef.getBySlug(this.slug);

      if (!entity) {
        // Safe: renderNotFound escapes all user content via escapeHtml
        container.innerHTML = renderNotFound(this.refText, this.entityType, this.slug);
        return container;
      }

      if (this.entityType && entity.entityType !== this.entityType) {
        // Safe: renderNotFound escapes all user content via escapeHtml
        container.innerHTML = renderNotFound(this.refText, this.entityType, this.slug);
        return container;
      }

      let currentColumns = 1;
      const isMonster = entity.entityType === "monster";
      const refText = this.refText;
      const compCtx: CompendiumContext = {
        slug: entity.slug,
        compendium: entity.compendium,
        entityType: entity.entityType as "monster" | "spell" | "item",
        readonly: entity.readonly,
      };

      const doRenderView = () => {
        container.textContent = "";
        // Safe: renderEntityHtml, renderBadge, renderSideButtons all escape user content
        const blockHtml = renderEntityHtml(entity, currentColumns);
        const sideHtml = renderSideButtons({
          state: "default",
          showColumnToggle: isMonster,
          isColumnActive: currentColumns > 1,
          compendiumContext: compCtx,
        });
        container.insertAdjacentHTML("afterbegin", blockHtml + renderBadge(entity.compendium) + sideHtml);
        wireSideButtonEvents(container, buildCbs());
      };

      const doRenderSource = () => {
        container.textContent = "";
        const yamlStr = yaml.dump(entity.data, { lineWidth: -1, noRefs: true });
        const sideHtml = renderSideButtons({
          state: "default",
          showColumnToggle: isMonster,
          isColumnActive: currentColumns > 1,
          compendiumContext: compCtx,
        });
        // Safe: escapeHtml sanitizes yamlStr, renderSideButtons produces trusted markup
        container.insertAdjacentHTML("afterbegin",
          `<div class="archivist-source-view"><pre class="archivist-source-pre">${escapeHtml(yamlStr)}</pre>${sideHtml}</div>`);
        wireSideButtonEvents(container, buildCbs());
      };

      const doRenderEdit = () => {
        container.textContent = "";
        const editCbs: EditCallbacks = {
          onSave: async (yamlStr: string) => {
            if (!managerRef) return;
            try {
              const data = yaml.load(yamlStr) as Record<string, unknown>;
              if (data && typeof data === "object") {
                await managerRef.updateEntity(entity.slug, data);
              }
            } catch { /* ignore parse errors */ }
            doRenderView();
          },
          onSaveAsNew: async (yamlStr: string, entityName: string) => {
            if (!managerRef) return;
            const writable = managerRef.getWritable();
            if (writable.length === 0) return;
            try {
              const data = yaml.load(yamlStr) as Record<string, unknown>;
              if (!data || typeof data !== "object") return;
              data.name = entityName;
              if (writable.length === 1) {
                await managerRef.saveEntity(writable[0].name, entity.entityType, data);
              } else {
                showCompendiumPicker(container, writable, async (comp) => {
                  await managerRef!.saveEntity(comp.name, entity.entityType, data);
                  doRenderView();
                });
                return;
              }
            } catch { /* ignore */ }
            doRenderView();
          },
          onCancel: () => doRenderView(),
        };

        const yamlStr = yaml.dump(entity.data, { lineWidth: -1, noRefs: true });
        const type = entity.entityType;

        if (type === "monster") {
          const result = parseMonster(yamlStr);
          if (result.success) {
            const editHtml = renderMonsterEditMode(result.data, compCtx);
            const sideHtml = renderSideButtons({ state: "editing", showColumnToggle: false, isColumnActive: false, compendiumContext: compCtx });
            // Safe: all HTML produced by our own renderers from parsed data
            container.insertAdjacentHTML("afterbegin", editHtml + sideHtml);
            wireMonsterEditEvents(container, result.data, compCtx, editCbs);
            wireSideButtonEvents(container, buildCbs());
          }
        } else if (type === "spell") {
          const result = parseSpell(yamlStr);
          if (result.success) {
            const editHtml = renderSpellEditMode(result.data, compCtx);
            const sideHtml = renderSideButtons({ state: "editing", showColumnToggle: false, isColumnActive: false, compendiumContext: compCtx });
            // Safe: all HTML produced by our own renderers from parsed data
            container.insertAdjacentHTML("afterbegin", editHtml + sideHtml);
            wireSpellEditEvents(container, result.data, compCtx, editCbs);
            wireSideButtonEvents(container, buildCbs());
          }
        } else if (type === "item") {
          const result = parseItem(yamlStr);
          if (result.success) {
            const editHtml = renderItemEditMode(result.data, compCtx);
            const sideHtml = renderSideButtons({ state: "editing", showColumnToggle: false, isColumnActive: false, compendiumContext: compCtx });
            // Safe: all HTML produced by our own renderers from parsed data
            container.insertAdjacentHTML("afterbegin", editHtml + sideHtml);
            wireItemEditEvents(container, result.data, compCtx, editCbs);
            wireSideButtonEvents(container, buildCbs());
          }
        }
      };

      let currentMode: "view" | "source" | "edit" = "view";

      const buildCbs = (): SideButtonCallbacks => ({
        onSource: () => {
          currentMode = currentMode === "source" ? "view" : "source";
          if (currentMode === "source") doRenderSource();
          else doRenderView();
        },
        onColumnToggle: () => {
          currentColumns = currentColumns > 1 ? 1 : 2;
          doRenderView();
        },
        onEdit: () => {
          currentMode = "edit";
          doRenderEdit();
        },
        onSave: () => {},
        onSaveAsNew: () => {},
        onCancel: () => {
          currentMode = "view";
          doRenderView();
        },
        onDeleteBlock: () => {
          // Delete the {{ref}} text from the document
          try {
            const pos = view.posAtDOM(container);
            if (pos !== undefined) {
              view.dispatch({
                changes: { from: pos, to: pos + refText.length, insert: "" },
              });
            }
          } catch { /* widget may no longer be in doc */ }
        },
        onDeleteEntity: async () => {
          if (!managerRef) return;
          const count = await managerRef.countReferences(entity.slug);
          let msg = `Delete "${entity.name}" from ${entity.compendium}?`;
          if (count > 0) {
            msg += `\n\n${count} reference${count === 1 ? "" : "s"} will break.`;
          }
          if (confirm(msg)) {
            try {
              const pos = view.posAtDOM(container);
              if (pos !== undefined) {
                view.dispatch({
                  changes: { from: pos, to: pos + refText.length, insert: "" },
                });
              }
            } catch { /* ignore */ }
            await managerRef.deleteEntity(entity.slug);
          }
        },
      });

      // Initial render
      doRenderView();

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
