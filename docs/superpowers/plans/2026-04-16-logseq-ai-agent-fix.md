# Logseq AI Agent Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Logseq sidecar AI agent so it searches user notes and provides D&D generation tools (generate_monster, etc.) — matching the working Obsidian version.

**Architecture:** Copy Obsidian's `src/ai/` layer (MCP server, tools, schemas, SRD store, enrichment) into the Logseq sidecar as `sidecar/src/ai/`. Wire the two stubs in `services.ts`. Add a WebSocket settings bridge to pass `ttrpgRootDir` from the Logseq plugin to the sidecar. Update system prompts from Obsidian to Logseq terminology.

**Tech Stack:** TypeScript (ESM/NodeNext), Claude Agent SDK, Zod, MCP protocol, WebSocket

**Key constraint:** The sidecar uses ESM (`"type": "module"`, `"module": "NodeNext"`) — all relative imports MUST have `.js` extensions. The build is plain `tsc` which does NOT copy non-TS files, so JSON data needs a manual copy step.

---

### Task 1: Add zod dependency and update build script

**Files:**
- Modify: `sidecar/package.json`

- [ ] **Step 1: Install zod**

```bash
cd ~/w/archivist-logseq/sidecar && npm install zod
```

- [ ] **Step 2: Update build script to copy SRD JSON data after compilation**

In `sidecar/package.json`, change the `build` script:

```json
"build": "tsc && cp -r src/ai/srd/data dist/ai/srd/data"
```

The `tsc` does not copy non-TS files. This ensures the JSON data files are available at runtime in `dist/ai/srd/data/`.

- [ ] **Step 3: Commit**

```bash
git add sidecar/package.json sidecar/package-lock.json
git commit -m "chore: add zod dependency and update sidecar build script"
```

---

### Task 2: Copy SRD JSON data files

**Files:**
- Create: `sidecar/src/ai/srd/data/monsters.json`
- Create: `sidecar/src/ai/srd/data/spells.json`
- Create: `sidecar/src/ai/srd/data/magicitems.json`
- Create: `sidecar/src/ai/srd/data/armor.json`
- Create: `sidecar/src/ai/srd/data/weapons.json`
- Create: `sidecar/src/ai/srd/data/feats.json`
- Create: `sidecar/src/ai/srd/data/conditions.json`
- Create: `sidecar/src/ai/srd/data/classes.json`
- Create: `sidecar/src/ai/srd/data/backgrounds.json`

- [ ] **Step 1: Create directory and copy all JSON files**

```bash
mkdir -p ~/w/archivist-logseq/sidecar/src/ai/srd/data
cp ~/w/archivist-logseq/src/srd/data/*.json ~/w/archivist-logseq/sidecar/src/ai/srd/data/
```

- [ ] **Step 2: Verify files exist**

```bash
ls -la ~/w/archivist-logseq/sidecar/src/ai/srd/data/
```

Expected: 9 JSON files (monsters.json, spells.json, magicitems.json, armor.json, weapons.json, feats.json, conditions.json, classes.json, backgrounds.json).

- [ ] **Step 3: Commit**

```bash
cd ~/w/archivist-logseq && git add sidecar/src/ai/srd/data/
git commit -m "chore: copy SRD JSON data into sidecar"
```

---

### Task 3: Port type interfaces

**Files:**
- Create: `sidecar/src/ai/types/monster.ts`
- Create: `sidecar/src/ai/types/spell.ts`
- Create: `sidecar/src/ai/types/item.ts`

Copy the type files from the Logseq plugin side. These are the same types used by both the plugin renderers and the AI tools.

- [ ] **Step 1: Create directory and copy type files**

```bash
mkdir -p ~/w/archivist-logseq/sidecar/src/ai/types
cp ~/w/archivist-logseq/src/types/monster.ts ~/w/archivist-logseq/sidecar/src/ai/types/
cp ~/w/archivist-logseq/src/types/spell.ts ~/w/archivist-logseq/sidecar/src/ai/types/
cp ~/w/archivist-logseq/src/types/item.ts ~/w/archivist-logseq/sidecar/src/ai/types/
```

These files have no imports, so they work as-is in the sidecar's ESM context.

- [ ] **Step 2: Commit**

