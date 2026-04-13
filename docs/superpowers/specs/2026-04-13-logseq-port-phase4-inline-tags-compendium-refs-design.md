# Archivist TTRPG Blocks -- Logseq Port: Phase 4 Inline Tags & Compendium Refs

**Date:** 2026-04-13
**Status:** Spec -- awaiting user review, then implementation plan
**Scope:** Phase 4 of 6 -- inline tag pills, compendium ref rendering, entity autocomplete (all CM6 extensions)

---

## Overview

Add CodeMirror 6 editor extensions to Logseq that render inline formula tags as styled pills and `{{monster:goblin}}` compendium references as full stat blocks -- directly in regular text blocks, not just inside fenced code blocks.

Phase 3 delivered edit mode for fenced code blocks. Phase 4 extends the plugin into the regular editor via `logseq.Experiments.registerExtensionsEnhancer('codemirror', ...)`, adding three independent CM6 extensions:

1. **Inline tag ViewPlugin** -- decorates backtick code spans like `` `dice:2d6` ``, `` `atk:STR` `` as styled color-coded pills
2. **Compendium ref ViewPlugin** -- decorates `{{monster:goblin}}` patterns as full rendered stat blocks with side buttons and edit mode
3. **Compendium completion source** -- `{{` autocomplete for entity references from the registry

No dice rolling (deferred to Phase 5). No bare dice auto-detection in regular blocks -- only explicit backtick tags.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Extension API | `registerExtensionsEnhancer('codemirror', ...)` | Only viable API for decorating arbitrary text in the CM6 editor. Experimental label but stable for years. |
| Architecture | 3 separate extensions, single registration | Each piece is self-contained and testable. Mirrors Obsidian architecture. Combined into one extension array at registration. |
| Inline tag syntax | Backtick code spans (`` `dice:2d6` ``) | Preserves data portability with Obsidian. Explicit -- users opt in by writing backtick tags. |
| Compendium ref syntax | `{{type:slug}}` (`` {{monster:goblin}} ``) | Same syntax as Obsidian for data portability. Needs compatibility spike (see Section 6). |
| Formula resolution | No resolution in regular blocks | Tags like `` `atk:STR` `` show "STR" not "+5". Resolution requires monster context, which only exists inside stat blocks. Matches Obsidian behavior. |
| Bare dice detection | Off in regular blocks | Only explicit backtick tags render as pills. Bare dice detection stays inside stat blocks where it already works. |
| Dice rolling | Deferred to Phase 5 | Pills are visual only. Dice rolling gets its own proper design phase. |
| Autocomplete | CM6 CompletionSource for `{{` | Native CM6 completion API. Triggers on `{{`, filters by type prefix, accepts inserts `{{type:slug}}`. |
| CM6 module source | From host via enhancer callback | Cannot bundle own CM6 -- must use Logseq's host instance passed to the enhancer function. |

---

## 1. CM6 Registration & Host Scope Access

### Entry point: `src/index.ts` (modified, ~30 lines delta)

```
logseq.Experiments.registerExtensionsEnhancer('codemirror', async (cm) => {
  return [
    inlineTagPlugin(cm),       // ViewPlugin for backtick tag pills
    compendiumRefPlugin(cm),   // ViewPlugin for {{type:slug}} stat blocks
    compendiumCompletion(cm),  // CompletionSource for {{ autocomplete
  ]
})
```

Each extension factory receives the CM6 module object from the host. The exact shape of this object is determined at runtime -- the spike (Section 6) will confirm which CM6 exports are available (e.g., `ViewPlugin`, `Decoration`, `WidgetType`, `EditorView`, `StateEffect`, `autocompletion`). The factories use these to construct plugins. If the enhancer callback receives the full `@codemirror/view` and `@codemirror/state` modules, the extensions can be built as designed. If it receives a subset, the spike will identify what's missing and the plan will adapt.

Host scope access for DOM operations inside widgets: `logseq.Experiments.ensureHostScope()` provides the host `window` and `document`.

Module-level refs for `EntityRegistry` and `CompendiumManager` (already established in Phase 2/3) are accessed by the extensions for entity lookup, save, and delete operations.

---

## 2. Inline Tag Extension

### File: `src/extensions/inline-tag-extension.ts` (~120 lines)

A CM6 ViewPlugin that finds backtick inline-code spans in the editor and replaces them with styled pill widgets.

### Decoration flow

1. `buildDecorations(view)` iterates `view.visibleRanges`
2. Walks the CM6 syntax tree looking for `InlineCode` nodes (backtick-delimited spans)
3. For each node, strips backticks, calls `parseInlineTag(content)` (already in project)
4. If parsing succeeds, creates `Decoration.replace()` with an `InlineTagWidget`
5. Skips decoration when cursor is inside the backtick span (so the user can edit the raw text)
6. Rebuilds on `docChanged`, `viewportChanged`, or `selectionSet`

