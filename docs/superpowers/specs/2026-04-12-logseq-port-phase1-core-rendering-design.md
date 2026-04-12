# Archivist TTRPG Blocks -- Logseq Port: Phase 1 Core Stat Block Rendering

**Date:** 2026-04-12
**Status:** Approved
**Scope:** Phase 1 of 5 -- core stat block rendering only

---

## Overview

Port the Archivist TTRPG Blocks plugin from Obsidian to Logseq. Phase 1 delivers fenced code block rendering for D&D 5e monster stat blocks, spells, and magic items -- visually identical to the Obsidian version.

Users write YAML inside ` ```monster `, ` ```spell `, or ` ```item ` fenced code blocks. The plugin renders them as styled parchment stat blocks with inline formula tag pills.

## Target Platform

- **Logseq Classic (0.10.x)** -- file-based version
- **Plugin SDK:** `@logseq/libs` (latest)
- **API:** `logseq.Experiments.registerFencedCodeRenderer` -- experimental in name only, stable for 4+ years, created by a core Logseq developer, powers multiple marketplace plugins

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Data format | YAML in fenced code blocks | Identical to Obsidian version. Maximum parser reuse. Data portable between both apps. |
| Rendering API | `registerFencedCodeRenderer` | Direct analog to Obsidian's `registerMarkdownCodeBlockProcessor`. Stable despite "experimental" label. |
| Renderer output | HTML strings | Pure functions (typed object to string). Testable, no React dependency in rendering logic. |
| HTML safety | All field values escaped via `escapeHtml()` before interpolation. No raw user HTML passes through. Renderers produce HTML from known field values only. | Prevents injection from malformed YAML values. |
| Edit mode | `edit: false` | Phase 1 is read-only rendering. Custom edit controls come in Phase 3. |
| CSS approach | Copy and adapt from Obsidian | Strip Obsidian-specific selectors, namespace under `.archivist-block`, preserve all parchment theming. |
| Inline tags | Included in Phase 1 | Parser and formula resolver are 100% portable. Only the renderer needs rewrite (small). Big visual payoff. |
| Build system | Vite + `vite-plugin-logseq` | Logseq ecosystem standard. HMR support for development. |
| React strategy | Host React via `logseq.Experiments.React` | Required by the fenced code renderer API. Proven pattern from fenced-code-plus plugin. |

---

## Architecture

### Data Flow

```
User writes ```monster YAML block
        |
        v
Logseq detects fenced code block with lang="monster"
        |
        v
logseq.Experiments.registerFencedCodeRenderer callback
        |
        v
React wrapper component (MonsterBlock)
        |
        v
parseMonster(content) -- reused verbatim from archivist-obsidian
        |
        v
Monster typed object (or ParseResult error)
        |
        v
renderMonsterBlock(monster) -- NEW, outputs HTML string
  (calls renderTextWithInlineTags() for description text)
  (calls renderInlineTag() for formula tag pills)
  (all field values escaped via escapeHtml())
        |
        v
Rendered HTML set on DOM ref element
        |
        v
Styled parchment stat block in Logseq
```

Same flow for spell and item blocks.

### Project Structure