```bash
cd ~/w/archivist-logseq && git add sidecar/src/ai/types/
git commit -m "feat: port D&D type interfaces to sidecar"
```

---

### Task 4: Port schema files

**Files:**
- Create: `sidecar/src/ai/schemas/monster-schema.ts`
- Create: `sidecar/src/ai/schemas/spell-schema.ts`
- Create: `sidecar/src/ai/schemas/item-schema.ts`
- Create: `sidecar/src/ai/schemas/encounter-schema.ts`
- Create: `sidecar/src/ai/schemas/npc-schema.ts`
- Create: `sidecar/src/ai/schemas/srd-schema.ts`

Copy from Obsidian's `src/ai/schemas/`. These files import only from `zod` (no relative imports), so they need NO changes.

- [ ] **Step 1: Create directory and copy all schema files**

```bash
mkdir -p ~/w/archivist-logseq/sidecar/src/ai/schemas
cp ~/w/archivist-obsidian/src/ai/schemas/monster-schema.ts ~/w/archivist-logseq/sidecar/src/ai/schemas/
cp ~/w/archivist-obsidian/src/ai/schemas/spell-schema.ts ~/w/archivist-logseq/sidecar/src/ai/schemas/
cp ~/w/archivist-obsidian/src/ai/schemas/item-schema.ts ~/w/archivist-logseq/sidecar/src/ai/schemas/
cp ~/w/archivist-obsidian/src/ai/schemas/encounter-schema.ts ~/w/archivist-logseq/sidecar/src/ai/schemas/
cp ~/w/archivist-obsidian/src/ai/schemas/npc-schema.ts ~/w/archivist-logseq/sidecar/src/ai/schemas/
cp ~/w/archivist-obsidian/src/ai/schemas/srd-schema.ts ~/w/archivist-logseq/sidecar/src/ai/schemas/
```

- [ ] **Step 2: Verify no relative imports need updating**

```bash
grep -n 'from "\.' ~/w/archivist-logseq/sidecar/src/ai/schemas/*.ts
```

Expected: no matches (these files only import from `"zod"`).

- [ ] **Step 3: Commit**

```bash
cd ~/w/archivist-logseq && git add sidecar/src/ai/schemas/
git commit -m "feat: port D&D schema files to sidecar"
```

---

### Task 5: Port validation helpers (cr-xp-mapping, dnd-math, srd-tag-converter)

**Files:**
- Create: `sidecar/src/ai/validation/cr-xp-mapping.ts`
- Create: `sidecar/src/ai/validation/dnd-math.ts`
- Create: `sidecar/src/ai/validation/srd-tag-converter.ts`

- [ ] **Step 1: Create directory and copy cr-xp-mapping**

```bash
mkdir -p ~/w/archivist-logseq/sidecar/src/ai/validation
cp ~/w/archivist-obsidian/src/ai/validation/cr-xp-mapping.ts ~/w/archivist-logseq/sidecar/src/ai/validation/
```

This file has no imports — works as-is.

- [ ] **Step 2: Create dnd-math.ts**

The Obsidian `entity-enrichment.ts` imports `abilityModifier` from `../../parsers/yaml-utils`, and `srd-tag-converter.ts` imports `abilityModifier`, `attackBonus`, `saveDC` from `../../dnd/math`. These functions exist in the Logseq plugin side at `src/dnd/math.ts` and `src/parsers/yaml-utils.ts`. Extract the three needed functions into a local file.

Create `sidecar/src/ai/validation/dnd-math.ts`:

```typescript
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function attackBonus(abilityScore: number, profBonus: number): number {
  return abilityModifier(abilityScore) + profBonus;
}

export function saveDC(abilityScore: number, profBonus: number): number {
  return 8 + profBonus + abilityModifier(abilityScore);
}
```

- [ ] **Step 3: Copy srd-tag-converter.ts and update imports**

```bash
cp ~/w/archivist-logseq/src/entities/srd-tag-converter.ts ~/w/archivist-logseq/sidecar/src/ai/validation/
```

Then update the import on line 3 from:

```typescript
import { abilityModifier, attackBonus, saveDC } from "../dnd/math";
```

to:

```typescript
import { abilityModifier, attackBonus, saveDC } from "./dnd-math.js";
```

- [ ] **Step 4: Verify compilation of these files**

