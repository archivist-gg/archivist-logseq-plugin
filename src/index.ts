import "@logseq/libs";
import * as yaml from "js-yaml";
import { parseMonster } from "./parsers/monster-parser";
import { parseSpell } from "./parsers/spell-parser";
import { parseItem } from "./parsers/item-parser";
import {
  renderMonsterBlock,
  initMonsterTabs,
} from "./renderers/monster-renderer";
import { renderSpellBlock } from "./renderers/spell-renderer";
import { renderItemBlock } from "./renderers/item-renderer";
import { renderErrorBlock, escapeHtml } from "./renderers/renderer-utils";
import css from "./styles/archivist-dnd.css?raw";
import editCss from "./styles/archivist-edit.css?raw";
import searchCss from "./ui/entity-search.css?raw";
import { SrdStore } from "./srd/srd-store";
import { EntityRegistry } from "./entities/entity-registry";
import { CompendiumManager } from "./entities/compendium-manager";
import { importSrdToLogseq } from "./entities/entity-importer";
import { initEntitySearch, showSearch } from "./ui/entity-search";
import { findBlockUuid, getCompendiumContext } from "./edit/block-utils";
import type { CompendiumContext } from "./edit/block-utils";
import { renderSideButtons, wireSideButtonEvents } from "./edit/side-buttons";
import type { SideButtonCallbacks } from "./edit/side-buttons";
import { showCompendiumPicker } from "./edit/compendium-picker";
import { renderMonsterEditMode, wireMonsterEditEvents } from "./edit/monster-edit-render";
import { renderSpellEditMode, wireSpellEditEvents } from "./edit/spell-edit-render";
import { renderItemEditMode, wireItemEditEvents } from "./edit/item-edit-render";
import { createInlineTagExtension } from "./extensions/inline-tag-extension";
import { setCompendiumRefRegistry, setCompendiumRefManager } from "./extensions/compendium-ref-extension";
import { createCompendiumCompletion, setCompendiumSuggestRegistry } from "./extensions/compendium-suggest";

type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface EditCallbacks {
  onSave: (yaml: string) => Promise<void>;
  onSaveAsNew: (yaml: string, entityName: string) => Promise<void>;
  onCancel: () => void;
}

let managerRef: CompendiumManager | null = null;
let registryRef: EntityRegistry | null = null;

/**
 * Creates a stateful fenced code renderer for Logseq's Experiments API.
 *
 * Each rendered block tracks view/edit/source mode, column layout, and
 * compendium context. Side buttons provide mode transitions, save/cancel,
 * column toggle, and delete flows.
 *
 * Note: we use DOM injection intentionally -- the HTML comes from our own
 * renderer pipeline (parser -> type -> renderer), not from untrusted input.
 */