```
~/w/archivist-logseq/
  package.json              # logseq plugin manifest + vite build
  tsconfig.json             # path aliases matching obsidian version
  vite.config.ts            # vite + vite-plugin-logseq
  index.html                # plugin iframe shell (required by Logseq)
  icon.png                  # plugin icon
  src/
    index.ts                # entry: logseq.ready(), registers 3 renderers + slash commands
    react-shim.ts           # re-exports logseq.Experiments.React

    # --- NEW: HTML string renderers ---
    renderers/
      renderer-utils.ts     # el() HTML builder, SVG bars, property lines, inline tag text, icon lookup
      monster-renderer.ts   # renderMonsterBlock(monster, columns?) -> string
      spell-renderer.ts     # renderSpellBlock(spell) -> string
      item-renderer.ts      # renderItemBlock(item) -> string
      inline-tag-renderer.ts # renderInlineTag(tag) -> string

    # --- COPIED VERBATIM from archivist-obsidian ---
    parsers/
      yaml-utils.ts         # parseYaml<T>(), ParseResult<T>, abilityModifier(), formatModifier()
      monster-parser.ts     # parseMonster(source) -> ParseResult<Monster>
      spell-parser.ts       # parseSpell(source) -> ParseResult<Spell>
      item-parser.ts        # parseItem(source) -> ParseResult<Item>
      inline-tag-parser.ts  # parseInlineTag(text) -> InlineTag | null
    types/
      monster.ts            # Monster, MonsterAbilities, MonsterAC, MonsterHP, MonsterSpeed, MonsterFeature
      spell.ts              # Spell
      item.ts               # Item
      settings.ts           # ArchivistSettings, DEFAULT_SETTINGS
    dnd/
      constants.ts          # CR tables, sizes, skills, abilities, damage types, conditions
      math.ts               # abilityModifier(), proficiencyBonusFromCR(), hpFromHitDice(), etc.
      formula-tags.ts       # detectFormula(), resolveFormulaTag()
      editable-monster.ts   # EditableMonster interface, monsterToEditable(), editableToMonster()
      recalculate.ts        # recalculate(monster, changedField) -> EditableMonster
      yaml-serializer.ts    # editableToYaml()

    # --- ADAPTED CSS ---
    styles/
      archivist-dnd.css     # parchment theme, stat blocks, inline tags, tables
```

### Portable Layer (Zero Modifications)

These files are copied byte-for-byte from `archivist-obsidian/src/`:

| Directory | Files | Why portable |
|-----------|-------|-------------|
| `parsers/` | 5 files | Pure functions. Only dependency: `js-yaml`. |
| `types/` | 4 files | Pure TypeScript interfaces. Zero dependencies. |
| `dnd/` | 6 files | Pure math/logic. Only dependency: `js-yaml` (yaml-serializer only). |

**Total: 15 files, ~700 lines, zero modifications needed.**

### New Code

#### `src/index.ts` (~80 lines)

Plugin entry point. Responsibilities:
1. `logseq.ready(model, main)` bootstrap
2. `logseq.provideStyle(css)` -- inject adapted parchment CSS
3. Register 3 fenced code renderers via `logseq.Experiments.registerFencedCodeRenderer`
4. Register 3 slash commands: "Monster Stat Block", "Spell Block", "Item Block"
5. Each slash command inserts a template YAML fenced code block at cursor

Each renderer is a React functional component:
- Receives `{ content: string }` from Logseq
- Uses `React.useRef` + `React.useEffect` to manage DOM
- Calls the appropriate parser, then renderer
- Sets rendered HTML on the ref element (all values pre-escaped)
- On parse error, renders an error block instead

#### `src/react-shim.ts` (~2 lines)

```typescript
module.exports = logseq.Experiments.React
```

Aliased as `react` in Vite config so any React imports resolve to the host instance.

#### `src/renderers/renderer-utils.ts` (~300 lines)

Core HTML string building utilities. Key functions:

- **`el(tag, className, content, attrs?)`** -- Returns `<tag class="className" ...attrs>content</tag>` string. Replaces the DOM `el()` from Obsidian.
- **`escapeHtml(str)`** -- Escapes `<`, `>`, `&`, `"`, `'` for safe HTML interpolation. Called on all user-provided field values before they are placed into HTML strings.
- **`createSvgBar()`** -- Returns the parchment SVG divider bar as an SVG string.
- **`createPropertyLine(label, value)`** -- Returns a stat block property line (`<div class="property-line"><span class="property-label">label</span> value</div>`).
- **`createIconProperty(iconName, label, value)`** -- Same but with an inline Lucide SVG icon.
- **`renderTextWithInlineTags(text, monsterCtx?)`** -- Parses text for inline tags (`` `dice:2d6` ``, `` `atk:STR` ``), calls `renderInlineTag()` for each match, returns HTML string with resolved formula values.
- **`convert5eToolsTags(text)`** -- Converts `{@b text}`, `{@i text}`, `{@spell name}` etc. to HTML. Copied from Obsidian with output changed to strings.
- **`lucideIcon(name)`** -- Lookup table returning inline SVG strings for the ~8 icons used: `swords`, `shield`, `heart`, `zap`, `flame`, `eye`, `skull`, `scroll`. Replaces Obsidian's `setIcon()`.
- **`renderErrorBlock(message)`** -- Returns styled error message HTML.