```bash
cd ~/w/archivist-logseq/sidecar && npx tsc --noEmit src/ai/validation/cr-xp-mapping.ts src/ai/validation/dnd-math.ts src/ai/validation/srd-tag-converter.ts
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd ~/w/archivist-logseq && git add sidecar/src/ai/validation/
git commit -m "feat: port D&D validation helpers to sidecar"
```

---

### Task 6: Port entity-enrichment.ts

**Files:**
- Create: `sidecar/src/ai/validation/entity-enrichment.ts`

This file has the most cross-module imports to rewrite.

- [ ] **Step 1: Copy the file**

```bash
cp ~/w/archivist-obsidian/src/ai/validation/entity-enrichment.ts ~/w/archivist-logseq/sidecar/src/ai/validation/
```

- [ ] **Step 2: Rewrite all imports**

Replace the imports at the top of the file. Change:

```typescript
import { getChallengeRatingXP, getProficiencyBonus } from "./cr-xp-mapping";
import { abilityModifier } from "../../parsers/yaml-utils";
import {
  convertDescToTags,
  detectSpellcastingAbility,
  type ActionCategory,
  type ConversionContext,
  type ConverterAbilities,
} from "../../entities/srd-tag-converter";
import type { Monster } from "../../types/monster";
import type { Spell } from "../../types/spell";
import type { Item } from "../../types/item";
```

to:

```typescript
import { getChallengeRatingXP, getProficiencyBonus } from "./cr-xp-mapping.js";
import { abilityModifier } from "./dnd-math.js";
import {
  convertDescToTags,
  detectSpellcastingAbility,
  type ActionCategory,
  type ConversionContext,
  type ConverterAbilities,
} from "./srd-tag-converter.js";
import type { Monster } from "../types/monster.js";
import type { Spell } from "../types/spell.js";
import type { Item } from "../types/item.js";
```

- [ ] **Step 3: Verify compilation**

```bash
cd ~/w/archivist-logseq/sidecar && npx tsc --noEmit src/ai/validation/entity-enrichment.ts
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd ~/w/archivist-logseq && git add sidecar/src/ai/validation/entity-enrichment.ts
git commit -m "feat: port entity enrichment to sidecar"
```

---

### Task 7: Port SrdStore with ESM adaptation

**Files:**
- Create: `sidecar/src/ai/srd/srd-store.ts`

The Obsidian version uses `require()` for JSON loading, which doesn't work in ESM. Adapt to use `createRequire` from `node:module`.

- [ ] **Step 1: Copy the SrdStore from Obsidian**

```bash
mkdir -p ~/w/archivist-logseq/sidecar/src/ai/srd
cp ~/w/archivist-obsidian/src/ai/srd/srd-store.ts ~/w/archivist-logseq/sidecar/src/ai/srd/
```

- [ ] **Step 2: Replace the `loadFromBundledJson` method**

The Obsidian version's `loadFromBundledJson()` (around line 78) uses bare `require()` calls with paths to `../../srd/data/`. Replace the entire method with a `createRequire`-based version that loads from the local `./data/` directory:

Add a top-level import at the very top of the file:

```typescript
import { createRequire } from 'node:module';
```

Then replace the `loadFromBundledJson()` method body. Change:

```typescript
  loadFromBundledJson(): void {
    /* eslint-disable @typescript-eslint/no-var-requires */
    const sources: SrdDataSources = {
      monsters: require("../../srd/data/monsters.json"),
      spells: require("../../srd/data/spells.json"),
      magicitems: require("../../srd/data/magicitems.json"),
      armor: require("../../srd/data/armor.json"),
      weapons: require("../../srd/data/weapons.json"),
      feats: require("../../srd/data/feats.json"),
      conditions: require("../../srd/data/conditions.json"),
      classes: require("../../srd/data/classes.json"),
      backgrounds: require("../../srd/data/backgrounds.json"),
    };
    /* eslint-enable @typescript-eslint/no-var-requires */
    this.loadFromData(sources);
  }
```

to:

