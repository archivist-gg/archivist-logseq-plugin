# Phase 3: Edit Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Obsidian plugin's edit mode to Logseq -- in-place stat block editing with custom controls, side buttons, compendium save flows, and settings.

**Architecture:** Fenced code renderers become stateful React components with view/edit/source modes. Edit forms are rendered as HTML strings with `data-field` attributes, then event listeners are attached post-render. Save persists via DOM traversal to find block UUID, then `Editor.updateBlock()`. Compendium context is detected by querying entity page properties.

**Tech Stack:** TypeScript, React (host instance via `logseq.Experiments.React`), Logseq Plugin API (`@logseq/libs`), Vitest, HTML string rendering pattern (matching Phase 1).

**Reference code:** The Obsidian source files are at `~/w/archivist-obsidian/src/edit/`. Read them for detailed control structure and D&D logic. This plan shows Logseq-adapted code; the Obsidian files are the authoritative reference for field layouts, D&D constants, and calculation logic.

**HTML safety note:** All rendered HTML strings use `escapeHtml()` on user-provided values before interpolation. This is the same safe pattern used by Phase 1's renderers. DOM content is set via `el.innerHTML` with pre-escaped strings -- not raw user input.

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `src/edit/block-utils.ts` | Create | DOM traversal for block UUID + compendium context detection |
| `src/edit/edit-state.ts` | Copy | `MonsterEditState` -- reactive state container (from Obsidian) |
| `src/edit/side-buttons.ts` | Create | Side button stack as HTML strings + event wiring |
| `src/edit/searchable-tag-select.ts` | Create | Searchable multi-select tag component |
| `src/edit/compendium-picker.ts` | Create | Inline compendium picker dropdown |
| `src/edit/monster-edit-render.ts` | Create | Monster edit form (render HTML + wire events) |
| `src/edit/spell-edit-render.ts` | Create | Spell edit form (render HTML + wire events) |
| `src/edit/item-edit-render.ts` | Create | Item edit form (render HTML + wire events) |
| `src/edit/tag-autocomplete.ts` | Create | Backtick-triggered formula tag autocomplete |
| `src/styles/archivist-edit.css` | Create | Edit mode CSS (adapted from Obsidian) |
| `src/renderers/renderer-utils.ts` | Modify | Add new Lucide icon SVG paths |
| `src/index.ts` | Modify | Stateful React components, settings, edit CSS injection |
| `tests/edit/block-utils.test.ts` | Create | Tests for block context discovery |
| `tests/edit/side-buttons.test.ts` | Create | Tests for side button HTML output |
| `tests/edit/monster-edit-render.test.ts` | Create | Tests for monster edit form HTML output |
| `tests/edit/spell-edit-render.test.ts` | Create | Tests for spell edit form HTML output |
| `tests/edit/item-edit-render.test.ts` | Create | Tests for item edit form HTML output |

---

### Task 1: Block Context Discovery

**Files:**
- Create: `src/edit/block-utils.ts`
- Test: `tests/edit/block-utils.test.ts`

- [ ] **Step 1: Write failing tests for `findBlockUuid`**

```ts
// tests/edit/block-utils.test.ts
import { describe, it, expect } from "vitest";
import { findBlockUuid } from "../../src/edit/block-utils";

describe("findBlockUuid", () => {
  it("finds blockid from ancestor .ls-block element", () => {
    const block = document.createElement("div");
    block.classList.add("ls-block");
    block.setAttribute("blockid", "abc-123-def");
    const inner = document.createElement("div");
    const target = document.createElement("div");
    inner.appendChild(target);
    block.appendChild(inner);

    expect(findBlockUuid(target)).toBe("abc-123-def");
  });

  it("returns null when no .ls-block ancestor exists", () => {
    const orphan = document.createElement("div");
    expect(findBlockUuid(orphan)).toBeNull();
  });

  it("finds nearest .ls-block in nested structure", () => {
    const outer = document.createElement("div");
    outer.classList.add("ls-block");
    outer.setAttribute("blockid", "outer-id");
    const inner = document.createElement("div");
    inner.classList.add("ls-block");
    inner.setAttribute("blockid", "inner-id");
    const target = document.createElement("div");
    inner.appendChild(target);
    outer.appendChild(inner);

    expect(findBlockUuid(target)).toBe("inner-id");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/w/archivist-logseq && npx vitest run tests/edit/block-utils.test.ts`
Expected: FAIL -- module not found