### Widget rendering

`InlineTagWidget.toDOM()` returns a `<span>` styled pill:

- Uses the existing `renderInlineTag()` from `src/renderers/inline-tag-renderer.ts` to generate HTML string
- Sets `innerHTML` on a wrapper span
- CSS classes: `.archivist-stat-tag-dice`, `.archivist-stat-tag-atk`, `.archivist-stat-tag-dc`, etc. (already exist from Phase 1)
- Icons via `lucideIcon()` from `renderer-utils.ts` (inline SVG, already in project)

### No formula resolution

Tags like `` `atk:STR` `` render showing "STR" as-is. Formula resolution (`resolveFormulaTag()`) requires a `MonsterFormulaContext` (ability scores + proficiency bonus) which is only available inside stat block renderers. This matches Obsidian behavior where inline tags outside stat blocks show unresolved values.

### No click interaction

Pills are visual only. No click handlers. Dice rolling deferred to Phase 5.

### Portable code reused (zero modifications)

- `parseInlineTag()` from `src/parsers/inline-tag-parser.ts`
- `renderInlineTag()` from `src/renderers/inline-tag-renderer.ts`
- `lucideIcon()` from `src/renderers/renderer-utils.ts`

### CSS additions (~20 lines)

Overrides scoped under `.cm-editor .archivist-stat-tag` for inline sizing within the editor line height. No new class names.

---

## 3. Compendium Ref Extension

### File: `src/extensions/compendium-ref-extension.ts` (~350 lines)

A CM6 ViewPlugin that finds `{{type:slug}}` patterns in regular text and replaces them with full rendered stat blocks.

### Decoration flow

1. `buildDecorations(view)` scans `view.visibleRanges` with regex `/\{\{[^}]+\}\}/g`
2. For each match, calls `parseCompendiumRef(text)` (already ported, `src/extensions/compendium-ref-parser.ts`)
3. If valid, creates `Decoration.replace()` with a `CompendiumRefWidget`
4. Skips when cursor is inside the `{{...}}` span (so user can edit the ref text)
5. Rebuilds on `docChanged`, `viewportChanged`, `selectionSet`, or `compendiumRefreshEffect`

### Widget rendering

`CompendiumRefWidget.toDOM()`:

1. Looks up entity from `EntityRegistry.getBySlug(slug)`
2. **Not found:** renders error block with warning icon + "Entity not found" + ref text
3. **Found:** serializes entity data to YAML via `js-yaml.dump()`, parses with the appropriate parser (`parseMonster`/`parseSpell`/`parseItem`), renders with existing HTML string renderers (`renderMonsterBlock`/`renderSpellBlock`/`renderItemBlock`)
4. Appends compendium badge (`.archivist-compendium-badge`) showing compendium name
5. Appends side buttons via existing `renderSideButtons()` from Phase 3

### Side buttons

Same stack as fenced code blocks (Phase 3), adapted for ref context:

**Monster:** `</>` (source) -> Columns -> Edit -> Trash
**Spell/Item:** `</>` (source) -> Edit -> Trash

**Trash sub-menu:**
- **Remove ref** -- deletes the `{{monster:goblin}}` text from the document via CM6 transaction (`view.dispatch({ changes: { from, to, insert: "" } })`)
- **Delete entity** -- checks `CompendiumManager.countReferences(slug)`, shows confirmation if references found, then `CompendiumManager.deleteEntity(slug)` + `registry.unregister(slug)`

### Source toggle

Flips to `<pre>` block showing raw YAML of the entity. Click again to return to rendered view. Same behavior as Phase 3 fenced code blocks.

### Edit mode

Clicking Edit:

1. Replaces rendered stat block in the widget with the appropriate edit renderer (`renderMonsterEditMode`/`renderSpellEditMode`/`renderItemEditMode`) -- reusing Phase 3 edit renderers
2. Side buttons flip to edit state
3. **Save** (writable entities) -- `editableToYaml()` -> `CompendiumManager.updateEntity(slug, data)` -> `registry.register(updated)` -> exit edit mode
4. **Save As New** -- auto-names from title field, shows compendium picker if 2+ writable compendiums (`compendium-picker.ts` from Phase 3), creates new entity page -> exit edit mode
5. **Cancel** -- re-renders view mode from unchanged registry data

### Refresh mechanism

A `StateEffect` (`compendiumRefreshEffect`) can be dispatched to force all ref widgets to rebuild. Called after entity saves/deletes.