```typescript
  /**
   * Load all bundled SRD JSON files.
   * Uses createRequire for ESM compatibility — JSON files must exist in ./data/
   * relative to the compiled output (the build script copies them).
   */
  loadFromBundledJson(): void {
    const esmRequire = createRequire(import.meta.url);
    const sources: SrdDataSources = {
      monsters: esmRequire("./data/monsters.json"),
      spells: esmRequire("./data/spells.json"),
      magicitems: esmRequire("./data/magicitems.json"),
      armor: esmRequire("./data/armor.json"),
      weapons: esmRequire("./data/weapons.json"),
      feats: esmRequire("./data/feats.json"),
      conditions: esmRequire("./data/conditions.json"),
      classes: esmRequire("./data/classes.json"),
      backgrounds: esmRequire("./data/backgrounds.json"),
    };
    this.loadFromData(sources);
  }
```

- [ ] **Step 3: Verify compilation**

```bash
cd ~/w/archivist-logseq/sidecar && npx tsc --noEmit src/ai/srd/srd-store.ts
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd ~/w/archivist-logseq && git add sidecar/src/ai/srd/
git commit -m "feat: port SrdStore to sidecar with ESM adaptation"
```

---

### Task 8: Port tool definitions and MCP server

**Files:**
- Create: `sidecar/src/ai/tools/generation-tools.ts`
- Create: `sidecar/src/ai/tools/srd-tools.ts`
- Create: `sidecar/src/ai/mcp-server.ts`

- [ ] **Step 1: Copy tool files**

```bash
mkdir -p ~/w/archivist-logseq/sidecar/src/ai/tools
cp ~/w/archivist-obsidian/src/ai/tools/generation-tools.ts ~/w/archivist-logseq/sidecar/src/ai/tools/
cp ~/w/archivist-obsidian/src/ai/tools/srd-tools.ts ~/w/archivist-logseq/sidecar/src/ai/tools/
cp ~/w/archivist-obsidian/src/ai/mcp-server.ts ~/w/archivist-logseq/sidecar/src/ai/
```

- [ ] **Step 2: Add .js extensions to all relative imports**

In `sidecar/src/ai/tools/generation-tools.ts`, update all imports:

```typescript
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { monsterInputSchema } from "../schemas/monster-schema.js";
import { spellInputSchema } from "../schemas/spell-schema.js";
import { itemInputSchema } from "../schemas/item-schema.js";
import { encounterInputSchema } from "../schemas/encounter-schema.js";
import { npcInputSchema } from "../schemas/npc-schema.js";
import { enrichMonster, enrichSpell, enrichItem } from "../validation/entity-enrichment.js";
```

In `sidecar/src/ai/tools/srd-tools.ts`, update imports:

```typescript
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { searchSrdInput, getSrdEntityInput } from "../schemas/srd-schema.js";
import type { SrdStore } from "../srd/srd-store.js";
```

In `sidecar/src/ai/mcp-server.ts`, update imports:

```typescript
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  generateMonsterTool,
  generateSpellTool,
  generateItemTool,
  generateEncounterTool,
  generateNpcTool,
} from "./tools/generation-tools.js";
import { createSrdTools } from "./tools/srd-tools.js";
import type { SrdStore } from "./srd/srd-store.js";
```

- [ ] **Step 3: Verify full compilation**

```bash
cd ~/w/archivist-logseq/sidecar && npx tsc --noEmit
```

Expected: no errors. This validates all the `src/ai/` modules compile together.

- [ ] **Step 4: Commit**

```bash
cd ~/w/archivist-logseq && git add sidecar/src/ai/tools/ sidecar/src/ai/mcp-server.ts
git commit -m "feat: port D&D tools and MCP server to sidecar"
```

---

### Task 9: Wire MCP server in services.ts

**Files:**
- Modify: `sidecar/src/services.ts`

- [ ] **Step 1: Add imports**

At the top of `sidecar/src/services.ts`, add:

```typescript
import { SrdStore } from './ai/srd/srd-store.js';
import { createArchivistMcpServer } from './ai/mcp-server.js';
```

- [ ] **Step 2: Create SrdStore and MCP server in initializeServices()**

After the agent manager initialization (line 151: `await agentManager.loadAgents();`) and before the pending callback registries (line 153), add:

```typescript
  // 4b. SRD store + Archivist MCP server
  const srdStore = new SrdStore();
  srdStore.loadFromBundledJson();
  const archivistMcpServer = createArchivistMcpServer(srdStore);
```

- [ ] **Step 3: Replace the stubs in the SidecarContext**

In the `context` object (line 159-170), replace the two stubs:

Change:
```typescript
    archivistMcpServer: null,
    getArchivistSettings: () => ({}),
```

to:
```typescript
    archivistMcpServer,
    getArchivistSettings: () => currentArchivistSettings,
```

- [ ] **Step 4: Add the archivist settings variable**

After `currentSettings` is finalized (around line 139, after slash commands are loaded), add:

```typescript
  // Archivist D&D settings — updated via archivist.settings WS message
  let currentArchivistSettings: { ttrpgRootDir?: string } = { ttrpgRootDir: '/' };
```

Default to `'/'` (graph root) so the D&D system prompt section is always active even before the plugin sends settings.

- [ ] **Step 5: Expose archivist settings mutation in SidecarServices**

Add to the return object (line 175-185) so the WS handler can update it:

```typescript
  return {
    storage,
    sessionRouter,
    mcp,
    notifications,
    pendingApprovals,
    pendingPlanDecisions,
    pendingAskUser,
    graphRoot,
    getSettings: () => currentSettings,
    setArchivistSettings: (settings: { ttrpgRootDir?: string }) => {
      currentArchivistSettings = settings;
    },
  };
```

Also update the `SidecarServices` interface (line 80-92) to include:

```typescript
  /** Update archivist D&D settings (from plugin). */
  setArchivistSettings(settings: { ttrpgRootDir?: string }): void;
```

- [ ] **Step 6: Verify compilation**

```bash
cd ~/w/archivist-logseq/sidecar && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd ~/w/archivist-logseq && git add sidecar/src/services.ts
git commit -m "feat: wire SrdStore and MCP server into sidecar context"
```

---

### Task 10: Settings bridge — sidecar side (protocol + handler)

**Files:**
- Modify: `sidecar/src/ws/protocol.ts`
- Modify: `sidecar/src/ws/handler.ts`

- [ ] **Step 1: Add message type to sidecar protocol**

In `sidecar/src/ws/protocol.ts`, after `InstructionRefineMessage` (line 168-172), add:

```typescript
export interface ArchivistSettingsMessage extends ClientMessageBase {
  type: 'archivist.settings';
  ttrpgRootDir: string;
}
```

Add it to the `ClientMessage` union type (line 174-198) — add `| ArchivistSettingsMessage` to the union.

- [ ] **Step 2: Add handler case**

In `sidecar/src/ws/handler.ts`, in the `routeMessage` switch statement, before the `default` case (line 355), add:

```typescript
      case 'archivist.settings':
        services.setArchivistSettings({ ttrpgRootDir: message.ttrpgRootDir });
        break;
```

Note: `message` needs a type assertion or the switch-case narrows correctly via the discriminated union.

- [ ] **Step 3: Verify compilation**

```bash
cd ~/w/archivist-logseq/sidecar && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd ~/w/archivist-logseq && git add sidecar/src/ws/protocol.ts sidecar/src/ws/handler.ts
git commit -m "feat: add archivist.settings WS message handler"
```

---

### Task 11: Settings bridge — plugin side (protocol + client + InquiryPanel)

**Files:**
- Modify: `src/inquiry/protocol.ts`
- Modify: `src/inquiry/SidecarClient.ts`
- Modify: `src/inquiry/InquiryPanel.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Add message type to plugin-side protocol**

In `src/inquiry/protocol.ts`, add the same `ArchivistSettingsMessage` interface (after `InstructionRefineMessage`):

```typescript
export interface ArchivistSettingsMessage extends ClientMessageBase {
  type: 'archivist.settings';
  ttrpgRootDir: string;
}
```

Add `| ArchivistSettingsMessage` to the `ClientMessage` union type.

- [ ] **Step 2: Add send method to SidecarClient**

In `src/inquiry/SidecarClient.ts`, after `sendInstructionRefine` (line 303-305), add:

```typescript
  sendArchivistSettings(tabId: string, ttrpgRootDir: string): void {
    this.send({ type: "archivist.settings", tabId, ttrpgRootDir });
  }