- [ ] **Step 3: Implement `block-utils.ts`**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/w/archivist-logseq && npx vitest run tests/edit/block-utils.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
cd ~/w/archivist-logseq && git add src/edit/block-utils.ts tests/edit/block-utils.test.ts && git commit -m "feat: add block context discovery for edit mode"
```

---

### Task 2: Copy Edit State

**Files:**
- Copy: `src/edit/edit-state.ts` (from `~/w/archivist-obsidian/src/edit/edit-state.ts`)

- [ ] **Step 1: Copy edit-state.ts from Obsidian**

```bash
cp ~/w/archivist-obsidian/src/edit/edit-state.ts ~/w/archivist-logseq/src/edit/edit-state.ts
```

- [ ] **Step 2: Verify imports resolve**

Run: `cd ~/w/archivist-logseq && npx vitest run --passWithNoTests`
Expected: Build succeeds. The file imports from `../dnd/editable-monster`, `../dnd/recalculate`, `../dnd/yaml-serializer`, `../types/monster` -- all already present in the Logseq project from Phase 1.

- [ ] **Step 3: Commit**

```bash
cd ~/w/archivist-logseq && git add src/edit/edit-state.ts && git commit -m "feat: copy MonsterEditState from archivist-obsidian"
```

---

### Task 3: Add Lucide Icons to Renderer Utils

**Files:**
- Modify: `src/renderers/renderer-utils.ts`

The existing `lucideIcon()` function has a hardcoded `ICON_PATHS` dict. Edit mode needs additional icons for side buttons, spinners, and controls.

- [ ] **Step 1: Read current icon list**

Read `src/renderers/renderer-utils.ts` and find the `ICON_PATHS` dictionary. Note which icons already exist.

- [ ] **Step 2: Add missing icons**

Add these icons to the `ICON_PATHS` dictionary in `renderer-utils.ts`. Each icon is an SVG path string that goes inside a 24x24 viewBox. Get the exact SVG path data from the Lucide icon library (https://lucide.dev/icons/).

Icons needed for edit mode:
- `code` -- source toggle button
- `columns-2` -- column toggle button
- `pencil` -- edit button
- `trash-2` -- delete button
- `file-x` -- remove reference
- `book-x` -- delete from compendium
- `x` -- cancel / close
- `check` -- save confirmation
- `plus` -- add feature/section
- `minus` -- remove
- `chevron-down` -- dropdown arrow
- `chevron-up` -- collapse arrow
- `refresh-cw` -- recharge (item edit)
- `pen-line` -- edit (alternative)
- `save` -- save button

For each icon, add an entry like:
```ts
"code": '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
```

Check which of `zap`, `skull`, `book-open` already exist (they were added in Phase 1) -- skip any that are already present.

- [ ] **Step 3: Run existing tests**

Run: `cd ~/w/archivist-logseq && npx vitest run`
Expected: All existing tests still pass.

- [ ] **Step 4: Commit**

```bash
cd ~/w/archivist-logseq && git add src/renderers/renderer-utils.ts && git commit -m "feat: add Lucide icons for edit mode side buttons and controls"
```

---

### Task 4: Edit CSS

**Files:**
- Create: `src/styles/archivist-edit.css`

- [ ] **Step 1: Copy Obsidian edit CSS as starting point**

```bash
cp ~/w/archivist-obsidian/src/styles/archivist-edit.css ~/w/archivist-logseq/src/styles/archivist-edit.css
```

- [ ] **Step 2: Strip Obsidian-specific selectors**

Open `src/styles/archivist-edit.css` and make these changes:

1. **Remove the "Obsidian Override Reset" section** (lines ~8-60 in Obsidian). These override Obsidian's `.markdown-rendered` dark theme styles -- not needed in Logseq.

2. **Replace Obsidian CSS variables** with hardcoded parchment values:
   - `var(--background-modifier-border)` -> `#d9c484`
   - `var(--background-modifier-hover)` -> `rgba(253, 241, 220, 0.5)`
   - `var(--text-muted)` -> `#7a200d`
   - `var(--text-faint)` -> `#999`
   - Any other `var(--background-modifier-*)` or `var(--text-*)` Obsidian variables

3. **Strip CodeMirror selectors**: Remove any rules targeting `.cm-editor`, `.cm-line`, `.cm-widget`, `.cm-content`.

4. **Scope under `.archivist-block`**: Prefix top-level selectors. Example:
   - `.archivist-monster-block.editing` -> `.archivist-block .archivist-monster-block.editing`
   - `.archivist-side-btns` -> `.archivist-block .archivist-side-btns`

5. **Add Logseq reset overrides** at the top:

```css
/* Logseq Override Reset -- prevent host styles from leaking into edit controls */
.archivist-block input,
.archivist-block textarea,
.archivist-block select,
.archivist-block button {
  all: revert;
  font-family: "Noto Sans", "Helvetica Neue", Helvetica, Arial, sans-serif;
  font-size: 13px;
  color: #191813;
}
```

- [ ] **Step 3: Verify CSS parses**

Run: `cd ~/w/archivist-logseq && npm run build`
Expected: Build succeeds (CSS is imported as raw string, parsing happens at build time via Vite).

- [ ] **Step 4: Commit**

```bash
cd ~/w/archivist-logseq && git add src/styles/archivist-edit.css && git commit -m "feat: adapt edit mode CSS from Obsidian for Logseq"
```

---

### Task 5: Side Buttons