#### `src/renderers/monster-renderer.ts` (~350 lines)

`renderMonsterBlock(monster: Monster, columns?: boolean): string`

Mechanical rewrite of the Obsidian version. Same structure, same CSS classes, same layout logic:
- Header (name, size/type/alignment)
- SVG divider bar
- Core properties (AC, HP, Speed)
- SVG divider bar
- Ability scores table (STR/DEX/CON/INT/WIS/CHA with modifiers)
- SVG divider bar
- Secondary properties (saves, skills, senses, languages, CR)
- SVG divider bar
- Traits (no header in two-column mode, PHB-style inline)
- Actions, Reactions, Legendary Actions (with section headers)
- Two-column layout when `columns` flag is set

All `el()` calls produce strings instead of DOM nodes. `renderTextWithInlineTags()` resolves formula tags using a `MonsterFormulaContext` built from the monster's abilities and proficiency bonus.

#### `src/renderers/spell-renderer.ts` (~100 lines)

`renderSpellBlock(spell: Spell): string`

Same structure as Obsidian: header, level/school, casting time, range, components, duration, description text, at-higher-levels.

#### `src/renderers/item-renderer.ts` (~120 lines)

`renderItemBlock(item: Item): string`

Same structure as Obsidian: header, type/rarity, attunement, weight, properties, description text.

#### `src/renderers/inline-tag-renderer.ts` (~50 lines)

`renderInlineTag(tag: InlineTag, resolvedValue?: string): string`

Returns styled pill HTML for each tag type:
- `dice:2d6` -- blue pill with dice icon
- `atk:STR` -- red pill with sword icon, shows resolved `+7` value
- `dc:CON` -- orange pill with shield icon, shows resolved `DC 15`
- `damage:2d6+STR` -- purple pill with flame icon
- `mod:+3` -- gray pill
- `check:Perception` -- teal pill with eye icon

Each pill uses the same CSS classes as Obsidian (`.archivist-stat-tag-dice`, `.archivist-stat-tag-atk`, etc.) for visual parity.

### CSS Adaptation

Source: `archivist-obsidian/src/styles/archivist-dnd.css` (1854 lines)
Target: `archivist-logseq/src/styles/archivist-dnd.css` (~1600 lines)

**Preserved:**
- All CSS custom properties and parchment color scheme
- Stat block layout: `.stat-block`, `.stat-block-header`, `.property-line`, `.abilities-table`
- SVG divider bar styling
- Inline tag pill styling: `.archivist-stat-tag-*`
- Table styling within descriptions
- Two-column monster layout
- Typography (Libre Baskerville, Noto Sans)
- Error block styling

**Stripped:**
- `.cm-embed-block`, `.cm-line`, `.cm-widget` selectors (CodeMirror)
- `.markdown-rendered`, `.markdown-preview-view` selectors (Obsidian)
- Edit mode CSS (entire `archivist-edit.css` deferred to Phase 3)
- Side button CSS (deferred to Phase 3)

**Added:**
- All selectors scoped under `.archivist-block` namespace
- `@import` for Google Fonts
- Reset overrides to prevent Logseq's default block styles from leaking in (padding, margins, font-size)
- `.archivist-block` base styles: `position: relative`, `font-family`, `font-size`

**Injection:**
```
import css from './styles/archivist-dnd.css?raw'
logseq.provideStyle(css)
```

### Build Configuration