**Known limitation:** Unlike Obsidian where `refreshAllCompendiumRefs()` iterates all workspace leaves, Logseq doesn't expose access to all open editor views. The refresh effect only applies to the current editor. Entities will show stale data in other open pages until they re-render. Acceptable for now.

### Portable code reused (zero modifications)

- `parseCompendiumRef()` from `src/extensions/compendium-ref-parser.ts`
- All parsers (`parseMonster`, `parseSpell`, `parseItem`)
- All renderers (`renderMonsterBlock`, `renderSpellBlock`, `renderItemBlock`)
- All edit renderers (`renderMonsterEditMode`, `renderSpellEditMode`, `renderItemEditMode`)
- `renderSideButtons()` from `src/edit/side-buttons.ts`
- `CompendiumManager` from `src/entities/compendium-manager.ts`
- `EntityRegistry` from `src/entities/entity-registry.ts`

---

## 4. Compendium Autocomplete

### File: `src/extensions/compendium-suggest.ts` (~180 lines)

A CM6 `CompletionSource` that triggers when the user types `{{` and shows entity suggestions from the registry.

### Trigger & query

1. Scans backward from cursor position looking for `{{`
2. If found and no closing `}}` yet, activates completions
3. **Typed prefix support:** `{{monster:` filters to monsters only. Supported prefixes: `monster:`, `spell:`, `item:`. No prefix searches all types.
4. Queries `EntityRegistry.search(query, entityType, 20)` with text after `{{` or `{{type:` as query

### Completion items

Each result shows:
- Entity name as the label
- Type badge (monster/spell/item) as the detail
- Compendium name as info

### On accept

Inserts `{{entityType:slug}}` replacing the partial `{{...` text, with cursor positioned after the closing `}}`.

### CM6 integration

```ts
function compendiumCompletionSource(context: CompletionContext): CompletionResult | null {
  // Find {{ trigger position
  // Extract query text and optional type prefix
  // Search registry
  // Return { from, to, options: [...] }
}
```

Registered via `autocompletion({ override: [compendiumCompletionSource] })`. This adds our source alongside any existing Logseq completions rather than replacing them.

### Keyboard interaction

Handled natively by CM6's completion system: arrow keys to navigate, Enter to accept, Escape to dismiss, continued typing filters results.

### CSS additions (~30 lines)

Override CM6's default completion dropdown styling to match parchment theme:
- `.cm-tooltip-autocomplete` scoped overrides for background, border, font
- Selected item highlight in crimson accent
- Type badges styled per entity type

---

## 5. CSS Additions

All CSS added to `src/styles/archivist-dnd.css` (~100 lines total).

### Inline tag overrides (~20 lines)

Scoped under `.cm-editor .archivist-stat-tag`:
- Inline display, vertical alignment within editor line height
- Font size matching editor text
- Cursor: default (no pointer -- not clickable in Phase 4)

### Compendium ref container (~50 lines)

- `.archivist-compendium-ref` -- margin, padding, border-radius, position relative
- `.archivist-compendium-badge` -- position absolute, top-right, small font, compendium label
- `.archivist-compendium-ref-error` -- warning styling with icon + text
- `.archivist-not-found-icon`, `.archivist-not-found-text`, `.archivist-not-found-label`, `.archivist-not-found-ref` -- error state layout

### Completion dropdown (~30 lines)

Scoped parchment overrides for `.cm-tooltip-autocomplete`:
- Background: `#fdf1dc`
- Border: `1px solid #d9c484`
- Selected highlight: `#922610` crimson accent
- Entity type badges per type

---

## 6. `{{monster:goblin}}` Syntax Compatibility

### The risk

Logseq processes `{{...}}` as macros in its rendering pipeline. `{{monster:goblin}}` may be intercepted by Logseq's macro system before CM6 sees the raw text.

### Possible outcomes

1. **Logseq ignores unknown macros** -- raw text survives in the editor. CM6 decorates it. Ideal case.
2. **Logseq renders as failed macro** -- shows error in read mode. CM6 still decorates in edit mode. Ugly but functional.
3. **Logseq transforms the text** -- raw text no longer in editor buffer. CM6 cannot find it. Broken.

### Mitigation: implementation spike first

Before building the full extension, the first implementation task is a spike:
1. Register a minimal CM6 extension via `registerExtensionsEnhancer`
2. Type `{{monster:goblin}}` in a Logseq block
3. Verify the raw text is visible to the ViewPlugin's `view.state.doc`
4. Check what Logseq renders in reading mode

### Fallback if incompatible