function createStatefulBlockRenderer(
  entityType: "monster" | "spell" | "item",
  parser: (content: string) => ParseResult<any>,
  viewRenderer: (data: any, columns?: number) => string,
  editRenderer: ((data: any, ctx: CompendiumContext | null) => string) | null,
  wireEdit: ((container: HTMLElement, data: any, ctx: CompendiumContext | null, callbacks: EditCallbacks) => void) | null,
  postRender?: (container: HTMLElement) => void,
): (props: { content: string }) => unknown {
  return (props: { content: string }) => {
    const React = logseq.Experiments.React! as any;
    const containerRef = React.useRef(null) as { current: HTMLDivElement | null };
    const abortRef = React.useRef(null as AbortController | null) as { current: AbortController | null };
    const [mode, setMode] = React.useState(
      logseq.settings?.defaultEditMode === "source" ? "source" : "view"
    ) as [string, (m: string) => void];
    const [blockUuid, setBlockUuid] = React.useState(null) as [string | null, (u: string | null) => void];
    const [compCtx, setCompCtx] = React.useState(null) as [CompendiumContext | null, (c: CompendiumContext | null) => void];
    const [columns, setColumns] = React.useState(
      entityType === "monster" && logseq.settings?.defaultColumns ? 2 : 1,
    ) as [number, (c: number) => void];

    React.useEffect(() => {
      if (!containerRef.current) return;
      if (abortRef.current) abortRef.current.abort();
      abortRef.current = new AbortController();
      const signal = abortRef.current.signal;
      const el = containerRef.current;
      const result = parser(props.content);

      if (!result.success) {
        // Safe: renderErrorBlock escapes user input via escapeHtml
        el.textContent = "";
        el.insertAdjacentHTML("afterbegin", renderErrorBlock(result.error));
        return;
      }

      const data = result.data;

      if (mode === "source") {
        // Raw YAML source view
        const escaped = escapeHtml(props.content);
        const sideHtml = renderSideButtons({
          state: "default",
          showColumnToggle: entityType === "monster",
          isColumnActive: columns > 1,
          compendiumContext: compCtx,
        });
        el.textContent = "";
        el.insertAdjacentHTML("afterbegin", `<div class="archivist-source-view"><pre class="archivist-source-pre">${escaped}</pre>${sideHtml}</div>`);
        wireSideButtonEvents(el, buildCallbacks(data), { signal });
      } else if (mode === "edit" && editRenderer && wireEdit) {
        // Edit mode
        const editHtml = editRenderer(data, compCtx);
        const sideHtml = renderSideButtons({
          state: "editing",
          showColumnToggle: false,
          isColumnActive: false,
          compendiumContext: compCtx,
        });
        el.textContent = "";
        el.insertAdjacentHTML("afterbegin", editHtml + sideHtml);
        wireEdit(el, data, compCtx, buildEditCallbacks());
        wireSideButtonEvents(el, buildCallbacks(data), { signal });
      } else {
        // View mode (default)
        const cols = data.columns ?? columns;
        // Safe: HTML is produced by our own renderer from parsed YAML data
        el.textContent = "";
        el.insertAdjacentHTML("afterbegin", viewRenderer(data, cols));
        const sideHtml = renderSideButtons({
          state: "default",
          showColumnToggle: entityType === "monster",
          isColumnActive: cols > 1,
          compendiumContext: compCtx,
        });
        el.insertAdjacentHTML("beforeend", sideHtml);
        if (postRender) postRender(el);
        wireSideButtonEvents(el, buildCallbacks(data), { signal });
      }

      // Hide Logseq's native fenced-code-block toolbar buttons (resize/refresh)
      // that appear as siblings of the plugin's rendered container.
      hideLogseqCodeToolbar(el);
    }, [props.content, mode, columns, compCtx]);

    function buildCallbacks(data: any): SideButtonCallbacks {
      return {
        onSource: () => setMode(mode === "source" ? "view" : "source"),
        onColumnToggle: () => setColumns(columns > 1 ? 1 : 2),
        onEdit: async () => {
          const el = containerRef.current;
          if (!el) return;
          const uuid = findBlockUuid(el);
          let ctx: CompendiumContext | null = null;
          if (uuid) {
            ctx = await getCompendiumContext(uuid, logseq as any);
          }
          if (uuid) setBlockUuid(uuid);
          if (uuid) setCompCtx(ctx);
          setMode("edit");
        },
        onSave: () => {}, // handled by edit callbacks
        onSaveAsNew: () => {}, // handled by edit callbacks
        onCancel: () => setMode("view"),
        onDeleteBlock: async () => {
          const uuid = blockUuid || (containerRef.current ? findBlockUuid(containerRef.current) : null);
          if (uuid) {
            await logseq.Editor.removeBlock(uuid);
          }
        },
        onDeleteEntity: compCtx ? async () => {
          if (!managerRef) return;
          await managerRef.deleteEntity(compCtx.slug);
          const uuid = blockUuid || (containerRef.current ? findBlockUuid(containerRef.current) : null);
          if (uuid) await logseq.Editor.removeBlock(uuid);
          await logseq.UI.showMsg(`Deleted "${compCtx.slug}" from compendium`, "success");
        } : undefined,
      };
    }

    function buildEditCallbacks(): EditCallbacks {
      return {
        onSave: async (yaml: string) => {
          const uuid = blockUuid || (containerRef.current ? findBlockUuid(containerRef.current) : null);
          if (!uuid) return;
          const fenced = "```" + entityType + "\n" + yaml + "\n```";
          await logseq.Editor.updateBlock(uuid, fenced);
          // Re-register in registry if entity page
          if (compCtx && registryRef) {
            const parsed = parser(yaml);
            if (parsed.success) {
              registryRef.register({
                slug: compCtx.slug,
                name: (parsed.data as any).name ?? compCtx.slug,
                entityType: compCtx.entityType,
                compendium: compCtx.compendium,
                filePath: "",
                readonly: compCtx.readonly,
                homebrew: false,
                data: parsed.data,
              });
            }
          }
          setMode("view");
        },
        onSaveAsNew: async (yaml: string, entityName: string) => {
          if (!managerRef) return;
          const el = containerRef.current;
          if (!el) return;
          // Show compendium picker
          const compendiums = managerRef.getWritable();
          if (compendiums.length === 0) {
            await logseq.UI.showMsg("No writable compendiums available", "warning");
            return;
          }
          if (compendiums.length === 1) {
            await saveToCompendium(compendiums[0], yaml, entityName);
          } else {
            showCompendiumPicker(el, compendiums, async (comp) => {
              await saveToCompendium(comp, yaml, entityName);
            });
          }
        },
        onCancel: () => setMode("view"),
      };
    }

    async function saveToCompendium(
      comp: { name: string },
      yaml: string,
      entityName: string,
    ) {
      if (!managerRef || !registryRef) return;
      const parsed = parser(yaml);
      if (!parsed.success) return;
      await managerRef.saveEntity(comp.name, entityType, {
        ...parsed.data,
        name: entityName,
      });
      await logseq.UI.showMsg(`Saved "${entityName}" to ${comp.name}`, "success");
      setMode("view");
    }

    return React.createElement("div", {
      ref: containerRef,
      className: "archivist-block",
      // Prevent Logseq from entering code-block edit mode when clicking
      // on the rendered stat block. Without this, any click causes Logseq
      // to show the raw YAML fenced code block.
      onMouseDown: (e: any) => e.stopPropagation(),
      onClick: (e: any) => e.stopPropagation(),
    });
  };
}

