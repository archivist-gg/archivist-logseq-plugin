# Archivist TTRPG Blocks -- Logseq Port: Phase 2 Entity & Compendium System

**Date:** 2026-04-12
**Status:** Approved
**Scope:** Phase 2 of 5 -- entity registry, compendium storage, SRD import, entity search

---

## Overview

Port the entity and compendium system from the Obsidian plugin to Logseq. Users can import the SRD compendium (325+ D&D 5e entities), browse/search entities, and reference them in their graph using native Logseq linking (`[[SRD/Monsters/Goblin]]`) and page embeds (`{{embed [[SRD/Monsters/Goblin]]}}`).

Phase 1's fenced code renderers already render ` ```monster `, ` ```spell `, and ` ```item ` blocks as styled stat blocks. When an entity page is embedded, the fenced code block on that page renders automatically -- no custom macro renderer needed.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Entity storage | Logseq pages with properties | Entities are graph-native: linkable, searchable via Datascript, visible in graph view. Mirrors Obsidian's file-based approach. |
| Organization | Namespaced pages (`SRD/Monsters/Goblin`) | Logseq namespaces are the native equivalent of folders. `getPagesFromNamespace()` gives type-scoped queries. Prevents name collisions. |
| SRD import trigger | Command palette (`Cmd+Shift+P`) | Creating 300+ pages is a big side effect. User must explicitly choose when to import. |
| Entity referencing | Native `[[]]` links + `{{embed}}` | `{{embed [[SRD/Monsters/Goblin]]}}` renders the entity's fenced code block as a stat block via Phase 1. No custom `{{renderer}}` macro needed. |
| Entity search | Command palette + main UI overlay | Logseq has no `EditorSuggest` API. Custom inline autocomplete is 3-5x effort and fragile. Logseq's native `[[` search already handles page autocomplete. |
| Compendium metadata | Page properties on namespace root | `SRD` page gets `archivist-compendium:: true` and metadata properties. Discoverable via Datascript. |
| `{{renderer}}` macro | Dropped | Redundant once entity pages exist. Native `{{embed}}` + Phase 1 fenced code rendering covers the same use case. |
| Inline autocomplete | Deferred | No plugin API for editor suggest. Logseq's built-in `[[` search covers page-level autocomplete natively. |

---

## Architecture

### Data Flow

```
User invokes "Import SRD Compendium" from command palette
        |
        v
SrdStore.loadFromBundledJson() -- already in memory
        |
        v
For each entity in SrdStore:
  normalizeSrdMonster/Spell/Item(rawData)
        |
        v
  Serialize normalized data to YAML via js-yaml.dump()
  Wrap in fenced code block (```monster\n...\n```)
        |
        v
  Editor.createPage("SRD/Monsters/Goblin", {
    archivist: true, entity-type: "monster",
    slug: "goblin", name: "Goblin", compendium: "SRD"
  }, { redirect: false })
        |
        v
  Editor.appendBlockInPage("SRD/Monsters/Goblin", fencedCodeBlock)
        |
        v
  registry.register(entity)
        |
        v
325+ entity pages created as namespaced Logseq pages
```

```
User types [[SRD/Mon... in a block
        |
        v
Logseq's native [[ autocomplete shows matching pages
        |
        v
User selects "SRD/Monsters/Goblin"
        |
        v
[[SRD/Monsters/Goblin]] inserted as page link
```

```
User writes {{embed [[SRD/Monsters/Goblin]]}} in a block
        |
        v
Logseq embeds the page content (fenced ```monster block)
        |
        v
Phase 1's registerFencedCodeRenderer renders the stat block
        |
        v
Styled parchment monster stat block appears inline
```

### Entity Page Structure

Each entity is a Logseq page with properties and a fenced code block body.

**Page name:** `SRD/Monsters/Goblin`

**Page properties:**
```
archivist:: true
entity-type:: monster
slug:: goblin
name:: Goblin
compendium:: SRD
```

**Page body (first block):**
````
```monster
name: Goblin
size: Small
type: humanoid (goblinoid)
ac:
  - ac: 15
    from:
      - leather armor
      - shield