**`package.json`:**
```json
{
  "name": "logseq-plugin-archivist",
  "version": "0.1.0",
  "description": "D&D 5e stat blocks, spells, and magic items for Logseq",
  "main": "dist/index.html",
  "logseq": {
    "id": "archivist-ttrpg",
    "title": "Archivist TTRPG Blocks",
    "icon": "icon.png"
  },
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "@logseq/libs": "^0.0.17",
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "vite": "^5.0.0",
    "vite-plugin-logseq": "^1.0.0"
  }
}
```

**`vite.config.ts`:**
- Entry: `src/index.ts`
- Alias `@/` to `src/`
- Alias `react` to `src/react-shim.ts`
- CSS raw imports enabled
- Output to `dist/`

**`tsconfig.json`:**
- Same path aliases as Obsidian version (`@/*` to `src/*`)
- Target: ES2020, module: ESNext
- strictNullChecks enabled

### Slash Commands

Three commands registered in `main()`:

| Command | Inserts |
|---------|---------|
| "Monster Stat Block" | Template YAML with name, size, type, ac, hp, hit_dice, speed, all six ability scores, cr |
| "Spell Block" | Template YAML with name, level, school, casting_time, range, components, duration, description |
| "Item Block" | Template YAML with name, type, rarity, description |

---

## What Phase 1 Does NOT Include

Explicitly excluded, deferred to later phases:

- **Side buttons** (source toggle, column toggle, edit, trash) -- Phase 3
- **Edit mode** (in-place field editing) -- Phase 3
- **Dice rolling on click** -- Phase 4
- **Entity/Compendium system** (registry, SRD import, storage, cross-references) -- Phase 2
- **Compendium references** (`{{monster:goblin}}` syntax) -- Phase 2
- **Inline tags outside stat blocks** (in regular Logseq text) -- Phase 4
- **AI/Inquiry system** (Claudian chat engine) -- Phase 5
- **Modals** (insert dialogs) -- Phase 3
- **Settings UI** -- Phase 3
- **Two-column toggle** (rendered but not toggleable without side buttons) -- Phase 3

---

## Phase Roadmap

Full port broken into 5 self-contained phases. Each phase has its own spec/plan cycle.

### Phase 1: Core Stat Block Rendering (THIS SPEC)