/**
 * Hide Logseq's native fenced-code-block toolbar (resize/refresh buttons).
 * Walks up from the plugin's rendered container through ancestor levels,
 * hiding any sibling elements that aren't part of the plugin's own rendering.
 * Stops after 5 levels or when reaching .ls-block.
 */
function hideLogseqCodeToolbar(el: HTMLElement): void {
  let node: HTMLElement | null = el;
  for (let depth = 0; depth < 5 && node; depth++) {
    const parent = node.parentElement;
    if (!parent) break;
    // Stop at the block boundary
    if (parent.classList.contains("ls-block")) break;

    // Hide siblings that are not our ancestor chain and not archivist elements
    for (const sibling of Array.from(parent.children)) {
      if (sibling === node) continue;
      const sibEl = sibling as HTMLElement;
      // Skip if it's an archivist element
      if (sibEl.classList?.contains("archivist-block")) continue;
      if (sibEl.querySelector?.(".archivist-block")) continue;
      // Hide toolbar-like elements (buttons, small utility divs with SVGs)
      if (sibEl.tagName === "BUTTON" ||
          sibEl.querySelector("button") ||
          sibEl.querySelector("svg") ||
          sibEl.classList?.contains("extensions__code-lang") ||
          sibEl.classList?.contains("extensions__code-calc")) {
        sibEl.style.display = "none";
      }
    }
    node = parent;
  }
}

