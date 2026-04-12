# Archivist TTRPG Blocks -- Logseq Plugin

A Logseq plugin for D&D 5e content: monster stat blocks, spells, and magic items. Port of the Obsidian plugin (archivist-obsidian). Users write YAML inside fenced code blocks and the plugin renders them as styled parchment stat blocks.

## Build

```bash
cd ~/w/archivist-logseq && npm run build
```

## Architecture

Same parser -> type -> renderer pipeline as the Obsidian version, but renderers output HTML strings instead of DOM elements.

- `src/parsers/` -- Copied from archivist-obsidian (portable, no Obsidian deps)
- `src/types/` -- Copied from archivist-obsidian
- `src/dnd/` -- Copied from archivist-obsidian (constants, math, formula tags)
- `src/renderers/` -- HTML string renderers (ported from Obsidian's DOM renderers)
- `src/styles/` -- Adapted CSS (Obsidian-specific selectors removed)
- `src/index.ts` -- Plugin entry point using Logseq's registerFencedCodeRenderer

## Testing

Uses **Vitest**. Tests in `tests/` directory.

```bash
npx vitest run                          # all tests
npx vitest run tests/parsers/           # parser tests
npx vitest run tests/renderers/         # renderer tests
```

## Source Project

The Obsidian plugin being ported: `~/w/archivist-obsidian`

## Subagent Rules

- Always use **Opus** model for all subagents. Never downgrade to Sonnet or Haiku.