**Files:**
- Create: `src/edit/side-buttons.ts`
- Test: `tests/edit/side-buttons.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/edit/side-buttons.test.ts
import { describe, it, expect } from "vitest";
import { renderSideButtons } from "../../src/edit/side-buttons";

describe("renderSideButtons", () => {
  it("renders source + columns + edit + trash for monster in default state", () => {
    const html = renderSideButtons({
      state: "default",
      showColumnToggle: true,
      isColumnActive: false,
      compendiumContext: null,
    });
    expect(html).toContain('data-action="source"');
    expect(html).toContain('data-action="column-toggle"');
    expect(html).toContain('data-action="edit"');
    expect(html).toContain('data-action="trash"');
  });

  it("renders source + edit + trash for spell (no column toggle)", () => {
    const html = renderSideButtons({
      state: "default",
      showColumnToggle: false,
      isColumnActive: false,
      compendiumContext: null,
    });
    expect(html).toContain('data-action="source"');
    expect(html).not.toContain('data-action="column-toggle"');
    expect(html).toContain('data-action="edit"');
    expect(html).toContain('data-action="trash"');
  });

  it("renders save + save-as-new + cancel in editing state with compendium", () => {
    const html = renderSideButtons({
      state: "editing",
      showColumnToggle: false,
      isColumnActive: false,
      compendiumContext: { slug: "goblin", compendium: "SRD", entityType: "monster", readonly: false },
    });
    expect(html).toContain('data-action="save"');
    expect(html).toContain('data-action="save-as-new"');
    expect(html).toContain('data-action="cancel"');
  });

  it("hides save button for readonly compendium", () => {
    const html = renderSideButtons({
      state: "editing",
      showColumnToggle: false,
      isColumnActive: false,
      compendiumContext: { slug: "goblin", compendium: "SRD", entityType: "monster", readonly: true },
    });
    expect(html).not.toContain('data-action="save"');
    expect(html).toContain('data-action="save-as-new"');
    expect(html).toContain('data-action="cancel"');
  });

  it("renders save + cancel without compendium context", () => {
    const html = renderSideButtons({
      state: "editing",
      showColumnToggle: false,
      isColumnActive: false,
      compendiumContext: null,
    });
    expect(html).toContain('data-action="save"');
    expect(html).not.toContain('data-action="save-as-new"');
    expect(html).toContain('data-action="cancel"');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/w/archivist-logseq && npx vitest run tests/edit/side-buttons.test.ts`
Expected: FAIL -- module not found

- [ ] **Step 3: Implement side-buttons.ts**

Read `~/w/archivist-obsidian/src/edit/side-buttons.ts` (145 lines) for the full button state logic. Rewrite as HTML string output.

```ts
// src/edit/side-buttons.ts
import { lucideIcon } from "../renderers/renderer-utils";
import type { CompendiumContext } from "./block-utils";

export type SideButtonState = "default" | "editing";

export interface SideButtonConfig {
  state: SideButtonState;
  showColumnToggle: boolean;
  isColumnActive: boolean;
  compendiumContext: CompendiumContext | null;
}

export interface SideButtonCallbacks {
  onSource: () => void;
  onColumnToggle: () => void;
  onEdit: () => void;
  onSave: () => void;
  onSaveAsNew: () => void;
  onCancel: () => void;
  onDeleteBlock: () => void;
  onDeleteEntity?: () => void;
}

export function renderSideButtons(config: SideButtonConfig): string {
  const { state, showColumnToggle, isColumnActive, compendiumContext } = config;
  let buttons = "";

  if (state === "editing") {
    if (compendiumContext) {
      if (!compendiumContext.readonly) {
        buttons += sideBtn("save", "check", "archivist-side-btn-save");
      }
      buttons += sideBtn("save-as-new", "plus", "archivist-side-btn-save-as-new");
    } else {
      buttons += sideBtn("save", "check", "archivist-side-btn-save");
    }
    buttons += sideBtn("cancel", "x", "archivist-side-btn-cancel");
  } else {
    buttons += sideBtn("source", "code");
    if (showColumnToggle) {
      buttons += sideBtn("column-toggle", "columns-2", isColumnActive ? "archivist-side-btn active" : "");
    }
    buttons += sideBtn("edit", "pencil");
    buttons += sideBtn("trash", "trash-2");
  }

  return `<div class="archivist-side-btns">${buttons}</div>`;
}

function sideBtn(action: string, icon: string, extraClass?: string): string {
  const cls = `archivist-side-btn${extraClass ? " " + extraClass : ""}`;
  return `<button class="${cls}" data-action="${action}" title="${action}">${lucideIcon(icon)}</button>`;
}

export function renderDeleteMenu(hasCompendiumContext: boolean): string {
  let menu = `<div class="archivist-delete-menu">`;
  menu += sideBtn("cancel-delete", "x", "archivist-side-btn-cancel");
  menu += sideBtn("delete-block", "file-x", "archivist-delete-sub-btn");
  if (hasCompendiumContext) {
    menu += sideBtn("delete-entity", "book-x", "archivist-delete-sub-btn archivist-delete-entity-btn");
  }
  menu += `</div>`;
  return menu;
}

export function wireSideButtonEvents(
  container: HTMLElement,
  callbacks: SideButtonCallbacks,
): void {
  container.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("[data-action]");
    if (!btn) return;
    e.stopPropagation();

    const action = btn.getAttribute("data-action");
    switch (action) {
      case "source": callbacks.onSource(); break;
      case "column-toggle": callbacks.onColumnToggle(); break;
      case "edit": callbacks.onEdit(); break;
      case "save": callbacks.onSave(); break;
      case "save-as-new": callbacks.onSaveAsNew(); break;
      case "cancel": callbacks.onCancel(); break;
      case "trash": handleTrashClick(container, callbacks); break;
      case "cancel-delete": closeDeleteMenu(container); break;
      case "delete-block": callbacks.onDeleteBlock(); break;
      case "delete-entity": callbacks.onDeleteEntity?.(); break;
    }
  });
}

function handleTrashClick(container: HTMLElement, callbacks: SideButtonCallbacks): void {
  const btns = container.querySelector(".archivist-side-btns");
  if (!btns) return;
  const trashBtn = btns.querySelector('[data-action="trash"]');
  if (!trashBtn) return;
  const hasEntity = !!callbacks.onDeleteEntity;
  trashBtn.outerHTML = renderDeleteMenu(hasEntity);
  btns.classList.add("archivist-delete-menu-open");
}

function closeDeleteMenu(container: HTMLElement): void {
  const btns = container.querySelector(".archivist-side-btns");
  if (!btns) return;
  btns.classList.remove("archivist-delete-menu-open");
  const menu = btns.querySelector(".archivist-delete-menu");
  if (menu) {
    menu.outerHTML = sideBtn("trash", "trash-2");
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/w/archivist-logseq && npx vitest run tests/edit/side-buttons.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
cd ~/w/archivist-logseq && git add src/edit/side-buttons.ts tests/edit/side-buttons.test.ts && git commit -m "feat: add side button stack for stat block edit mode"
```

