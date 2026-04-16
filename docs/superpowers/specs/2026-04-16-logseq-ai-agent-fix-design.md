# Logseq AI Agent — Missing Tools & Note Search Fix

**Date:** 2026-04-16
**Status:** Approved

## Problem

The Logseq sidecar AI agent (Claudian) has two broken capabilities:

1. **No note search** — The AI gives generic answers instead of searching the user's Logseq graph. Root cause: `getArchivistSettings()` returns `{}` in `sidecar/src/services.ts:169`, so `ttrpgRootDir` is never set, and the entire D&D system prompt section (which includes "search vault first" instructions) is skipped.

2. **No custom tool calls** — Tools like `generate_monster` don't exist. Root cause: `archivistMcpServer` is hardcoded to `null` in `sidecar/src/services.ts:168`. The entire `src/ai/` layer (MCP server, tool definitions, schemas, SRD store, enrichment) was never ported from the Obsidian plugin.

## Approach

Direct copy of Obsidian's `src/ai/` layer into the sidecar, plus wiring the two stubs. The `src/ai/` modules are pure TypeScript with no Obsidian-specific dependencies — they use Zod schemas and the Claude Agent SDK's `tool()` function.

## Design

### 1. Files to Port

Copy from Obsidian `src/ai/` into Logseq `sidecar/src/ai/`:

| Source (Obsidian) | Destination (Sidecar) | Purpose |
|---|---|---|
| `src/ai/mcp-server.ts` | `sidecar/src/ai/mcp-server.ts` | MCP server factory |
| `src/ai/tools/generation-tools.ts` | `sidecar/src/ai/tools/generation-tools.ts` | generate_monster, spell, item, encounter, npc |
| `src/ai/tools/srd-tools.ts` | `sidecar/src/ai/tools/srd-tools.ts` | search_srd, get_srd_entity |
| `src/ai/schemas/monster-schema.ts` | `sidecar/src/ai/schemas/monster-schema.ts` | Monster input schema |
| `src/ai/schemas/spell-schema.ts` | `sidecar/src/ai/schemas/spell-schema.ts` | Spell input schema |
| `src/ai/schemas/item-schema.ts` | `sidecar/src/ai/schemas/item-schema.ts` | Item input schema |
| `src/ai/schemas/encounter-schema.ts` | `sidecar/src/ai/schemas/encounter-schema.ts` | Encounter input schema |
| `src/ai/schemas/npc-schema.ts` | `sidecar/src/ai/schemas/npc-schema.ts` | NPC input schema |
| `src/ai/schemas/srd-schema.ts` | `sidecar/src/ai/schemas/srd-schema.ts` | SRD search/get input schemas |
| `src/ai/validation/entity-enrichment.ts` | `sidecar/src/ai/validation/entity-enrichment.ts` | Post-generation enrichment |
| `src/ai/validation/cr-xp-mapping.ts` | `sidecar/src/ai/validation/cr-xp-mapping.ts` | CR to XP lookup table |
| `src/ai/srd/srd-store.ts` | `sidecar/src/ai/srd/srd-store.ts` | In-memory SRD database |

**SRD data files:** Copy the JSON files from `src/srd/data/` to `sidecar/src/ai/srd/data/` (monsters.json, spells.json, magicitems.json, armor.json, weapons.json, feats.json, conditions.json, classes.json, backgrounds.json). This duplicates ~2.5MB but keeps the sidecar self-contained. The sidecar uses plain `tsc` with `resolveJsonModule: true`, so JSON imports work.

**New dependency:** Add `zod` to `sidecar/package.json` (currently only a transitive dep via `@modelcontextprotocol/sdk`).

### 2. Settings Bridge

The sidecar needs `ttrpgRootDir` from the Logseq plugin's `ArchivistSettings`. They run in separate processes connected via WebSocket.

**New WebSocket protocol message:**

```typescript
// Plugin → Sidecar
{ type: 'archivist.settings', ttrpgRootDir: string }
```

**Plugin side:** On sidecar connection and whenever archivist settings change, send the message via `SidecarClient`.

**Sidecar side:**
- Store in a `currentArchivistSettings` variable in `services.ts` alongside `currentSettings`
- Wire into context: `getArchivistSettings: () => currentArchivistSettings`
- New WS handler case that receives and stores archivist settings

**Why separate from ClaudianSettings:** Different lifecycles and ownership. `ClaudianSettings` is persisted by the sidecar to `.claude/claudian-settings.json`. `ArchivistSettings` is owned by the Logseq plugin and persisted by Logseq's settings system. Mixing them would create confusing persistence semantics.

### 3. MCP Server Wiring

In `sidecar/src/services.ts` during `initializeServices()`:

1. Import and instantiate `SrdStore` — loads all SRD JSON data into memory at sidecar startup
2. Call `createArchivistMcpServer(srdStore)` to create the in-process MCP server with all 7 tools
3. Set `archivistMcpServer` in the context to the created server instance

**Note:** The Obsidian MCP server conditionally includes a `create_compendium` tool when a `compendiumManager` is provided. The Logseq sidecar doesn't have a compendium manager yet, so `createArchivistMcpServer(srdStore)` is called without it — the tool is simply omitted (7 tools instead of 8). This matches Obsidian's behavior when compendiumManager is undefined.

The `QueryOptionsBuilder` already handles injection — lines 244-248 (persistent) and 291-295 (cold-start) check for `ctx.archivistMcpServer` and add it to `options.mcpServers['archivist']`. No changes needed there.

### 4. System Prompt Fixes

In `sidecar/src/core/prompts/mainAgent.ts`:
- "Obsidian vault management" → "Logseq graph management"
- "Obsidian vault" → "Logseq graph" (all references)
- Obsidian-specific context (wikilinks, frontmatter, dataview) → Logseq equivalents (block references, page properties, queries)
- Path rules referencing vault → graph root

In `sidecar/src/core/prompts/dndContext.ts`:
- "vault" references → "graph" where referring to the user's content store

The AI identity stays "Claudian" — not platform-specific.

### 5. Verification Plan

1. **Build** — `cd sidecar && npm run build` with no type errors
2. **SRD store loads** — sidecar starts without errors
3. **Tool registration** — AI lists `mcp__archivist__generate_monster` etc. when asked
4. **Note search** — ask about campaign content in the graph; AI searches files first
5. **Generate monster** — "generate a goblin" invokes `mcp__archivist__generate_monster`
6. **Chat rendering** — confirm tool result renders as stat block in chat UI (may need follow-up if rendering is broken)