**Goal:** ` ```monster `, ` ```spell `, ` ```item ` blocks render as styled parchment stat blocks in Logseq.

**Deliverables:**
- Logseq plugin scaffold (Vite + TypeScript + `@logseq/libs`)
- 3 fenced code renderers via `registerFencedCodeRenderer`
- All parsers, types, D&D math copied verbatim (15 files)
- HTML string renderers with inline tag support (5 new files)
- Parchment CSS adapted from Obsidian (~1600 lines)
- 3 slash commands for inserting template blocks

**Portable code reused:** parsers/, types/, dnd/ (15 files, ~700 lines)
**New code:** index.ts, react-shim.ts, renderers/ (6 files, ~900 lines)
**Adapted:** styles/ (1 file, ~1600 lines)

### Phase 2: Entity & Compendium System

**Goal:** SRD entity registry, compendium storage, and cross-reference rendering in Logseq.

**Key work:**
- `EntityRegistry` copied verbatim (pure in-memory store)
- `entity-vault-store.ts` utilities copied verbatim (slugify, generateEntityMarkdown, parseEntityFile)
- `srd-normalizer.ts` + `srd-tag-converter.ts` copied verbatim
- SRD JSON data files bundled (~44K lines)
- `CompendiumManager` rewritten: replace Obsidian Vault API with Logseq `FileStorage` + page/block API
- `entity-importer.ts` adapted for Logseq file creation
- Compendium reference rendering (`{{monster:goblin}}`) via `onMacroRendererSlotted`
- Entity browse/search UI

**Portable code:** entity-registry, vault-store utils, normalizers, tag converter, SRD data
**Needs adapter:** CompendiumManager (file I/O layer)
**Needs rewrite:** compendium-modal, entity-importer (Logseq API)
**New:** macro renderer for `{{type:slug}}` references

### Phase 3: Edit Mode

**Goal:** In-place editing of stat block fields with custom UI controls.

**Key work:**
- `MonsterEditState` / `edit-state.ts` copied verbatim (pure state management)
- Side buttons on stat blocks (column toggle, edit, trash)
- Monster/spell/item edit renderers rewritten as HTML string forms
- Custom controls: number spinners, searchable tag selects, speed picker
- Save flow: serialize `EditableMonster` to YAML, update code block via Logseq Editor API
- Switch renderers to `edit: true` to expose source toggle
- Settings UI via `logseq.useSettingsSchema()`

**Portable code:** edit-state.ts, editable-monster.ts, recalculate.ts, yaml-serializer.ts
**Needs rewrite:** all edit render files, side buttons, settings tab
**Adapted:** archivist-edit.css

### Phase 4: Inline Tags & Interactivity

**Goal:** Interactive formula tag pills in regular Logseq text, outside stat blocks.

**Key work:**
- Inline tag rendering in regular blocks (not just inside stat blocks)
- Strategy TBD: possibly via `onMacroRendererSlotted` for `` `dice:2d6` `` syntax, or MutationObserver
- Click-to-roll dice integration
- Bare dice auto-detection via `decorateProseDice`
- Formula resolution with context (needs entity lookup for ability scores)

**Portable code:** inline-tag-parser, formula-tags, prose-decorator
**Needs investigation:** How to intercept inline code in Logseq's rendering pipeline

### Phase 5: AI / Inquiry System

**Goal:** Claudian AI chat engine for D&D content generation in Logseq.

**Key work:**
- AI layer copied verbatim: MCP server, schemas, tools, validation, enrichment, system prompt, SRD store (~15 files)
- Chat UI: Logseq main UI iframe with React-based chat interface
- Conversation storage adapter: replace Obsidian VaultFileAdapter with Logseq FileStorage
- Agent management, session persistence
- MCP tool registration for generate_monster, generate_spell, generate_item, search_srd
- Entity generation, enrichment, compendium save pipeline

**Portable code:** entire `src/ai/` directory, core agent types, SDK transforms, prompts
**Needs rewrite:** ClaudianView (chat UI), storage adapters, settings, commands
**Note:** This is ~165 files in the Obsidian version. Likely warrants its own decomposed spec/plan cycle.

---

## `registerFencedCodeRenderer` API Reference

Documented here for future phases and maintenance.

### API Signature

```typescript
logseq.Experiments.registerFencedCodeRenderer(
  lang: string,
  opts: {
    edit?: boolean,
    before?: () => Promise<void>,
    subs?: Array<string>,
    render: (props: { content: string }) => any  // React component
  }
)
```

### How It Works

1. User writes ` ```monster ` fenced code block in a Logseq block
2. Logseq's markdown renderer encounters `["Src" options]` with `language: "monster"`
3. Logseq checks `plugin-handler/hook-fenced-code-by-lang("monster")`
4. If a renderer is registered, Logseq calls `React.createElement(render, { content: joinedLines })`
5. The React component renders inside a `.ui-fenced-code-result` wrapper
6. When `edit: true`, a CodeMirror editor is also shown alongside the result
7. Content changes trigger React re-renders via prop updates

### Constraints

- Render function receives ONLY `{ content: string }` -- no block UUID, no page context
- Must use host React: `logseq.Experiments.React` (not bundled React)
- Single renderer per language identifier
- CSS is global (no shadow DOM) -- namespace selectors carefully
- "Experimental" label has not been acted on in 4+ years

### Stability

- Introduced April 2022 by xyhp915 (core Logseq developer)
- One bugfix in July 2023 (multi-provider support)
- Still present on master as of April 2026
- Powers marketplace plugins: fenced-code-plus, logseq-chess, logseq-runjs, logseq-wypst
- No deprecation signals or removal PRs