---

### Task 6: Searchable Tag Select

**Files:**
- Create: `src/edit/searchable-tag-select.ts`

This is an event-heavy DOM component. Port from `~/w/archivist-obsidian/src/edit/searchable-tag-select.ts` (159 lines) replacing Obsidian's DOM helpers with standard DOM APIs.

- [ ] **Step 1: Create searchable-tag-select.ts**

Port the Obsidian version with these substitutions:
- `container.createDiv(cls)` -> `const div = document.createElement("div"); div.className = cls; container.appendChild(div);`
- `wrapper.createEl("input")` -> `const input = document.createElement("input"); wrapper.appendChild(input);`
- `wrapper.addClass(cls)` -> `wrapper.classList.add(cls)`
- `wrapper.removeClass(cls)` -> `wrapper.classList.remove(cls)`
- `container.empty()` -> `container.textContent = ""`

Keep the same exported interface:

```ts
export interface SearchableTagSelectOptions {
  container: HTMLElement;
  presets: string[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}

export function createSearchableTagSelect(options: SearchableTagSelectOptions): void;
```

Read `~/w/archivist-obsidian/src/edit/searchable-tag-select.ts` for the full implementation. Port line-by-line replacing Obsidian DOM helpers as described above. Key behaviors to preserve:
- Pill tags for selected values with x to remove
- Filtered dropdown on focus/typing
- Already-selected items greyed with strikethrough
- Keyboard navigation (ArrowDown/Up, Enter, Escape, Backspace)
- Custom value via "+ Add custom: ..." option
- 150ms blur delay for click event timing

All CSS classes remain the same: `archivist-tag-select`, `archivist-tag-pill-row`, `archivist-tag-input`, `archivist-tag-pill`, `archivist-tag-pill-x`, `archivist-tag-dropdown`, `archivist-tag-dropdown-item`, `archivist-tag-dropdown-item-highlighted`, `archivist-tag-dropdown-item-selected`, `archivist-tag-dropdown-custom`, `archivist-tag-select-focused`.

- [ ] **Step 2: Build to verify no compile errors**

Run: `cd ~/w/archivist-logseq && npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
cd ~/w/archivist-logseq && git add src/edit/searchable-tag-select.ts && git commit -m "feat: port searchable tag select component for edit mode"
```

---

### Task 7: Compendium Picker

**Files:**
- Create: `src/edit/compendium-picker.ts`

The Obsidian version (49 lines) already uses vanilla DOM. Near-direct copy.

- [ ] **Step 1: Create compendium-picker.ts**

```ts
// src/edit/compendium-picker.ts

export function showCompendiumPicker(
  anchor: HTMLElement,
  compendiums: { name: string }[],
  onSelect: (compendium: { name: string }) => void,
): void {
  // Remove any existing picker
  const existing = anchor.querySelector(".archivist-compendium-picker");
  if (existing) existing.remove();

  const picker = document.createElement("div");
  picker.className = "archivist-compendium-picker";

  for (const comp of compendiums) {
    const option = document.createElement("div");
    option.className = "archivist-compendium-picker-option";
    option.textContent = comp.name;
    option.addEventListener("click", (e) => {
      e.stopPropagation();
      cleanup();
      onSelect(comp);
    });
    picker.appendChild(option);
  }

  anchor.appendChild(picker);

  const onOutsideClick = (e: MouseEvent) => {
    if (!picker.contains(e.target as Node)) {
      cleanup();
    }
  };

  function cleanup(): void {
    picker.remove();
    document.removeEventListener("click", onOutsideClick, true);
  }

  setTimeout(() => {
    document.addEventListener("click", onOutsideClick, true);
  }, 0);
}
```

- [ ] **Step 2: Build to verify**

Run: `cd ~/w/archivist-logseq && npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
cd ~/w/archivist-logseq && git add src/edit/compendium-picker.ts && git commit -m "feat: add inline compendium picker for save-as-new flow"
```

---

### Task 8: Stateful React Components + Settings

**Files:**
- Modify: `src/index.ts`

This task converts the fenced code renderers from stateless to stateful (view/edit/source modes with side buttons). Also adds settings schema and edit CSS injection.

- [ ] **Step 1: Read current index.ts**

Read `~/w/archivist-logseq/src/index.ts` to understand the current `createBlockRenderer` factory and renderer registration pattern.

- [ ] **Step 2: Add imports for edit mode modules**

At the top of `index.ts`, add:

```ts
import editCss from "./styles/archivist-edit.css?raw";
import { findBlockUuid, getCompendiumContext } from "./edit/block-utils";
import type { CompendiumContext } from "./edit/block-utils";
import { renderSideButtons, wireSideButtonEvents } from "./edit/side-buttons";
import type { SideButtonCallbacks } from "./edit/side-buttons";
import { showCompendiumPicker } from "./edit/compendium-picker";
import { escapeHtml, renderErrorBlock } from "./renderers/renderer-utils";
```

- [ ] **Step 3: Add edit CSS injection and settings schema**

In the `main()` function, after the existing `logseq.provideStyle(css)` call, add:

```ts
logseq.provideStyle(editCss);

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
```

- [ ] **Step 4: Add module-level refs**

At module scope in `index.ts`:

```ts
let managerRef: CompendiumManager | null = null;
let registryRef: EntityRegistry | null = null;
```

In `main()`, after creating the manager and registry:

```ts
managerRef = manager;
registryRef = registry;
```

- [ ] **Step 5: Define the EditCallbacks interface**

```ts
export interface EditCallbacks {
  onSave: (yaml: string) => Promise<void>;
  onSaveAsNew: (yaml: string, entityName: string) => Promise<void>;
  onCancel: () => void;
}
```

- [ ] **Step 6: Rewrite createBlockRenderer as stateful component factory**

Replace the existing `createBlockRenderer` function. The new factory creates React components with view/edit/source modes, side buttons, and full save/cancel/delete flows.

Key structure:
- Uses `React.useState` for `mode`, `blockUuid`, `compCtx`, `columns`
- Uses `React.useEffect` triggered by `[content, mode, columns, compCtx]`
- In the effect: parses content, renders appropriate mode (view/edit/source), wires side button events
- `buildCallbacks` function creates `SideButtonCallbacks` that handle mode transitions
- `buildEditCallbacks` function creates `EditCallbacks` for save/cancel flows
- Save flow: `editableToYaml()` -> wrap in fenced code block -> `Editor.updateBlock(uuid, fenced)` -> if entity page, re-register in registry

Read the spec (Section 2: Edit Mode Lifecycle, Section 5: Compendium Edit Flows) for the exact save/saveAsNew/delete logic.

The function signature:

```ts
function createStatefulBlockRenderer(
  entityType: "monster" | "spell" | "item",
  parser: (content: string) => { success: boolean; data?: unknown; error?: string },
  viewRenderer: (data: unknown, columns?: number) => string,
  editRenderer: ((data: unknown, ctx: CompendiumContext | null) => string) | null,
  wireEdit: ((container: HTMLElement, data: unknown, ctx: CompendiumContext | null, callbacks: EditCallbacks) => void) | null,
  postRender?: (container: HTMLElement) => void,
): (props: { content: string }) => unknown;
```

- [ ] **Step 7: Update renderer registrations**

Initially pass `null` for editRenderer/wireEdit (wired in Tasks 9-11):

```ts
logseq.Experiments.registerFencedCodeRenderer("monster", {
  render: createStatefulBlockRenderer("monster", parseMonster, renderMonsterBlock, null, null, initMonsterTabs),
});
logseq.Experiments.registerFencedCodeRenderer("spell", {
  render: createStatefulBlockRenderer("spell", parseSpell, renderSpellBlock, null, null),
});
logseq.Experiments.registerFencedCodeRenderer("item", {
  render: createStatefulBlockRenderer("item", parseItem, renderItemBlock, null, null),
});
```

- [ ] **Step 8: Build to verify**

Run: `cd ~/w/archivist-logseq && npm run build`
Expected: Build succeeds. Side buttons now appear on all rendered stat blocks.

- [ ] **Step 9: Commit**

```bash
cd ~/w/archivist-logseq && git add src/index.ts && git commit -m "feat: convert fenced code renderers to stateful components with side buttons and settings"
```

---

### Task 9: Monster Edit Renderer

**Files:**
- Create: `src/edit/monster-edit-render.ts`
- Test: `tests/edit/monster-edit-render.test.ts`

The largest task. Port from `~/w/archivist-obsidian/src/edit/monster-edit-render.ts` (1413 lines). Rewrite all DOM creation to HTML string output + `data-field` event wiring.

- [ ] **Step 1: Write failing tests for the render function**

```ts
// tests/edit/monster-edit-render.test.ts
import { describe, it, expect } from "vitest";
import { renderMonsterEditMode } from "../../src/edit/monster-edit-render";

const testMonster = {
  name: "Goblin",
  size: "Small",
  type: "humanoid (goblinoid)",
  alignment: "neutral evil",
  ac: [{ ac: 15, from: ["leather armor", "shield"] }],
  hp: { average: 7, formula: "2d6" },
  speed: { walk: 30 },
  abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
  cr: "1/4",
  traits: [{ name: "Nimble Escape", entries: ["The goblin can take the Disengage or Hide action as a bonus action."] }],
  actions: [{ name: "Scimitar", entries: ["`atk:DEX` `damage:1d6+DEX` slashing damage."] }],
};

describe("renderMonsterEditMode", () => {
  it("renders name input with monster name", () => {
    const html = renderMonsterEditMode(testMonster as any, null);
    expect(html).toContain('data-field="name"');
    expect(html).toContain('value="Goblin"');
  });

  it("renders ability score inputs for all 6 abilities", () => {
    const html = renderMonsterEditMode(testMonster as any, null);
    for (const abil of ["str", "dex", "con", "int", "wis", "cha"]) {
      expect(html).toContain(`data-field="abilities.${abil}"`);
    }
  });

  it("renders AC input", () => {
    const html = renderMonsterEditMode(testMonster as any, null);
    expect(html).toContain('data-field="ac.ac"');
    expect(html).toContain('value="15"');
  });

  it("renders speed walk input", () => {
    const html = renderMonsterEditMode(testMonster as any, null);
    expect(html).toContain('data-field="speed.walk"');
    expect(html).toContain('value="30"');
  });

  it("renders section tabs", () => {
    const html = renderMonsterEditMode(testMonster as any, null);
    expect(html).toContain("archivist-section-tabs");
  });

  it("renders feature cards for existing sections", () => {
    const html = renderMonsterEditMode(testMonster as any, null);
    expect(html).toContain("Nimble Escape");
    expect(html).toContain("Scimitar");
  });

  it("adds editing class to block", () => {
    const html = renderMonsterEditMode(testMonster as any, null);
    expect(html).toContain("editing");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/w/archivist-logseq && npx vitest run tests/edit/monster-edit-render.test.ts`