If outcome 2 or 3:
- **Hybrid approach:** Register `onMacroRendererSlotted` to handle `{{monster:goblin}}` in Logseq's read/render mode + CM6 extension for edit mode
- **Alternative syntax:** `{!monster:goblin!}` or `<<monster:goblin>>` as delimiters Logseq won't intercept
- **Decision deferred** until spike results are known

The design assumes `{{monster:goblin}}` works. The spike resolves the question before investing in the full widget implementation.

---

## 7. Plugin Initialization Changes

Updated `src/index.ts` startup sequence:

```
logseq.ready(main)
  |
  v
1.  logseq.provideStyle(dndCss)                         # Phase 1
2.  logseq.provideStyle(editCss)                         # Phase 3
3.  logseq.useSettingsSchema(settingsSchema)              # Phase 3
4.  Register 3 fenced code renderers                      # Phase 1, modified Phase 3
5.  Register 3 slash commands                             # Phase 1
6.  Create SrdStore, EntityRegistry, CompendiumManager    # Phase 2
7.  compendiumManager.discover() + loadAllEntities()      # Phase 2
8.  Register "Import SRD" command                         # Phase 2
9.  Register "Search Entity" command                      # Phase 2
10. logseq.provideModel({ ...searchUIHandlers })          # Phase 2
11. registerExtensionsEnhancer('codemirror', ...)          # NEW Phase 4
      - inlineTagPlugin (inline tag pills)
      - compendiumRefPlugin ({{type:slug}} stat blocks)
      - compendiumCompletion ({{ autocomplete)
```

The CM6 extensions need access to `EntityRegistry` and `CompendiumManager`. These are module-level refs already established in Phase 2/3. The extension factories import them directly.

---

## 8. File Summary

### New files

| File | Est. Lines | Purpose |
|------|-----------|---------|
| `src/extensions/inline-tag-extension.ts` | ~120 | CM6 ViewPlugin for inline tag pills |
| `src/extensions/compendium-ref-extension.ts` | ~350 | CM6 ViewPlugin for `{{type:slug}}` stat blocks |
| `src/extensions/compendium-suggest.ts` | ~180 | CM6 CompletionSource for `{{` autocomplete |

### Modified files

| File | Delta | Change |
|------|-------|--------|
| `src/index.ts` | ~30 lines | Add `registerExtensionsEnhancer` call |
| `src/styles/archivist-dnd.css` | ~100 lines | Inline tag, compendium ref, and completion CSS |
| `src/renderers/renderer-utils.ts` | ~10 lines | Add `alert-triangle` to Lucide icon lookup |

### Unchanged (reused as-is)

| File | Used by |
|------|---------|
| `src/parsers/inline-tag-parser.ts` | Inline tag extension |
| `src/renderers/inline-tag-renderer.ts` | Inline tag extension |
| `src/extensions/compendium-ref-parser.ts` | Compendium ref extension |
| `src/entities/entity-registry.ts` | Compendium ref + suggest |
| `src/entities/compendium-manager.ts` | Compendium ref (edit/delete) |
| `src/edit/monster-edit-render.ts` | Compendium ref (edit mode) |
| `src/edit/spell-edit-render.ts` | Compendium ref (edit mode) |
| `src/edit/item-edit-render.ts` | Compendium ref (edit mode) |
| `src/edit/side-buttons.ts` | Compendium ref |
| `src/edit/searchable-tag-select.ts` | Compendium ref (edit mode) |
| `src/edit/compendium-picker.ts` | Compendium ref (save-as-new) |

### Totals

| Category | Files | Est. Lines |
|----------|-------|-----------|
| New | 3 | ~650 |
| Modified | 3 | ~140 delta |
| **Total new code** | | **~790 lines** |

---

## What Phase 4 Does NOT Include

- **Dice rolling** -- pills are visual only. Deferred to Phase 5.
- **Bare dice auto-detection in regular blocks** -- only explicit backtick tags. Bare dice detection stays inside stat blocks.
- **Formula resolution in regular blocks** -- tags like `` `atk:STR` `` show "STR" not resolved values. Requires monster context.
- **Reading mode rendering** -- CM6 extensions only work in the editor (edit/live-preview mode). Reading mode shows raw backtick code and `{{...}}` text.
- **Cross-document refresh** -- entity changes only refresh the current editor. Other open pages show stale data until re-rendered.
- **Inline tag editing** (standalone outside stat blocks) -- no edit controls on pills in regular text.

---

## Phase Roadmap (Updated)

| Phase | Status |
|-------|--------|
| Phase 1: Core Rendering | Done |
| Phase 2: Entity & Compendium | Done |
| Phase 3: Edit Mode | Done |
| **Phase 4: Inline Tags & Compendium Refs** | **This spec** |
| Phase 5: Dice Rolling System | Future |
| Phase 6: AI / Inquiry System | Future |
