# Archivist TTRPG Blocks -- Logseq Port: Phase 3 Edit Mode

**Date:** 2026-04-12
**Status:** Spec -- awaiting user review, then implementation plan
**Scope:** Phase 3 of 5 -- in-place editing, side buttons, compendium context, settings

---

## Overview

Port the edit mode from the Obsidian plugin to Logseq. Users can edit monster, spell, and item stat blocks in-place with custom controls (number spinners, searchable tag selects, speed picker, collapsible sections, feature cards). Entity pages get full compendium context: save, save-as-new, delete flows. Side buttons on every rendered stat block provide source toggle, column toggle (monsters), edit, and delete.

The Obsidian edit mode is ~3,170 lines of TS across 9 files + ~1,534 lines of edit CSS. This port rewrites the edit renderers from DOM manipulation to HTML string output with post-render event wiring, while copying state management logic verbatim.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Save mechanism | DOM traversal to find block UUID | Walk up from rendered stat block to `.ls-block[blockid]`, extract UUID, save via `Editor.updateBlock()`. Used by dozens of Logseq plugins, stable since 2021. |
| Compendium context detection | Query page properties from block UUID | From block UUID -> `Editor.getBlockPage()` -> check for `archivist:: true` property -> extract entity metadata. |
| Edit form rendering | HTML string + post-render event wiring | Matches Phase 1 renderer pattern. Two-phase: `renderEditMode()` returns HTML string, `wireEditEvents()` attaches listeners via `data-field` attributes. |
| Source toggle | Custom implementation in React component | Own `<pre>` block for raw YAML, not Logseq's `edit: true` CM editor. Avoids always-visible dual editor UX. |
| Save As New (entity pages) | No document reference replacement | Unlike Obsidian where `{{monster:goblin}}` rewrites to `{{monster:goblin-2}}`, Logseq embeds stay as-is. New entity is an independent page. |
| Settings | `logseq.useSettingsSchema()` | Declarative schema, auto-rendered settings panel. Only 2 settings needed for Phase 3. |

---

## 1. Block Context Discovery

### File: `src/edit/block-utils.ts` (~60 lines)

New file. Extracts block UUID and compendium context from the DOM + Logseq API.

### Interfaces

```ts
interface BlockContext {
  blockUuid: string;
  pageProperties?: Record<string, any>;
}

interface CompendiumContext {
  slug: string;
  compendium: string;
  entityType: "monster" | "spell" | "item";
  readonly: boolean;
}
```

### Functions

**`findBlockUuid(el: HTMLElement): string | null`**

Walk up the DOM from the rendered stat block to find the nearest `.ls-block[blockid]` ancestor. Return the `blockid` attribute value. Return null if not found (defensive -- should always succeed in normal rendering).

**`async getCompendiumContext(blockUuid: string): Promise<CompendiumContext | null>`**

1. `Editor.getBlockPage(blockUuid)` to get the page
2. Check page properties for `archivist:: true`
3. If not an entity page, return null
4. Extract `slug`, `compendium`, `entity-type` from page properties
5. Determine `readonly` from compendium page properties (`compendium-readonly:: true`)
6. Return `CompendiumContext`

Returns null for regular (non-entity) code blocks.

---

## 2. Edit Mode Lifecycle

### React Component State

Each fenced code renderer (monster/spell/item) becomes a stateful React component:

```
MonsterBlock({ content })
  |
  v
parseMonster(content) -> Monster
  |
  v
[mode: "view" | "edit" | "source"]  (React useState)
  |
  |-- mode=view:   renderMonsterBlock(monster) + side buttons
  |-- mode=edit:   renderMonsterEditMode(monster, callbacks) + side buttons
  |-- mode=source: <pre> raw YAML </pre> + side buttons
```

### Enter Edit Mode

1. User clicks Edit in side buttons
2. `findBlockUuid(el)` captures the block UUID (stashed in component state)
3. `getCompendiumContext(uuid)` resolves compendium info (if any)
4. Component state flips to `mode: "edit"`
5. React re-render replaces stat block with edit form
6. Edit form is built as HTML string, set via `innerHTML`, then event listeners attached via `querySelectorAll` delegation on `[data-field]` attributes

### Exit Edit Mode (Save)

1. `editableToYaml(state.current)` serializes to YAML
2. Wrap in fenced code block: `` ```monster\n${yaml}\n``` ``
3. `Editor.updateBlock(blockUuid, wrappedYaml)` persists
4. If entity page: `registry.register(updatedEntity)` refreshes in-memory data
5. Logseq re-renders the block -- React component receives new `content` prop, renders in view mode

### Exit Edit Mode (Cancel)

1. Component state flips back to `mode: "view"`
2. React re-render shows original stat block (from unchanged `content` prop)

### No Edit Lock Needed

Obsidian's CM6 decoration system rebuilds widgets on every doc change, requiring a lock to protect edit forms. Logseq's React component only re-renders when `content` changes, which only happens on explicit block updates. The edit form is naturally stable.

---

## 3. Edit Renderers

### Two-Phase Pattern

Each entity type follows the same pattern:

```ts
// Phase 1: Returns HTML string with data-field attributes for event targets
function renderMonsterEditMode(
  monster: Monster,
  compendiumContext: CompendiumContext | null
): string;

// Phase 2: Attach event listeners to the rendered DOM
function wireMonsterEditEvents(
  container: HTMLElement,
  state: MonsterEditState,
  callbacks: EditCallbacks
): void;
```

`data-field` attributes on every interactive element:
```html
<input type="number" data-field="ac" data-index="0" value="15" />
<div data-field="damage_resistances" data-component="tag-select"></div>
```

`wireMonsterEditEvents` walks the container, finds all `[data-field]` elements, and attaches the appropriate handlers. When a field changes: `state.updateField()` -> `recalculate()` -> targeted DOM updates on affected elements (not a full re-render).

### Controls Ported 1:1 from Obsidian

| Control | Used for | Notes |
|---------|----------|-------|
| Custom number spinners | AC, HP, abilities, speed, legendary counts | Triangle up/down buttons, same styling |
| Searchable tag select | Damage types, conditions | Pill tags, filtered dropdown, custom add |
| Speed inline picker | fly/swim/climb/burrow | `+ more` dropdown, inline comma-separated, superscript x remove |
| Collapsible sections | Damage/condition fields | Arrow toggle, count badge, auto-expand when populated |
| Feature cards | Traits, actions, reactions, legendary | Inline text editing, add/remove/reorder |
| Section tabs | Traits / Actions / Reactions / Legendary | Tab bar with active state |

### Files

| File | Est. Lines | Port from |
|------|-----------|-----------|
| `src/edit/monster-edit-render.ts` | ~800 | Rewrite of Obsidian's DOM version (~1200 lines) |
| `src/edit/spell-edit-render.ts` | ~200 | Rewrite |
| `src/edit/item-edit-render.ts` | ~200 | Rewrite |
| `src/edit/searchable-tag-select.ts` | ~250 | Rewrite |
| `src/edit/compendium-picker.ts` | ~80 | Rewrite |

---

## 4. Side Buttons

### File: `src/edit/side-buttons.ts` (~250 lines)

HTML string output. Icons via inline SVG from `renderer-utils.ts`'s `lucideIcon()` lookup (new icons added: `code`, `columns-2`, `pencil`, `trash-2`, `file-x`, `book-x`, `x`).

### Button Stack

**Monster blocks:** `</>` (source) -> Columns toggle -> Edit -> Trash
**Spell/Item blocks:** `</>` (source) -> Edit -> Trash

28x28px squares, 4px gap, right-aligned. Same CSS as Obsidian (`.archivist-side-btns`).

### Source Toggle

Flips the React component to `mode: "source"`, showing raw YAML in a `<pre>` block with parchment styling. Click again to return to view mode. Entirely custom -- does not use Logseq's `edit: true` CodeMirror editor.

### Delete Sub-Menu

Same expanding pattern as Obsidian:
1. Trash icon becomes X (cancel) with options below
2. **file-x**: Remove block from page -- `Editor.removeBlock(uuid)`
3. **book-x** (entity pages only): Delete entity from compendium -- `CompendiumManager.deleteEntity(slug)`
4. book-x checks for references via `CompendiumManager.countReferences(slug)` and shows confirmation warning if found

### Compendium-Aware Button State

| Context | Side buttons | Edit behavior |
|---------|-------------|---------------|
| Regular code block | Source + (Columns) + Edit + Trash (file-x only) | Save writes back to block |
| Entity page (writable) | Source + (Columns) + Edit + Trash (file-x + book-x) | Save + Save As New available |
| Entity page (readonly/SRD) | Source + (Columns) + Edit + Trash (file-x + book-x) | Save hidden, Save As New only |

---

## 5. Compendium Edit Flows

### Save (Writable Entity Page)

1. Serialize edited state to YAML via `editableToYaml()`
2. Wrap in fenced code block
3. `Editor.updateBlock(blockUuid, wrappedYaml)` -- updates the page's code block
4. `registry.register(updatedEntity)` -- refreshes in-memory store
5. Exit edit mode

### Save As New

1. Auto-name from the entity's current title field (as edited)
2. If 1 writable compendium: save directly
3. If 2+ writable compendiums: show inline picker (`compendium-picker.ts`, parchment-themed dropdown anchored below button)
4. `CompendiumManager.saveEntity(compendiumName, entityType, data)` -- creates new page (e.g., `Homebrew/Monsters/Goblin-Custom`) with properties + fenced code block
5. `registry.register(newEntity)`
6. Exit edit mode -- original embed stays as-is, new entity is an independent page

### Delete From Compendium

1. `CompendiumManager.countReferences(slug)` -- Datascript query for embeds/links referencing this page
2. If references found: confirmation warning with count
3. `CompendiumManager.deleteEntity(slug)` -> `Editor.deletePage(pageName)`
4. `registry.unregister(slug)`
5. Existing embeds of the deleted page show Logseq's native "page not found" state

### Difference from Obsidian