async function main() {
  // Inject parchment + edit CSS
  logseq.provideStyle(css + "\n" + searchCss + "\n" + editCss);

  logseq.useSettingsSchema([
    {
      key: "defaultColumns",
      type: "boolean",
      default: false,
      title: "Two-column monster layout",
      description: "Render monster stat blocks in two-column layout by default",
    },
    {
      key: "defaultEditMode",
      type: "enum",
      enumChoices: ["view", "source"],
      default: "view",
      title: "Default block mode",
      description: "Whether stat blocks open in rendered view or raw YAML source",
    },
  ]);

  // Register fenced code block renderers
  logseq.Experiments.registerFencedCodeRenderer("monster", {
    render: createStatefulBlockRenderer("monster", parseMonster, renderMonsterBlock, renderMonsterEditMode, wireMonsterEditEvents, initMonsterTabs),
  });

  logseq.Experiments.registerFencedCodeRenderer("spell", {
    render: createStatefulBlockRenderer("spell", parseSpell, renderSpellBlock, renderSpellEditMode, wireSpellEditEvents),
  });

  logseq.Experiments.registerFencedCodeRenderer("item", {
    render: createStatefulBlockRenderer("item", parseItem, renderItemBlock, renderItemEditMode, wireItemEditEvents),
  });

  // Slash commands for quick templates
  logseq.Editor.registerSlashCommand("Monster Block", async () => {
    await logseq.Editor.insertAtEditingCursor(`\`\`\`monster
name: Monster Name
size: Medium
type: humanoid
alignment: neutral
cr: "1"
ac:
  - ac: 13
hp:
  average: 22
  formula: 4d8+4
speed:
  walk: 30
abilities:
  str: 14
  dex: 12
  con: 13
  int: 10
  wis: 11
  cha: 10
\`\`\``);
  });

  logseq.Editor.registerSlashCommand("Spell Block", async () => {
    await logseq.Editor.insertAtEditingCursor(`\`\`\`spell
name: Spell Name
level: 1
school: evocation
casting_time: 1 action
range: 60 feet
components: V, S
duration: Instantaneous
description:
  - "Spell description here."
\`\`\``);
  });

  logseq.Editor.registerSlashCommand("Item Block", async () => {
    await logseq.Editor.insertAtEditingCursor(`\`\`\`item
name: Item Name
type: wondrous item
rarity: uncommon
attunement: true
entries:
  - "Item description here."
\`\`\``);
  });

  // --- Phase 2: Entity & Compendium System ---
  const srdStore = new SrdStore();
  srdStore.loadFromBundledJson();

  const registry = new EntityRegistry();
  const manager = new CompendiumManager(registry, logseq as any);

  await manager.discover();
  await manager.loadAllEntities();

  managerRef = manager;
  registryRef = registry;

  initEntitySearch(registry);

  // --- Phase 4: CM6 Editor Extensions ---
  setCompendiumRefRegistry(registry);
  setCompendiumRefManager(manager);
  setCompendiumSuggestRegistry(registry);

  // --- Phase 4: Macro-based compendium ref rendering (read mode) ---
  const MACRO_ENTITY_TYPES = new Set(["monster", "spell", "item"]);

  logseq.App.onMacroRendererSlotted(({ slot, payload }) => {
    const [type, ...args] = payload.arguments;
    if (!type) return;

    const typeClean = type.startsWith(":") ? type.slice(1) : type;
    if (!MACRO_ENTITY_TYPES.has(typeClean)) return;

    const slug = args[0]?.trim();
    if (!slug) return;

    const entity = registry.getBySlug(slug);
    if (!entity) {
      logseq.provideUI({
        key: `archivist-ref-${slot}`,
        slot,
        template: `<div class="archivist-compendium-ref-error">
          <div class="archivist-not-found-text">
            <div class="archivist-not-found-label">Entity not found</div>
            <div class="archivist-not-found-ref">${escapeHtml(typeClean)}:${escapeHtml(slug)}</div>
          </div>
        </div>`,
        reset: true,
      });
      return;
    }

    // Type mismatch check
    if (entity.entityType !== typeClean) {
      logseq.provideUI({
        key: `archivist-ref-${slot}`,
        slot,
        template: `<div class="archivist-compendium-ref-error">
          <div class="archivist-not-found-text">
            <div class="archivist-not-found-label">Type mismatch</div>
            <div class="archivist-not-found-ref">Expected ${escapeHtml(typeClean)}, found ${escapeHtml(entity.entityType)}</div>
          </div>
        </div>`,
        reset: true,
      });
      return;
    }

    // Render entity stat block
    const yamlStr = yaml.dump(entity.data, { lineWidth: -1, noRefs: true });
    let blockHtml = "";

    if (entity.entityType === "monster") {
      const result = parseMonster(yamlStr);
      if (result.success) blockHtml = renderMonsterBlock(result.data, 1);
    } else if (entity.entityType === "spell") {
      const result = parseSpell(yamlStr);
      if (result.success) blockHtml = renderSpellBlock(result.data);
    } else if (entity.entityType === "item") {
      const result = parseItem(yamlStr);
      if (result.success) blockHtml = renderItemBlock(result.data);
    }

    if (!blockHtml) return;

    logseq.provideUI({
      key: `archivist-ref-${slot}`,
      slot,
      template: `<div class="archivist-block archivist-compendium-ref">${blockHtml}
        <div class="archivist-compendium-badge">${escapeHtml(entity.compendium)}</div>
      </div>`,
      reset: true,
      style: { width: "100%" },
    });
  });

  // --- Phase 4: CM6 Editor Extensions ---
  logseq.Experiments.registerExtensionsEnhancer("codemirror", async (cm: any) => {
    const extensions: any[] = [];

    // Inline tag pills (edit mode only)
    extensions.push(createInlineTagExtension(cm));

    // Compendium autocomplete (may not be available if CM6 autocomplete module is missing)
    const completion = createCompendiumCompletion(cm);
    if (completion && (!Array.isArray(completion) || completion.length > 0)) {
      extensions.push(completion);
    }

    return extensions;
  });

  logseq.App.registerCommandPalette(
    { key: "archivist-import-srd", label: "Archivist: Import SRD Compendium" },
    async () => {
      const existing = manager.getByName("SRD");
      if (existing) {
        await logseq.UI.showMsg("SRD compendium already imported", "warning");
        return;
      }
      await logseq.UI.showMsg("Importing SRD compendium...", "success", { timeout: 3000 });
      const count = await importSrdToLogseq(
        srdStore, manager, registry, logseq as any,
        (current, total) => {
          logseq.UI.showMsg(
            `Importing SRD: ${current}/${total} entities...`,
            "success",
            { key: "srd-import-progress", timeout: 10000 },
          );
        },
      );
      await logseq.UI.showMsg(
        `SRD import complete: ${count} entities imported`,
        "success",
        { key: "srd-import-progress", timeout: 5000 },
      );
    },
  );

  logseq.App.registerCommandPalette(
    { key: "archivist-search-entity", label: "Archivist: Search Entity" },
    async () => { await showSearch(); },
  );

  console.log("Archivist TTRPG Blocks loaded (Phase 1 + 2 + 3 + 4 CM6 extensions)");
}

logseq.ready(main).catch(console.error);