hp:
  average: 7
  formula: 2d6
speed:
  walk: 30
abilities:
  str: 8
  dex: 14
  con: 10
  int: 10
  wis: 8
  cha: 8
cr: "1/4"
traits:
  - name: Nimble Escape
    entries:
      - "The goblin can take the Disengage or Hide action as a bonus action on each of its turns."
actions:
  - name: Scimitar
    entries:
      - "`atk:DEX` `damage:1d6+DEX` slashing damage."
```
````

### Compendium Metadata Page

Each compendium is represented by a namespace root page.

**Page name:** `SRD`

**Page properties:**
```
archivist-compendium:: true
compendium-description:: System Reference Document - D&D 5e
compendium-readonly:: true
compendium-homebrew:: false
```

### Project Structure (Phase 2 additions)

```
src/
  # --- COPIED VERBATIM from archivist-obsidian ---
  entities/
    entity-registry.ts        # In-memory dual-indexed entity store (149 lines)
    entity-vault-store.ts      # slugify, generateEntityMarkdown, parseEntityFile (210 lines)
    srd-normalizer.ts          # open5e JSON -> plugin YAML schema (441 lines)
    srd-tag-converter.ts       # Reverse-engineer formula tags from SRD prose (259 lines)
  srd/
    srd-store.ts               # In-memory SRD data store with search (160 lines)
    data/
      monsters.json            # 953 KB
      spells.json              # 585 KB
      classes.json             # 571 KB
      magicitems.json          # 271 KB
      weapons.json             # 18 KB
      armor.json               # 11 KB
      conditions.json          # 8.6 KB
      backgrounds.json         # 6.7 KB
      feats.json               # 765 B
  extensions/
    compendium-ref-parser.ts   # Parse "monster:goblin" -> {entityType, slug} (23 lines)

  # --- NEW / REWRITTEN for Logseq ---
  entities/
    compendium-manager.ts      # Rewritten: Logseq page/block API instead of Vault (~350 lines)
    entity-importer.ts         # Adapted: createPage + appendBlockInPage (~120 lines)
  ui/
    entity-search.ts           # Search overlay UI + entity insertion (~150 lines)
    entity-search.css          # Search overlay styling (~80 lines)