```

- [ ] **Step 3: Send archivist settings on sidecar ready**

In `src/inquiry/InquiryPanel.ts`, in the `onSidecarReady()` method (line 171-187), add sending archivist settings right after the console.log (line 174):

```typescript
  private onSidecarReady(): void {
    if (this.chatViewReady || !this.contentEl) return;

    console.log('[archivist] Sidecar ready — initializing ChatView');

    // Send archivist D&D settings to sidecar
    const ttrpgRootDir = (logseq.settings?.ttrpgRootDir as string) || '/';
    this.client.sendArchivistSettings('system', ttrpgRootDir);

    this.chatView = new ChatView({
```

- [ ] **Step 4: Register ttrpgRootDir in Logseq settings schema**

In `src/index.ts`, in the `logseq.useSettingsSchema([...])` call (line 300), add a new entry after the `sidecarPort` entry (before the closing `]`):

```typescript
    {
      key: "ttrpgRootDir",
      type: "string",
      default: "/",
      title: "TTRPG Root Directory",
      description: "Root directory for D&D campaign files. The AI searches within this directory first. Use '/' for the entire graph.",
    },
```

- [ ] **Step 5: Verify compilation**

```bash
cd ~/w/archivist-logseq && npx tsc --noEmit
```

Or if the plugin has a different build check:

```bash
cd ~/w/archivist-logseq && npm run build
```

- [ ] **Step 6: Commit**

```bash
cd ~/w/archivist-logseq && git add src/inquiry/protocol.ts src/inquiry/SidecarClient.ts src/inquiry/InquiryPanel.ts src/index.ts
git commit -m "feat: add archivist settings bridge from plugin to sidecar"
```

---

### Task 12: Update system prompts (Obsidian -> Logseq)

**Files:**
- Modify: `sidecar/src/core/prompts/mainAgent.ts`
- Modify: `sidecar/src/core/prompts/dndContext.ts`

- [ ] **Step 1: Update mainAgent.ts — identity and platform references**

In `sidecar/src/core/prompts/mainAgent.ts`:

Line 97 — change identity:
```
"You are **Claudian**, an expert AI assistant specialized in Obsidian vault management, knowledge organization, and code analysis. You operate directly inside the user's Obsidian vault."
```
to:
```
"You are **Claudian**, an expert AI assistant specialized in Logseq graph management, knowledge organization, and code analysis. You operate directly inside the user's Logseq graph."
```

Line 99 — change core principle:
```
"1.  **Obsidian Native**: You understand Markdown, YAML frontmatter, Wiki-links, and the \"second brain\" philosophy."
```
to:
```
"1.  **Logseq Native**: You understand Markdown, block-based outlining, page properties, block references, and the \"second brain\" philosophy."
```

Line 101 — change safety principle:
```
"2.  **Safety First**: You never overwrite data without understanding context. You always use relative paths."
```
(keep as-is — this is platform-agnostic)

- [ ] **Step 2: Update mainAgent.ts — Obsidian Context section**

Replace the "Obsidian Context" section (lines 135-155) to describe Logseq concepts:

Change:
```
## Obsidian Context

- **Structure**: Files are Markdown (.md). Folders organize content.
- **Frontmatter**: YAML at the top of files (metadata). Respect existing fields.
- **Links**: Internal Wiki-links \`[[note-name]]\` or \`[[folder/note-name]]\`. External links \`[text](url)\`.
  - When reading a note with wikilinks, consider reading linked notes—they often contain related context that helps understand the current note.
- **Tags**: #tag-name for categorization.
- **Dataview**: You may encounter Dataview queries (in \`\`\`dataview\`\`\` blocks). Do not break them unless asked.
- **Vault Config**: \`.obsidian/\` contains internal config. Touch only if you know what you are doing.
```

to:
```
## Logseq Context

- **Structure**: Pages are Markdown (.md) files in the graph directory. Content is block-based (outliner).
- **Page Properties**: Key-value pairs at the top of pages (e.g., `type:: book`, `tags:: fiction`). Respect existing properties.
- **Links**: Internal page links `[[page-name]]`. Block references `((block-uuid))`. External links `[text](url)`.
  - When reading a page with links, consider reading linked pages—they often contain related context.
- **Tags**: #tag-name for categorization. Tags are also pages in Logseq.
- **Queries**: You may encounter advanced queries (in ` ```query ` blocks) or simple queries (` {{query ...}} `). Do not break them unless asked.
- **Graph Config**: `logseq/` directory contains internal config. Touch only if you know what you are doing.
```

- [ ] **Step 3: Update mainAgent.ts — file references in responses**

Replace the "File References in Responses" section (lines 146-155):

Change wikilink references to Logseq format. The `[[page-name]]` syntax is the same in Logseq, but remove the folder path examples since Logseq uses flat page names:

```
**File References in Responses:**
When mentioning pages in your responses, use page link format so users can click to open them:
- ✓ Use: \`[[page name]]\`
- ✗ Avoid: plain paths like \`pages/page-name.md\` (not clickable in Logseq)

**Image embeds:** Use \`![alt](../assets/image.png)\` to reference images. Logseq stores assets in the \`assets/\` directory.
```

- [ ] **Step 4: Update dndContext.ts — vault references**

In `sidecar/src/core/prompts/dndContext.ts`, replace "vault" with "graph" where it refers to the user's content store. Specifically:

Line 22: `"Your file operations are limited to: ${ctx.ttrpgRootDir}"` — keep as-is (path-based, not vault-specific)

Line 23: Change `"Documents in this directory are the PRIMARY source of truth for this campaign."` — keep as-is

Line 24: Change `"Always search within this directory first before using your training knowledge."` — keep as-is

Line 25: Change `"Do not read or modify files outside this directory."` — keep as-is

Line 32: Change `"For vault search: use your built-in Grep, Glob, Read tools within ${ctx.ttrpgRootDir}"` to `"For graph search: use your built-in Grep, Glob, Read tools within ${ctx.ttrpgRootDir}"`

Line 36: Change `"For creating notes: use your built-in Write tool within ${ctx.ttrpgRootDir}"` — keep as-is

Line 43: Change `"Include wiki-links ([[Note Name]]) to existing vault notes when relevant."` to `"Include page links ([[Page Name]]) to existing graph pages when relevant."`

Line 85: Change `"If asked about something in the campaign, search the vault first."` to `"If asked about something in the campaign, search the graph first."`

- [ ] **Step 5: Verify compilation**

```bash
cd ~/w/archivist-logseq/sidecar && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd ~/w/archivist-logseq && git add sidecar/src/core/prompts/mainAgent.ts sidecar/src/core/prompts/dndContext.ts
git commit -m "feat: update system prompts from Obsidian to Logseq terminology"
```

---

### Task 13: Full build and verification

**Files:** None (verification only)

- [ ] **Step 1: Clean build the sidecar**

```bash
cd ~/w/archivist-logseq/sidecar && rm -rf dist && npm run build
```

Expected: no errors. The `dist/` directory should contain compiled JS files AND `dist/ai/srd/data/*.json` (from the cp step in the build script).

- [ ] **Step 2: Verify JSON data was copied**

```bash
ls ~/w/archivist-logseq/sidecar/dist/ai/srd/data/
```

Expected: 9 JSON files.

- [ ] **Step 3: Verify the MCP server module exports**

```bash
node -e "import('./dist/ai/mcp-server.js').then(m => console.log('MCP server module loaded, exports:', Object.keys(m)))"
```

Run from `sidecar/` directory. Expected: `MCP server module loaded, exports: [ 'createArchivistMcpServer' ]`

- [ ] **Step 4: Build the plugin side**

```bash
cd ~/w/archivist-logseq && npm run build
```

Expected: no errors.

- [ ] **Step 5: Commit (if any build fixes were needed)**

```bash
cd ~/w/archivist-logseq && git add -A && git commit -m "fix: build fixes for AI agent port"
```

Only if Step 1-4 revealed issues that needed fixing.

---

### Task 14: End-to-end smoke test

- [ ] **Step 1: Start the sidecar**

```bash
cd ~/w/archivist-logseq/sidecar && node dist/cli.js --graph-root ~/path/to/logseq/graph
```

Expected: server starts without errors, SRD data loads.

- [ ] **Step 2: Test in Logseq**

Open Logseq, open the Archivist chat panel:

1. Ask "generate a goblin" — should see `mcp__archivist__generate_monster` tool call
2. Ask about campaign content that exists in the graph — should see the AI search files first (Grep/Glob/Read)
3. Ask "search srd for fireball" — should see `mcp__archivist__search_srd` tool call

- [ ] **Step 3: Final commit if all tests pass**

```bash
cd ~/w/archivist-logseq && git add -A && git commit -m "feat: complete AI agent D&D tools and note search"
```