Expected: FAIL -- module not found

- [ ] **Step 3: Implement renderMonsterEditMode and wireMonsterEditEvents**

Create `src/edit/monster-edit-render.ts`. This file exports two functions:

```ts
export function renderMonsterEditMode(monster: Monster, compendiumContext: CompendiumContext | null): string;
export function wireMonsterEditEvents(container: HTMLElement, monster: Monster, compendiumContext: CompendiumContext | null, callbacks: EditCallbacks): void;
```

Read `~/w/archivist-obsidian/src/edit/monster-edit-render.ts` (1413 lines) as the authoritative reference. Port each section, converting DOM creation to HTML string building.

**Imports:**
```ts
import { escapeHtml, createSvgBar, lucideIcon } from "../renderers/renderer-utils";
import type { Monster, MonsterFeature, MonsterAbilities } from "../types/monster";
import { monsterToEditable } from "../dnd/editable-monster";
import type { EditableMonster } from "../dnd/editable-monster";
import { MonsterEditState } from "./edit-state";
import { createSearchableTagSelect } from "./searchable-tag-select";
import type { CompendiumContext } from "./block-utils";
import type { EditCallbacks } from "../index";
import { ABILITY_KEYS, ABILITY_NAMES, ALL_SIZES, ALL_SKILLS, SKILL_ABILITY, STANDARD_SENSES, ALL_SECTIONS, ALIGNMENT_ETHICAL, ALIGNMENT_MORAL, ALL_CR_VALUES, DAMAGE_TYPES, DAMAGE_NONMAGICAL_VARIANTS, CONDITIONS } from "../dnd/constants";
import { abilityModifier, formatModifier, savingThrow, skillBonus, passivePerception } from "../dnd/math";
```

**Key helper patterns:**

Number spinner HTML:
```ts
function numSpinner(field: string, value: number, min?: number, max?: number): string {
  return `<div class="archivist-num-wrap"><input type="number" data-field="${field}" value="${value}"${min != null ? ` min="${min}"` : ""}${max != null ? ` max="${max}"` : ""} /><button class="archivist-spin-up" data-spin-for="${field}"><svg viewBox="0 0 10 6"><polygon points="5,0 10,6 0,6"/></svg></button><button class="archivist-spin-down" data-spin-for="${field}"><svg viewBox="0 0 10 6"><polygon points="0,0 10,0 5,6"/></svg></button></div>`;
}
```

Collapsible section HTML:
```ts
function collapsible(title: string, count: number, startOpen: boolean, contentHtml: string): string {
  const arrowCls = startOpen ? "archivist-collapse-arrow open" : "archivist-collapse-arrow";
  return `<div class="archivist-collapse" data-collapse="${title}"><div class="archivist-collapse-header"><span class="${arrowCls}">&#9654;</span><span class="archivist-collapse-title">${escapeHtml(title)}</span><span class="archivist-collapse-count">(${count})</span></div><div class="archivist-collapse-body"${startOpen ? "" : ' style="display:none"'}>${contentHtml}</div></div>`;
}
```

Feature card HTML:
```ts
function featureCard(sectionKey: string, index: number, feature: MonsterFeature): string {
  const nameVal = escapeHtml(feature.name ?? "");
  const textVal = escapeHtml(feature.entries?.join("\n") ?? "");
  return `<div class="archivist-feat-card" data-section="${sectionKey}" data-index="${index}"><div class="archivist-feat-card-header"><input class="archivist-feat-name-input" data-field="feature-name" data-section="${sectionKey}" data-index="${index}" value="${nameVal}" placeholder="Feature name" /><button class="archivist-feat-remove" data-action="remove-feature" data-section="${sectionKey}" data-index="${index}" title="Remove">${lucideIcon("x")}</button></div><textarea class="archivist-feat-text-input" data-field="feature-text" data-section="${sectionKey}" data-index="${index}" rows="3" placeholder="Feature description...">${textVal}</textarea></div>`;
}
```

**renderMonsterEditMode structure:** Build `parts: string[]` array with these sections in order:
1. Wrapper div with `editing` class
2. Header (name input, size select, type input, alignment selects)
3. SVG bar
4. Core properties (AC spinner + source, HP display + formula, Speed walk + extras)
5. SVG bar
6. Abilities table (6 spinners + modifier displays)
7. SVG bar
8. Saves (collapsible, 6 toggle+value rows)
9. Skills (collapsible, all D&D skills with cycling toggles)
10. Damage vulnerabilities/resistances/immunities + condition immunities (4 collapsible tag-select containers)
11. Senses (collapsible, standard + custom)
12. Languages (text input)
13. CR (select + XP display)
14. SVG bar
15. Tab bar + tab content panels with feature cards

**wireMonsterEditEvents:** Create `MonsterEditState(monster, onChange)`. Wire each control type:
- `wireSpinner(container, field, onUpdate)` for number spinners
- `wireCollapsibles(container)` for collapsible toggle
- `wireSaveToggles(container, state)` for saving throw proficiency
- `wireSkillToggles(container, state)` for skill proficiency cycling
- `wireDamageConditionSelects(container, state)` for tag selects (calls `createSearchableTagSelect`)
- `wireTabBar(container, state)` for section tab switching
- `wireFeatureCards(container, state)` for feature name/text editing, add/remove
- Wire save/cancel buttons to `callbacks.onSave(state.toYaml())` / `callbacks.onCancel()`

Port `updateDom(container, state)` to update computed values (HP, XP, modifiers, saves, skills, PP) using `data-display` attribute selectors.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/w/archivist-logseq && npx vitest run tests/edit/monster-edit-render.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Wire monster edit renderer into index.ts**

```ts
import { renderMonsterEditMode, wireMonsterEditEvents } from "./edit/monster-edit-render";
```

Update monster registration to pass the edit renderer and wire function instead of `null`.

- [ ] **Step 6: Build and verify**

Run: `cd ~/w/archivist-logseq && npm run build`
Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
cd ~/w/archivist-logseq && git add src/edit/monster-edit-render.ts tests/edit/monster-edit-render.test.ts src/index.ts && git commit -m "feat: add monster edit renderer with full control suite"
```