```

---

## Portable Layer (Zero Modifications)

These files copy byte-for-byte from `archivist-obsidian/src/`:

| Directory | Files | Lines | Why portable |
|-----------|-------|-------|-------------|
| `entities/entity-registry.ts` | 1 | 149 | Pure in-memory store. Two Maps, search, register/unregister. Zero dependencies. |
| `entities/entity-vault-store.ts` | 1 | 210 | Pure functions: `slugify`, `ensureUniqueSlug`, `parseEntityFile`, `TYPE_FOLDER_MAP`. `generateEntityMarkdown()` not used directly for Logseq page creation but kept for potential future use. Only dependency: `js-yaml`. |
| `entities/srd-normalizer.ts` | 1 | 441 | Pure transforms. Dependencies: `srd-tag-converter`, `dnd/math` (both already in project). |
| `entities/srd-tag-converter.ts` | 1 | 259 | Pure regex-based tag conversion. Dependency: `dnd/math`. |
| `srd/srd-store.ts` | 1 | 160 | Pure in-memory store. One adaptation: `require()` -> `import` for Vite bundling. |
| `srd/data/*.json` | 9 | ~44K | Raw open5e data. |
| `extensions/compendium-ref-parser.ts` | 1 | 23 | Pure regex parser. Zero dependencies. Not directly used in Phase 2 (renderer macro dropped), included for forward compatibility with later phases. |

**Total: 15 files, ~1,240 lines + ~2.4MB JSON data.**

---

## CompendiumManager Rewrite

The Obsidian `CompendiumManager` (416 lines) wraps 7 Vault API calls. The Logseq version replaces file operations with page/block operations but preserves the same public interface.

### Obsidian -> Logseq API Mapping

| Obsidian Vault call | Logseq equivalent |
|---|---|
| `vault.getAbstractFileByPath(path)` | `logseq.Editor.getPage(pageName)` |
| `vault.cachedRead(file)` | `logseq.Editor.getPageBlocksTree(pageName)` -- extract content from first block |
| `vault.createFolder(path)` | No-op -- namespaces auto-create when pages are created |
| `vault.create(path, content)` | `logseq.Editor.createPage(name, properties, {redirect: false})` + `logseq.Editor.appendBlockInPage(name, content)` |
| `vault.modify(file, content)` | `logseq.Editor.updateBlock(blockUuid, newContent)` |
| `vault.delete(file)` | `logseq.Editor.deletePage(pageName)` |
| `vault.getMarkdownFiles()` + scan | `logseq.DB.datascriptQuery()` with property filter |

### Compendium Discovery

Instead of scanning folders for `_compendium.md` files:

```typescript
// Datascript query: find all pages with archivist-compendium property
const compendiumPages = await logseq.DB.datascriptQuery(`
  [:find (pull ?p [*])
   :where
   [?p :block/properties ?props]
   [(get ?props :archivist-compendium) ?v]
   [(= ?v true)]]
`)
```

### Entity Loading

Instead of scanning folders for markdown files with frontmatter:

```typescript
// Datascript query: find all pages with archivist property
const entityPages = await logseq.DB.datascriptQuery(`
  [:find (pull ?p [*])
   :where
   [?p :block/properties ?props]
   [(get ?props :archivist) ?v]
   [(= ?v true)]]
`)
```

For each entity page, read the first block's content to extract the fenced code YAML, parse it, and register in the `EntityRegistry`.

### Public Interface (unchanged)

| Method | Behavior change |
|--------|----------------|
| `getAll()` | Same -- returns in-memory array |
| `getWritable()` | Same |
| `getByName(name)` | Same |
| `discover()` | Datascript query for `archivist-compendium:: true` pages instead of folder scan |
| `loadAllEntities()` | Datascript query for `archivist:: true` pages, read first block for YAML |
| `create(name, description, homebrew, readonly)` | `createPage()` with compendium properties instead of `vault.createFolder()` + `vault.create()` |
| `saveEntity(compendiumName, entityType, data)` | `createPage()` with entity properties + `appendBlockInPage()` with fenced code block |
| `updateEntity(slug, data)` | `getPageBlocksTree()` to find first block UUID, then `updateBlock()` |
| `deleteEntity(slug)` | `deletePage()` instead of `vault.delete()` |
| `countReferences(slug)` | Datascript query searching block content for embed/link references |

---

## Entity Importer

Adapts `entity-importer.ts` (162 lines) from Vault file creation to Logseq page creation.

### Trigger

Command palette entry: `"Archivist: Import SRD Compendium"`

### Flow

1. User invokes via `Cmd+Shift+P` > "Archivist: Import SRD Compendium"
2. Check if `SRD` compendium page exists (`Editor.getPage("SRD")`) -- if yes, show "SRD already imported" toast and bail
3. Create `SRD` namespace root page with `archivist-compendium:: true` properties
4. Iterate all entity types from `SrdStore` (`srdStore.getTypes()` + `srdStore.getAllOfType()`)
5. For each entity:
   - Normalize via `normalizeSrdMonster/Spell/Item()`
   - Build page name: `SRD/${TYPE_FOLDER_MAP[entityType]}/${sanitizedName}` (e.g., `SRD/Monsters/Goblin`)
   - Create page with properties via `Editor.createPage()`
   - Append fenced code block via `Editor.appendBlockInPage()`
   - Register in `EntityRegistry`
6. Show progress via `UI.showMsg()` every 50 entities
7. Final toast: "SRD import complete: N entities imported"

### Resume Safety

Before creating each page, check `Editor.getPage(pageName)` -- skip if it already exists. Safe to re-run if interrupted.

### Rate Handling

Sequential page creation (await each create, no parallelism). Progress toasts communicate status. If this proves too slow in practice, batch optimizations can be added later.

---

## Entity Search UI

### Trigger

Command palette entry: `"Archivist: Search Entity"`

### Flow

1. User invokes via `Cmd+Shift+P` > "Archivist: Search Entity"
2. Plugin shows main UI overlay (`logseq.showMainUI()`) -- centered modal with search input
3. User types to filter -- searches `EntityRegistry.search(query, entityType?, limit)`
4. Results show: entity name, type badge (monster/spell/item), compendium name
5. Type filter buttons: All | Monsters | Spells | Items | Magic Items | etc.
6. On selection:
   - Check if user is currently editing a block (`Editor.checkEditing()`)
   - If editing: insert `{{embed [[SRD/Monsters/Goblin]]}}` at cursor via `Editor.insertAtEditingCursor()`
   - If not editing: navigate to the entity page via `App.pushState('page', { name: pageName })`
7. Hide main UI (`logseq.hideMainUI()`)

### UI Implementation

Simple HTML rendered inside the plugin iframe (`index.html`):
- Search input with autofocus
- Scrollable results list
- Type filter row
- Keyboard navigable: arrow keys to move selection, Enter to select, Escape to close
- Styled to match Logseq theme using CSS variables (`--ls-primary-background-color`, `--ls-secondary-background-color`, etc.)

Event handling via `logseq.provideModel()` with `data-on-click` bindings on result items.

### Files

- `src/ui/entity-search.ts` (~150 lines) -- search overlay logic, keyboard handling, entity insertion
- `src/ui/entity-search.css` (~80 lines) -- overlay styling

---

## Plugin Initialization

Updated `src/index.ts` startup sequence:

```
logseq.ready(main)
  |
  v
1. logseq.provideStyle(css)                          # existing Phase 1
2. Register 3 fenced code renderers                   # existing Phase 1
3. Register 3 slash commands (YAML templates)          # existing Phase 1
4. Create SrdStore, call loadFromBundledJson()         # NEW
5. Create EntityRegistry                               # NEW
6. Create CompendiumManager(registry)                  # NEW
7. compendiumManager.discover()                        # NEW
8. compendiumManager.loadAllEntities()                 # NEW
9. Register command palette: "Archivist: Import SRD"   # NEW
10. Register command palette: "Archivist: Search Entity" # NEW
11. logseq.provideModel({ ...searchUIHandlers })       # NEW
```

---

## What Phase 2 Does NOT Include

Explicitly excluded, deferred to later phases:

- **`{{renderer}}` macro rendering** -- dropped; native `{{embed [[Page]]}}` + Phase 1 fenced code rendering covers this use case
- **Inline `{{` or `[[` autocomplete** -- deferred; Logseq has no `EditorSuggest` API, native `[[` search handles page autocomplete
- **Compendium modals** (create, select, save-as-new) -- Phase 3 alongside edit mode
- **Entity editing via references** -- Phase 3
- **Side buttons on rendered blocks** -- Phase 3
- **Settings UI** -- not needed for Phase 2
- **Cross-document reference counting** -- implemented in CompendiumManager but not surfaced in UI until Phase 3
- **Homebrew compendium creation UI** -- Phase 3

---

## File Summary

| Category | Files | Lines (est.) |
|----------|-------|-------------|
| Copied verbatim | 15 | ~1,240 + 2.4MB JSON |
| Rewritten for Logseq | 2 | ~470 |
| New for Logseq | 2 | ~230 |
| **Total** | **19** | **~1,940 lines + 2.4MB JSON** |