No document reference replacement on Save As New. In Obsidian, `{{monster:goblin}}` rewrites to `{{monster:goblin-2}}` via `onReplaceRef`. In Logseq, `{{embed [[SRD/Monsters/Goblin]]}}` stays unchanged -- the new entity is a separate page the user can link/embed independently. This is cleaner: the source embed continues referencing the original.

---

## 6. Portable Layer

Copied verbatim from archivist-obsidian (pure state management, zero platform deps):

| File | Lines | Purpose |
|------|-------|---------|
| `src/edit/edit-state.ts` | ~200 | `MonsterEditState` -- reactive state container, field updates, dirty tracking |
| `src/dnd/editable-monster.ts` | ~150 | Already in project from Phase 1 |
| `src/dnd/recalculate.ts` | ~180 | Already in project from Phase 1 |
| `src/dnd/yaml-serializer.ts` | ~120 | Already in project from Phase 1 |

Only `edit-state.ts` needs copying. The other three are already present.

---

## 7. Settings

### File: `src/index.ts` (added to initialization)

Declarative schema via `logseq.useSettingsSchema()`. Logseq auto-renders the settings panel.

| Setting | Type | Default | Purpose |
|---------|------|---------|---------|
| `defaultColumns` | boolean | `false` | Two-column monster layout by default |
| `defaultEditMode` | enum: `"view"` / `"source"` | `"view"` | What mode stat blocks open in |

Accessed at render time via `logseq.settings?.defaultColumns`. Passed into React components.

---

## 8. CSS Adaptation

### Source: `archivist-obsidian/src/styles/archivist-edit.css` (~1,534 lines)

### Target: `archivist-logseq/src/styles/archivist-edit.css` (~1,500 lines)

**Preserved:**
- Custom number spinners (`.archivist-num-wrap`, triangle buttons)
- Searchable tag select (`.archivist-tag-select`, pills, dropdown)
- Speed inline picker (`.archivist-speed-add-btn`, dropdown, remove buttons)
- Collapsible sections (`.archivist-collapse-header`, arrow, body)
- Feature cards (`.archivist-feature-card`, inline editing)
- Section tabs (`.archivist-section-tabs`)
- Side buttons (`.archivist-side-btns`, delete sub-menu)
- Edit mode property lines, input styling, focus states
- Parchment theming: dashed borders for editability, solid crimson on focus

**Stripped:**
- `.cm-editor`, `.cm-line`, `.cm-widget` selectors (CodeMirror 6)
- `.markdown-rendered` context selectors (Obsidian views)
- `var(--background-modifier-*)` Obsidian CSS variables -- replaced with hardcoded parchment values or Logseq `var(--ls-*)` equivalents

**Added:**
- Scoping under `.archivist-block` namespace
- Logseq-specific overrides (default block styles interfering with inputs, dropdowns, positioned elements)

**Injection:** Raw string import via `logseq.provideStyle(editCss)` alongside the existing Phase 1 `dndCss`.

---

## 9. Plugin Initialization Changes

Updated `src/index.ts` startup sequence:

```
logseq.ready(main)
  |
  v
1.  logseq.provideStyle(dndCss)                        # Phase 1
2.  logseq.provideStyle(editCss)                        # NEW Phase 3
3.  logseq.useSettingsSchema(settingsSchema)             # NEW Phase 3
4.  Register 3 fenced code renderers                     # Phase 1, MODIFIED
      - Components now stateful (view/edit/source modes)
      - Side buttons on all rendered blocks
      - Accept compendiumManager + registry refs
5.  Register 3 slash commands                            # Phase 1
6.  Create SrdStore, EntityRegistry, CompendiumManager   # Phase 2
7.  compendiumManager.discover() + loadAllEntities()     # Phase 2
8.  Register "Import SRD" command                        # Phase 2
9.  Register "Search Entity" command                     # Phase 2
10. logseq.provideModel({ ...searchUIHandlers })         # Phase 2
```

Module-level refs for `compendiumManager` and `registry` so React components can access them (same pattern Obsidian uses for `pluginRef` / `registryRef`).

No new commands or UI entry points. Edit mode is entered entirely through side buttons on rendered blocks.

---

## File Summary

| Category | Files | Est. Lines |
|----------|-------|-----------|
| Copied verbatim | 1 (`edit-state.ts`) | ~200 |
| Rewritten for Logseq | 6 (edit renderers, side buttons, tag select, compendium picker) | ~1,780 |
| New for Logseq | 1 (`block-utils.ts`) | ~60 |
| CSS adapted | 1 (`archivist-edit.css`) | ~1,500 |
| Modified | 1 (`index.ts` -- initialization + stateful components) | ~200 delta |
| **Total** | **10** | **~3,740 lines** |

---

## What Phase 3 Does NOT Include

- Inline tag editing outside stat blocks -- Phase 4
- Click-to-roll dice -- Phase 4
- AI/Inquiry system -- Phase 5
- Homebrew compendium creation wizard -- could be Phase 3 follow-up, not core
- Undo/redo integration for saves (Logseq block updates are not undoable via plugin API)
- Explicit support for editing embedded stat blocks (editing MAY work naturally on embeds since `findBlockUuid` should resolve to the source block UUID, but this is not a design target -- verify during implementation, fix in follow-up if needed)