---

### Task 10: Spell Edit Renderer

**Files:**
- Create: `src/edit/spell-edit-render.ts`
- Test: `tests/edit/spell-edit-render.test.ts`

Port from `~/w/archivist-obsidian/src/edit/spell-edit-render.ts` (385 lines). Uses mutable draft clone (not `MonsterEditState`).

- [ ] **Step 1: Write failing tests**

```ts
// tests/edit/spell-edit-render.test.ts
import { describe, it, expect } from "vitest";
import { renderSpellEditMode } from "../../src/edit/spell-edit-render";

const testSpell = {
  name: "Fireball",
  level: 3,
  school: "Evocation",
  casting_time: "1 action",
  range: "150 feet",
  components: "V, S, M (a tiny ball of bat guano and sulfur)",
  duration: "Instantaneous",
  concentration: false,
  ritual: false,
  description: ["Each creature in a 20-foot-radius sphere must make a Dexterity saving throw."],
  at_higher_levels: ["When you cast this spell using a spell slot of 4th level or higher, the damage increases by 1d6."],
  classes: ["Sorcerer", "Wizard"],
};

describe("renderSpellEditMode", () => {
  it("renders name input", () => {
    const html = renderSpellEditMode(testSpell as any, null);
    expect(html).toContain('data-field="name"');
    expect(html).toContain('value="Fireball"');
  });

  it("renders level and school selects", () => {
    const html = renderSpellEditMode(testSpell as any, null);
    expect(html).toContain('data-field="level"');
    expect(html).toContain('data-field="school"');
  });

  it("renders property inputs", () => {
    const html = renderSpellEditMode(testSpell as any, null);
    expect(html).toContain('data-field="casting_time"');
    expect(html).toContain('data-field="range"');
    expect(html).toContain('data-field="components"');
    expect(html).toContain('data-field="duration"');
  });

  it("renders description textarea", () => {
    const html = renderSpellEditMode(testSpell as any, null);
    expect(html).toContain('data-field="description"');
    expect(html).toContain("20-foot-radius sphere");
  });

  it("adds editing class", () => {
    const html = renderSpellEditMode(testSpell as any, null);
    expect(html).toContain("editing");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/w/archivist-logseq && npx vitest run tests/edit/spell-edit-render.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement spell edit renderer**

Read `~/w/archivist-obsidian/src/edit/spell-edit-render.ts` (385 lines). Port to HTML string output.

Exports:
```ts
export function renderSpellEditMode(spell: Spell, compendiumContext: CompendiumContext | null): string;
export function wireSpellEditEvents(container: HTMLElement, spell: Spell, compendiumContext: CompendiumContext | null, callbacks: EditCallbacks): void;
```

Sections rendered:
1. Header (name input, level select, school select)
2. SVG bar
3. Properties (casting time, range, components, duration -- each as icon + label + text input)
4. Concentration + Ritual checkboxes
5. SVG bar
6. Description (textarea array with add button)
7. At Higher Levels (textarea array)
8. Classes (comma-separated text input)

State management: mutable deep-cloned draft. Save serializes via `yaml.dump()` with `buildCleanSpell(draft)` that omits empty/default fields.

Wire function: attach input/change/checkbox listeners via `[data-field]` selectors. Wire save/cancel to callbacks.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/w/archivist-logseq && npx vitest run tests/edit/spell-edit-render.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Wire spell edit renderer into index.ts**

Import and update spell registration to pass editRenderer/wireEdit instead of null.

- [ ] **Step 6: Build and verify**

Run: `cd ~/w/archivist-logseq && npm run build`
Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
cd ~/w/archivist-logseq && git add src/edit/spell-edit-render.ts tests/edit/spell-edit-render.test.ts src/index.ts && git commit -m "feat: add spell edit renderer"
```

---

### Task 11: Item Edit Renderer

**Files:**
- Create: `src/edit/item-edit-render.ts`
- Test: `tests/edit/item-edit-render.test.ts`

Port from `~/w/archivist-obsidian/src/edit/item-edit-render.ts` (406 lines). Same mutable draft pattern as spell.

- [ ] **Step 1: Write failing tests**

```ts
// tests/edit/item-edit-render.test.ts
import { describe, it, expect } from "vitest";
import { renderItemEditMode } from "../../src/edit/item-edit-render";

const testItem = {
  name: "Flame Tongue Longsword",
  type: "Weapon",
  rarity: "Rare",
  attunement: true,
  weight: 3,
  entries: ["You can use a bonus action to speak this magic sword's command word."],
};

describe("renderItemEditMode", () => {
  it("renders name input", () => {
    const html = renderItemEditMode(testItem as any, null);
    expect(html).toContain('data-field="name"');
    expect(html).toContain('value="Flame Tongue Longsword"');
  });

  it("renders type and rarity selects", () => {
    const html = renderItemEditMode(testItem as any, null);
    expect(html).toContain('data-field="type"');
    expect(html).toContain('data-field="rarity"');
  });

  it("renders attunement checkbox", () => {
    const html = renderItemEditMode(testItem as any, null);
    expect(html).toContain('data-field="attunement"');
    expect(html).toContain("checked");
  });

  it("renders entries textarea", () => {
    const html = renderItemEditMode(testItem as any, null);
    expect(html).toContain('data-field="entries"');
    expect(html).toContain("command word");
  });

  it("adds editing class", () => {
    const html = renderItemEditMode(testItem as any, null);
    expect(html).toContain("editing");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/w/archivist-logseq && npx vitest run tests/edit/item-edit-render.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement item edit renderer**

Read `~/w/archivist-obsidian/src/edit/item-edit-render.ts` (406 lines). Port to HTML string output.

Exports:
```ts
export function renderItemEditMode(item: Item, compendiumContext: CompendiumContext | null): string;
export function wireItemEditEvents(container: HTMLElement, item: Item, compendiumContext: CompendiumContext | null, callbacks: EditCallbacks): void;
```

Sections rendered:
1. Header (name input, type select, rarity select)
2. SVG bar
3. Attunement (checkbox + conditional condition text input)
4. Properties (weight, value, damage, damage type, properties, charges, recharge)
5. Cursed checkbox
6. SVG bar
7. Entries (textarea array with add button)

State management: mutable deep-cloned draft. `buildCleanItem(draft)` omits empty fields. Wire function: same delegation pattern as spell.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/w/archivist-logseq && npx vitest run tests/edit/item-edit-render.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Wire item edit renderer into index.ts**

Import and update item registration to pass editRenderer/wireEdit instead of null.

- [ ] **Step 6: Build and verify**

Run: `cd ~/w/archivist-logseq && npm run build`
Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
cd ~/w/archivist-logseq && git add src/edit/item-edit-render.ts tests/edit/item-edit-render.test.ts src/index.ts && git commit -m "feat: add item edit renderer"
```

---

### Task 12: Tag Autocomplete

**Files:**
- Create: `src/edit/tag-autocomplete.ts`

Port from `~/w/archivist-obsidian/src/edit/tag-autocomplete.ts` (465 lines). Backtick-triggered formula tag autocomplete for feature card textareas.

- [ ] **Step 1: Copy and adapt tag-autocomplete.ts**

```bash
cp ~/w/archivist-obsidian/src/edit/tag-autocomplete.ts ~/w/archivist-logseq/src/edit/tag-autocomplete.ts
```

Make these substitutions:
1. Replace `import { setIcon } from "obsidian";` with `import { lucideIcon } from "../renderers/renderer-utils";`
2. Replace all `setIcon(el, iconName)` calls with setting `el.innerHTML` to the result of `lucideIcon(iconName)`
3. Replace Obsidian DOM helpers (`createDiv`, `createEl`, `addClass`, `removeClass`) with standard DOM APIs (`document.createElement`, `classList.add/remove`)

The exported function stays the same:
```ts
export function attachTagAutocomplete(textarea: HTMLTextAreaElement, state: MonsterEditState): void;
```

- [ ] **Step 2: Wire into monster edit renderer**

In `src/edit/monster-edit-render.ts`, in `wireMonsterEditEvents`, after wiring feature cards, attach tag autocomplete to all feature textareas:

```ts
import { attachTagAutocomplete } from "./tag-autocomplete";

// Inside wireMonsterEditEvents, after wireFeatureCards:
container.querySelectorAll("textarea.archivist-feat-text-input").forEach((ta) => {
  if (ta instanceof HTMLTextAreaElement) {
    attachTagAutocomplete(ta, state);
  }
});
```

- [ ] **Step 3: Build and verify**

Run: `cd ~/w/archivist-logseq && npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
cd ~/w/archivist-logseq && git add src/edit/tag-autocomplete.ts src/edit/monster-edit-render.ts && git commit -m "feat: port formula tag autocomplete for feature textareas"
```

---

### Task 13: Build, Test, and Verify

Final integration verification.

- [ ] **Step 1: Run all tests**

Run: `cd ~/w/archivist-logseq && npx vitest run`
Expected: All tests pass (existing Phase 1/2 tests + new edit mode tests).

- [ ] **Step 2: Build**

Run: `cd ~/w/archivist-logseq && npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Verify file structure**

```bash
ls -la ~/w/archivist-logseq/src/edit/
```

Expected files:
```
block-utils.ts
compendium-picker.ts
edit-state.ts
item-edit-render.ts
monster-edit-render.ts
searchable-tag-select.ts
side-buttons.ts
spell-edit-render.ts
tag-autocomplete.ts
```

- [ ] **Step 4: Verify styles exist**

```bash
ls -la ~/w/archivist-logseq/src/styles/
```

Expected: `archivist-dnd.css` (Phase 1) + `archivist-edit.css` (Phase 3).

- [ ] **Step 5: Final commit if any loose changes**

```bash
cd ~/w/archivist-logseq && git status
# If any uncommitted changes, stage and commit
```
