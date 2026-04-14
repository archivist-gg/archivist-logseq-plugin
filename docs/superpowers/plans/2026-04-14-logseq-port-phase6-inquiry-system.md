# Phase 6: AI / Inquiry System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the entire Claudian AI chat engine from the Obsidian plugin to Logseq, using a sidecar Node.js server for the Claude Agent SDK and a browser-based UI injected into Logseq's host document.

**Architecture:** Two-process split -- a "fat sidecar" Node.js server runs the full `core/` backend (Claude SDK, storage, security, MCP, prompts) copied from the Obsidian plugin with 5 files adapted. The Logseq plugin is a thin UI client that injects a chat sidebar into the host document and communicates with the sidecar over WebSocket + HTTP.

**Tech Stack:** TypeScript, Express, ws (WebSocket), @anthropic-ai/claude-agent-sdk, markdown-it, highlight.js (lazy), Lucide icons (inline SVG), Logseq Plugin SDK (@logseq/libs)

**Source:** Obsidian inquiry code at `~/w/archivist-obsidian/src/inquiry/`
**Target:** Logseq plugin at `~/w/archivist-logseq/`
**Spec:** `docs/superpowers/specs/2026-04-14-logseq-port-phase6-inquiry-system-design.md`

---

## Task 1: Sidecar Project Scaffolding

**Files:**
- Create: `sidecar/package.json`
- Create: `sidecar/tsconfig.json`
- Create: `sidecar/.gitignore`

- [ ] **Step 1: Create sidecar directory**

```bash
mkdir -p sidecar/src/{ws,adapter,core}
```

- [ ] **Step 2: Create package.json**

Create `sidecar/package.json`:

```json
{
  "name": "archivist-sidecar",
  "version": "0.1.0",
  "description": "Archivist TTRPG Blocks sidecar server for Logseq plugin",
  "main": "dist/cli.js",
  "bin": {
    "archivist": "dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "start": "node dist/cli.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.1.0",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "express": "^4.21.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/ws": "^8.5.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 3: Create tsconfig.json**

Create `sidecar/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "strictNullChecks": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Create .gitignore**

Create `sidecar/.gitignore`:

```
node_modules/
dist/
```

- [ ] **Step 5: Install dependencies**

```bash
cd sidecar && npm install
```

- [ ] **Step 6: Verify setup**

```bash
cd sidecar && npx tsc --noEmit
```

Expected: No errors (empty project compiles).

- [ ] **Step 7: Commit**

```bash
git add sidecar/package.json sidecar/tsconfig.json sidecar/.gitignore sidecar/package-lock.json
git commit -m "chore: scaffold sidecar project for Phase 6 inquiry system"
```

---

## Task 2: WebSocket Protocol Types

**Files:**
- Create: `sidecar/src/ws/protocol.ts`
- Create: `src/inquiry/protocol.ts` (plugin-side copy)

These are the shared message types for sidecar-plugin communication. Defined once, copied to both sides (no shared package to avoid build complexity).

- [ ] **Step 1: Create protocol types**

Create `sidecar/src/ws/protocol.ts` with all client-to-server and server-to-client message interfaces. This includes:

**Client -> Server types:** `QueryMessage`, `InterruptMessage`, `ApproveMessage`, `DenyMessage`, `AllowAlwaysMessage`, `SessionListMessage`, `SessionResumeMessage`, `SessionForkMessage`, `SessionRewindMessage`, `SettingsGetMessage`, `SettingsUpdateMessage`, `McpListMessage`, `McpUpdateMessage`, `CommandListMessage`, `PlanApproveMessage`, `AskUserAnswerMessage`, `AskUserDismissMessage`, plus union type `ClientMessage`.

**Server -> Client types:** `StreamTextMessage`, `StreamThinkingMessage`, `StreamToolUseMessage`, `StreamToolResultMessage`, `StreamDoneMessage`, `StreamErrorMessage`, `StreamUsageMessage`, `StreamSubagentMessage`, `StreamCompactBoundaryMessage`, `StreamSdkUserUuidMessage`, `StreamSdkUserSentMessage`, `StreamSdkAssistantUuidMessage`, `StreamContextWindowMessage`, `ApprovalRequestMessage`, `PlanModeRequestMessage`, `AskUserQuestionMessage`, `SessionLoadedMessage`, `SessionListResultMessage`, `SettingsCurrentMessage`, `CommandListResultMessage`, `NotificationMessage`, `ConnectionReadyMessage`, plus union type `ServerMessage`.

Each message has a `type` discriminant field and typed payload fields matching the spec's WebSocket protocol table.

- [ ] **Step 2: Copy to plugin side**

Copy `sidecar/src/ws/protocol.ts` to `src/inquiry/protocol.ts` (identical file).

- [ ] **Step 3: Build to verify types compile**

```bash
cd sidecar && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add sidecar/src/ws/protocol.ts src/inquiry/protocol.ts
git commit -m "feat: define WebSocket protocol types for sidecar communication"
```

---

## Task 3: Sidecar Adapters

**Files:**
- Create: `sidecar/src/adapter/NodeFileAdapter.ts`
- Create: `sidecar/src/adapter/NotificationEmitter.ts`
- Create: `sidecar/src/adapter/index.ts`
- Test: `sidecar/tests/adapter/NodeFileAdapter.test.ts`

These replace the two Obsidian abstractions: `VaultFileAdapter` (Obsidian Vault API -> Node `fs`) and `Notice` (toast notifications -> event emitter over WebSocket).

- [ ] **Step 1: Write NodeFileAdapter test**

Create `sidecar/tests/adapter/NodeFileAdapter.test.ts` with tests for: write+read, exists check, append, delete, listFiles, listFolders, ensureFolder (nested), rename, stat, and stat-returns-null-for-missing.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd sidecar && npx vitest run tests/adapter/NodeFileAdapter.test.ts
```

Expected: FAIL -- `NodeFileAdapter` not found.

- [ ] **Step 3: Implement NodeFileAdapter**

Create `sidecar/src/adapter/NodeFileAdapter.ts` implementing the same interface as Obsidian's `VaultFileAdapter`:
- `exists(path)`, `read(path)`, `write(path, content)`, `append(path, content)` (with serialized writeQueue), `delete(path)`, `deleteFolder(path)`, `listFiles(folder)`, `listFolders(folder)`, `listFilesRecursive(folder)`, `ensureFolder(path)`, `rename(old, new)`, `stat(path)` returning `{ mtime, size } | null`.
- All paths relative to a root directory passed in the constructor.
- Uses Node `fs/promises` and `path`.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd sidecar && npx vitest run tests/adapter/NodeFileAdapter.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Create NotificationEmitter**

Create `sidecar/src/adapter/NotificationEmitter.ts`:
- Event emitter pattern with `onNotification(listener)` returning unsubscribe function
- `notify(message, type)`, `notice(message)`, `warn(message)`, `error(message)` methods
- Emits `NotificationMessage` from the protocol types

- [ ] **Step 6: Create barrel export**

Create `sidecar/src/adapter/index.ts` exporting both classes.

- [ ] **Step 7: Build to verify**

```bash
cd sidecar && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add sidecar/src/adapter/ sidecar/tests/
git commit -m "feat: add NodeFileAdapter and NotificationEmitter sidecar adapters"
```

---

## Task 4: Copy Core Backend to Sidecar

**Files:**
- Copy: `sidecar/src/core/` (55 files from `~/w/archivist-obsidian/src/inquiry/core/`)
- Copy: `sidecar/src/core/i18n/` (from `~/w/archivist-obsidian/src/inquiry/i18n/`)
- Copy: `sidecar/src/core/utils/` (from `~/w/archivist-obsidian/src/inquiry/utils/`)
- Adapt: 5 files (ClaudianService, StorageService, VaultFileAdapter, SecurityHooks, PluginManager)

This is the bulk copy of the Obsidian inquiry backend. 50 files copy verbatim, 5 files get mechanical adaptations.

- [ ] **Step 1: Copy all core/ directories verbatim**

```bash
cp -r ~/w/archivist-obsidian/src/inquiry/core/ sidecar/src/core/
cp -r ~/w/archivist-obsidian/src/inquiry/i18n/ sidecar/src/core/i18n/
cp -r ~/w/archivist-obsidian/src/inquiry/utils/ sidecar/src/core/utils/
```

- [ ] **Step 2: Adapt VaultFileAdapter -> NodeFileAdapter**

Replace `sidecar/src/core/storage/VaultFileAdapter.ts` with a re-export:

```typescript
export { NodeFileAdapter as VaultFileAdapter } from '../../adapter/NodeFileAdapter.js';
```

This means all storage sub-modules that import `VaultFileAdapter` get `NodeFileAdapter` without any changes to their import statements.

- [ ] **Step 3: Adapt StorageService.ts**

In `sidecar/src/core/storage/StorageService.ts`:

1. Remove `import type { App, Plugin } from 'obsidian'` and `import { Notice } from 'obsidian'`
2. Add imports for `NodeFileAdapter` and `NotificationEmitter`
3. Change constructor from `constructor(plugin: Plugin)` to `constructor(graphRoot: string, notifications: NotificationEmitter)`
4. Replace `new VaultFileAdapter(this.plugin.app)` with `new NodeFileAdapter(graphRoot)`
5. Replace `new Notice(...)` with `notifications.warn(...)`
6. Replace `this.plugin.loadData()` / `this.plugin.saveData(data)` with reading/writing `<graphRoot>/.archivist/plugin-data.json`
7. Update `CLAUDE_PATH` from `'.claude'` to `'.archivist'`

- [ ] **Step 4: Adapt ClaudianService.ts**

In `sidecar/src/core/agent/ClaudianService.ts`:

1. Remove `import { Notice } from 'obsidian'`
2. Add import for `NotificationEmitter`
3. Replace constructor parameter `plugin: InquiryModule` with a config interface containing: `vaultPath`, `notifications`, `getSettings()`, `getResolvedClaudeCliPath()`, `getActiveEnvironmentVariables()`, `getStorageService()`
4. Replace all 4 `new Notice(msg)` calls with `this.config.notifications.warn(msg)`
5. Replace `this.plugin.settings` with `this.config.getSettings()`
6. Replace `this.plugin.app.vault.adapter.basePath` with `this.config.vaultPath`

- [ ] **Step 5: Adapt SecurityHooks.ts**

In `sidecar/src/core/hooks/SecurityHooks.ts`:

1. Remove `import { Notice } from 'obsidian'`
2. Add `onBlocked?: (message: string) => void` to `BlocklistContext` interface
3. Replace `new Notice('Command blocked by security policy')` with `context.onBlocked?.('Command blocked by security policy')`

- [ ] **Step 6: Adapt PluginManager.ts**

In `sidecar/src/core/plugins/PluginManager.ts`:

1. Remove `import { Notice } from 'obsidian'`
2. Replace `new Notice(msg)` with `console.warn(msg)` (1 occurrence)

- [ ] **Step 7: Copy and adapt Obsidian inquiry tests**

```bash
cp -r ~/w/archivist-obsidian/tests/inquiry/unit/core/ sidecar/tests/core/
```

Adapt test imports to match new paths. Fix mocks that reference Obsidian APIs.

- [ ] **Step 8: Build to verify all adaptations compile**

```bash
cd sidecar && npx tsc --noEmit
```

Iterate until zero errors. Common fixes: relative import paths, `.js` extensions for NodeNext, stubbing removed `InquiryModule` type.

- [ ] **Step 9: Run tests**

```bash
cd sidecar && npx vitest run
```

Fix failures from adaptation. Pure logic tests (tools, types, security, agents) should pass as-is.

- [ ] **Step 10: Commit**

```bash
git add sidecar/src/core/ sidecar/tests/
git commit -m "feat: copy and adapt Obsidian inquiry core/ backend for sidecar"
```

---

## Task 5: Sidecar Express + WebSocket Server

**Files:**
- Create: `sidecar/src/server.ts`
- Create: `sidecar/src/ws/handler.ts`
- Create: `sidecar/src/cli.ts`
- Create: `sidecar/src/services.ts`
- Test: `sidecar/tests/server.test.ts`

- [ ] **Step 1: Write server health endpoint test**

Create `sidecar/tests/server.test.ts` testing: health check returns `{ service: "archivist", graphRoot }`.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd sidecar && npx vitest run tests/server.test.ts
```

Expected: FAIL -- `createServer` not found.

- [ ] **Step 3: Implement server.ts**

Create `sidecar/src/server.ts` with:
- Express app with JSON middleware
- Health, settings, sessions, MCP, commands HTTP endpoints
- WebSocketServer on the same HTTP server
- Client tracking (Set of connected WebSocket clients)
- `broadcast(message)` utility

- [ ] **Step 4: Create WebSocket handler**

Create `sidecar/src/ws/handler.ts`:
- Sends `connection.ready` message on connect
- Parses incoming `ClientMessage` JSON
- Routes by `message.type` to appropriate handler
- Stub implementations for each message type (will be wired to core services in Step 7)

- [ ] **Step 5: Create services coordinator**

Create `sidecar/src/services.ts`:
- `initializeServices(graphRoot)` function that creates `NotificationEmitter`, `StorageService`, `ClaudianService`, `McpServerManager`
- Returns a `SidecarServices` interface consumed by the handler

- [ ] **Step 6: Create CLI entry point**

Create `sidecar/src/cli.ts`:
- Parse `--graph` and `--port` args
- Create `.archivist/` directory
- Call `createServer()`
- Write `server.json` discovery file
- Handle `SIGINT`/`SIGTERM` gracefully (remove discovery file, close server)

- [ ] **Step 7: Wire handler to core services**

Update `sidecar/src/ws/handler.ts`:
- `query` handler calls `services.claudian.query()`, iterates the AsyncGenerator, maps each `StreamChunk` to a `ServerMessage`, sends over WebSocket
- `interrupt` calls `services.claudian.cancel()`
- `session.list` calls `services.storage.sessions.listSessions()`
- `settings.get` returns from `services.storage`
- `approve`/`deny`/`allow_always` resolve pending approval callbacks set up by ClaudianService

- [ ] **Step 8: Run server test**

```bash
cd sidecar && npx vitest run tests/server.test.ts
```

Expected: PASS.

- [ ] **Step 9: Manual smoke test**

```bash
cd sidecar && npx tsc && node dist/cli.js --graph /tmp/test-graph
```

Expected: Server starts, prints port, creates `/tmp/test-graph/.archivist/server.json`. Ctrl+C stops cleanly and removes discovery file.

- [ ] **Step 10: Commit**

```bash
git add sidecar/src/server.ts sidecar/src/ws/handler.ts sidecar/src/cli.ts sidecar/src/services.ts sidecar/tests/server.test.ts
git commit -m "feat: implement sidecar server with CLI, WebSocket handler, and core service wiring"
```

---

## Task 6: Plugin i18n, Icons, and CSS Foundation

**Files:**
- Create: `src/inquiry/i18n/` (copy from Obsidian)
- Create: `src/inquiry/shared/icons.ts`
- Create: `src/styles/archivist-inquiry.css`

- [ ] **Step 1: Copy i18n directory verbatim**

```bash
cp -r ~/w/archivist-obsidian/src/inquiry/i18n/ src/inquiry/i18n/
```

- [ ] **Step 2: Create Lucide icon helper**

Create `src/inquiry/shared/icons.ts` with:
- `ICONS` record mapping icon names to SVG strings for all icons used by the inquiry UI (~20 icons: bot, send, square, plus, x, chevron-down, chevron-right, copy, check, settings, history, file-text, image, terminal, shield, brain, git-branch, rotate-ccw, loader)
- `setIcon(el, iconName)` function that sets element content to the SVG (using safe DOM methods -- set via `el.textContent` for unknown icons, or create SVG element via DOMParser for known icons)
- `createIconEl(doc, iconName, className?)` factory

- [ ] **Step 3: Create initial inquiry CSS**

Create `src/styles/archivist-inquiry.css` with ~200 lines covering sidebar positioning, header, messages area, input area, connection states, and toast notifications. Uses Logseq CSS variables per the spec's mapping table.

- [ ] **Step 4: Build to verify**

```bash
npm run build
```

Expected: Compiles.

- [ ] **Step 5: Commit**

```bash
git add src/inquiry/i18n/ src/inquiry/shared/icons.ts src/styles/archivist-inquiry.css
git commit -m "feat: add i18n, Lucide icons, and base inquiry CSS"
```

---

## Task 7: Plugin SidecarClient

**Files:**
- Create: `src/inquiry/SidecarClient.ts`
- Test: `tests/inquiry/SidecarClient.test.ts`

- [ ] **Step 1: Write SidecarClient test**

Create `tests/inquiry/SidecarClient.test.ts` with tests using a MockWebSocket: sends query message, sends interrupt, routes stream chunks to listener, detects connection ready.

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/inquiry/SidecarClient.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement SidecarClient**

Create `src/inquiry/SidecarClient.ts` with:
- Connection state machine: `disconnected` -> `connecting` -> `connected` -> `reconnecting`
- `discover(fixedPort?)` -- scans ports 52340-52360 checking `/health`, or connects to fixed port
- `onStreamChunk(listener)`, `onStateChange(listener)`, `onReady(listener)` -- event subscription with unsubscribe returns
- `send*(...)` methods for all `ClientMessage` types
- `fetch*(...)` methods for HTTP endpoints (settings, sessions, commands)
- Auto-reconnect with exponential backoff (1s, 2s, 4s, max 30s)
- `disconnect()` cleanup

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/inquiry/SidecarClient.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/inquiry/SidecarClient.ts src/inquiry/protocol.ts tests/inquiry/
git commit -m "feat: implement SidecarClient with WebSocket + HTTP communication"
```

---

## Task 8: Plugin InquiryPanel -- DOM Injection Shell

**Files:**
- Create: `src/inquiry/InquiryPanel.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Create InquiryPanel**

Create `src/inquiry/InquiryPanel.ts`:
- Injects CSS `<style>` element into host document head
- Creates `#archivist-inquiry-panel` div in host document's app-container
- Renders header (title, close button), connection indicator, messages placeholder, input placeholder
- Injects toolbar toggle button into Logseq's header area
- `toggle()` method adds/removes `is-open` class and `archivist-inquiry-open` on body
- `init()` creates `SidecarClient`, subscribes to state changes, calls `discover()`
- `onSidecarReady()` stub for ChatView initialization (wired in Task 16)

- [ ] **Step 2: Wire into index.ts**

Add to `src/index.ts` after Phase 5 init:
- Import and instantiate `InquiryPanel`
- Register command palette: "Toggle Claudian" with `mod+shift+i` keybinding
- Register command palette: "Claudian: New Session"
- Add `sidecarPort` to settings schema (type: number, default: 0)

- [ ] **Step 3: Build and verify**

```bash
npm run build
```

Deploy to Logseq, press `Cmd+Shift+I`, verify panel slides in from right.

- [ ] **Step 4: Commit**

```bash
git add src/inquiry/InquiryPanel.ts src/index.ts
git commit -m "feat: inject inquiry chat sidebar panel into Logseq host document"
```

---

## Task 9: Plugin ChatState and State Types

**Files:**
- Create: `src/inquiry/state/ChatState.ts`
- Create: `src/inquiry/state/types.ts`
- Create: `src/inquiry/state/index.ts`

- [ ] **Step 1: Copy and adapt state types**

Copy `~/w/archivist-obsidian/src/inquiry/features/chat/state/types.ts` to `src/inquiry/state/types.ts`. Remove CM6 fields (`editorView`, `domRanges`) from `StoredSelection`. Remove any `obsidian` imports.

- [ ] **Step 2: Copy ChatState**

Copy `~/w/archivist-obsidian/src/inquiry/features/chat/state/ChatState.ts`. Update relative import paths.

- [ ] **Step 3: Create barrel and build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/inquiry/state/
git commit -m "feat: port ChatState and state types from Obsidian"
```

---

## Task 10: Plugin Markdown Wrapper

**Files:**
- Create: `src/inquiry/rendering/markdown.ts`

- [ ] **Step 1: Install markdown-it**

```bash
npm install markdown-it && npm install -D @types/markdown-it
```

- [ ] **Step 2: Create markdown wrapper**

Create `src/inquiry/rendering/markdown.ts` with:
- Configured `markdown-it` instance (html: false, linkify: true)
- Custom fence rule for D&D code fences (`monster`, `spell`, `item`) -- wraps in `<div class="archivist-dnd-fence" data-lang="...">` for post-processing by DndEntityRenderer
- Custom core rule for `[[wikilink]]` rendering as clickable page links with `data-page` attribute
- `renderMarkdown(source)` returning HTML string
- `renderMarkdownToEl(doc, el, source)` rendering into DOM element and wiring page link click handlers via `logseq.App.pushState`

- [ ] **Step 3: Build to verify**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/inquiry/rendering/markdown.ts package.json package-lock.json
git commit -m "feat: add markdown-it wrapper with D&D fence and wikilink support"
```

---

## Task 11: Plugin Rendering Layer

**Files:**
- Create: `src/inquiry/rendering/MessageRenderer.ts`
- Create: `src/inquiry/rendering/ToolCallRenderer.ts`
- Create: `src/inquiry/rendering/ThinkingBlockRenderer.ts`
- Create: `src/inquiry/rendering/DiffRenderer.ts`
- Create: `src/inquiry/rendering/WriteEditRenderer.ts`
- Create: `src/inquiry/rendering/TodoListRenderer.ts`
- Create: `src/inquiry/rendering/SubagentRenderer.ts`
- Create: `src/inquiry/rendering/DndEntityRenderer.ts`
- Create: `src/inquiry/rendering/InlineExitPlanMode.ts`
- Create: `src/inquiry/rendering/InlineAskUserQuestion.ts`
- Create: `src/inquiry/rendering/dndCodeFence.ts`
- Create: `src/inquiry/rendering/collapsible.ts`
- Create: `src/inquiry/rendering/index.ts`

Port all renderers from Obsidian's `features/chat/rendering/`. Consistent changes across all files:
- Replace `import { setIcon } from 'obsidian'` with `import { setIcon } from '../shared/icons'`
- Replace `MarkdownRenderer.render(...)` with `renderMarkdownToEl(...)`
- Replace `containerEl.createDiv()` / `createEl()` with `doc.createElement()` + `appendChild()`
- Replace `Component` lifecycle with manual cleanup arrays

- [ ] **Step 1: Port utility files (copy verbatim)**

`collapsible.ts`, `dndCodeFence.ts` -- pure DOM/parsing, no Obsidian deps.

- [ ] **Step 2: Port sub-renderers (in dependency order)**

1. `DiffRenderer.ts` (~220 lines) -- pure diff rendering
2. `ThinkingBlockRenderer.ts` (~180 lines) -- uses collapsible
3. `TodoListRenderer.ts` (~280 lines) -- uses setIcon
4. `ToolCallRenderer.ts` (~780 lines) -- uses setIcon, DiffRenderer
5. `WriteEditRenderer.ts` (~540 lines) -- uses DiffRenderer
6. `SubagentRenderer.ts` (~255 lines) -- uses setIcon
7. `DndEntityRenderer.ts` (~290 lines) -- uses existing parsers/renderers from archivist-logseq
8. `InlineExitPlanMode.ts` (~150 lines) -- plan mode approval card, WebSocket-based approval
9. `InlineAskUserQuestion.ts` (~160 lines) -- ask user card, WebSocket-based response

- [ ] **Step 3: Port MessageRenderer**

The orchestrator (~825 lines). Key changes: remove `plugin: InquiryModule` and `component: Component` params, add `doc: Document` and `client: SidecarClient`. Replace `MarkdownRenderer.render()` with `renderMarkdownToEl()`. All sub-renderer instantiation uses adapted versions.

- [ ] **Step 4: Create barrel export and build**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/inquiry/rendering/
git commit -m "feat: port all chat rendering components from Obsidian"
```

---

## Task 12: Plugin Controllers

**Files:**
- Create: `src/inquiry/controllers/StreamController.ts`
- Create: `src/inquiry/controllers/InputController.ts`
- Create: `src/inquiry/controllers/ConversationController.ts`
- Create: `src/inquiry/controllers/SelectionController.ts`
- Create: `src/inquiry/controllers/NavigationController.ts`
- Create: `src/inquiry/controllers/index.ts`

Key change across all controllers: communicate via `SidecarClient` WebSocket instead of calling `ClaudianService` directly.

- [ ] **Step 1: Port StreamController**

`handleStreamChunk()` receives `ServerMessage` from WebSocket instead of `StreamChunk`. Map server message types to the same rendering logic. Remove `plugin: InquiryModule` from deps, add `client: SidecarClient` and `doc: Document`.

- [ ] **Step 2: Port InputController**

Replace `ClaudianService.query()` with `client.sendQuery()`. Replace `service.cancel()` with `client.sendInterrupt()`. Approval flow becomes WebSocket-based. Remove `BrowserSelectionController` and `CanvasSelectionController` deps.

- [ ] **Step 3: Port ConversationController**

Session operations become `client.sendSessionList()`, `client.sendSessionResume()`, etc. Session loaded responses come via `session.loaded` WebSocket messages.

- [ ] **Step 4: Port SelectionController**

Remove all CodeMirror 6 / EditorView references. Use `hostDoc.defaultView.getSelection()` to capture selected text. Poll every 250ms.

- [ ] **Step 5: Port NavigationController**

Replace Obsidian `Scope` with `addEventListener('keydown', ...)` on panel element. Same vim-style j/k/i logic.

- [ ] **Step 6: Create barrel and build**

```bash
npm run build
```

- [ ] **Step 7: Commit**

```bash
git add src/inquiry/controllers/
git commit -m "feat: port chat controllers with sidecar WebSocket communication"
```

---

## Task 13: Plugin UI Components

**Files:**
- Create: `src/inquiry/ui/ChatView.ts`
- Create: `src/inquiry/ui/TabBar.ts`
- Create: `src/inquiry/ui/RichInput.ts`
- Create: `src/inquiry/ui/InputToolbar.ts`
- Create: `src/inquiry/ui/FileContext.ts`
- Create: `src/inquiry/ui/ImageContext.ts`
- Create: `src/inquiry/ui/StatusPanel.ts`
- Create: `src/inquiry/ui/InstructionMode.ts`
- Create: `src/inquiry/ui/BangBashMode.ts`
- Create: `src/inquiry/ui/SettingsPanel.ts`
- Create: `src/inquiry/ui/index.ts`

- [ ] **Step 1: Port RichInput**

Pure DOM (contentEditable). Replace `setIcon` import. Includes `SendButton` class.

- [ ] **Step 2: Port InputToolbar**

Settings reads from sidecar via `client.fetchSettings()`. Model/effort changes via `client.sendSettingsUpdate()`.

- [ ] **Step 3: Port FileContext and ImageContext**

FileContext: file resolution through sidecar, remove `TFile`/`Vault` refs. ImageContext: paste/drop handlers are pure DOM, copy nearly verbatim.

- [ ] **Step 4: Port TabBar**

Remove `WorkspaceLeaf` refs. Tab state managed by plugin-side `ChatState` instances. Drag/context menu are pure DOM.

- [ ] **Step 5: Create ChatView (rewrite)**

New ~400-600 line file replacing `ClaudianView.ts`. Orchestrates all UI components within the injected sidebar. Creates messages container, input area, toolbar, tab bar. Instantiates controllers and UI components. Wires WebSocket message routing to StreamController. Manages tab lifecycle.

- [ ] **Step 6: Port StatusPanel, InstructionMode, BangBashMode**

Minor setIcon changes. BangBash executes via sidecar, not locally.

- [ ] **Step 7: Create SettingsPanel (rewrite)**

Custom DOM settings panel replacing Obsidian's `PluginSettingTab`. Sections for model, thinking, permissions, env vars, MCP, blocked commands, locale. Reads/writes via `client.sendSettingsGet()` / `client.sendSettingsUpdate()`.

- [ ] **Step 8: Build to verify**

```bash
npm run build
```

- [ ] **Step 9: Commit**

```bash
git add src/inquiry/ui/
git commit -m "feat: port chat UI components (RichInput, InputToolbar, TabBar, ChatView, Settings)"
```

---

## Task 14: Plugin Services and Shared Components

**Files:**
- Create: `src/inquiry/services/SubagentManager.ts`
- Create: `src/inquiry/services/TitleGenerationService.ts`
- Create: `src/inquiry/services/InlineEditService.ts`
- Create: `src/inquiry/services/index.ts`
- Create: `src/inquiry/shared/MentionDropdown.ts`
- Create: `src/inquiry/shared/SlashCommandDropdown.ts`
- Create: `src/inquiry/shared/EntityAutocomplete.ts`
- Create: `src/inquiry/shared/ResumeSessionDropdown.ts`
- Create: `src/inquiry/shared/modals.ts`
- Create: `src/inquiry/shared/index.ts`

- [ ] **Step 1: Port services**

SubagentManager tracks state from `stream.subagent` WebSocket messages. TitleGeneration sends request to sidecar. InlineEditService sends request to sidecar, receives diff result, shows overlay modal.

- [ ] **Step 2: Port shared components**

MentionDropdown (~713 lines pure DOM), SlashCommandDropdown (~427 lines), EntityAutocomplete (uses existing `EntityRegistry`), ResumeSessionDropdown. Create `modals.ts` with `showModal(doc, content, onClose)` utility replacing Obsidian `Modal`.

- [ ] **Step 3: Build and commit**

```bash
git add src/inquiry/services/ src/inquiry/shared/
git commit -m "feat: port services and shared components"
```

---

## Task 15: CSS Port from Obsidian

**Files:**
- Modify: `src/styles/archivist-inquiry.css`

- [ ] **Step 1: Copy and concatenate Obsidian CSS**

```bash
cat ~/w/archivist-obsidian/src/inquiry/style/base/*.css \
    ~/w/archivist-obsidian/src/inquiry/style/components/*.css \
    ~/w/archivist-obsidian/src/inquiry/style/features/*.css \
    ~/w/archivist-obsidian/src/inquiry/style/modals/*.css \
    ~/w/archivist-obsidian/src/inquiry/style/settings/*.css \
    ~/w/archivist-obsidian/src/inquiry/style/toolbar/*.css \
    > src/styles/archivist-inquiry.css
```

- [ ] **Step 2: Find-and-replace CSS variables**

Replace Obsidian variables with Logseq equivalents per spec: `--background-primary` -> `var(--ls-primary-background-color)`, `--text-normal` -> `var(--ls-primary-text-color)`, etc.

- [ ] **Step 3: Add sidebar panel styles**

Prepend the sidebar positioning CSS from spec Section 2. Add connection state and toast styles.

- [ ] **Step 4: Scope selectors**

Prefix selectors with `#archivist-inquiry-panel` or `.archivist-` to avoid Logseq collisions. Rename `.claudian-` prefixes to `.archivist-inquiry-`.

- [ ] **Step 5: Build, deploy, visual test**

```bash
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/styles/archivist-inquiry.css
git commit -m "feat: port inquiry CSS with Logseq theme variable mapping"
```

---

## Task 16: Full Integration Wiring

**Files:**
- Modify: `src/inquiry/InquiryPanel.ts`
- Modify: `src/index.ts`

Wire everything together: InquiryPanel creates ChatView on sidecar connect, ChatView creates controllers/renderers/UI, WebSocket messages flow through the full pipeline.

- [ ] **Step 1: Update InquiryPanel.onSidecarReady()**

Create `ChatView` with all controllers and UI components. Pass `doc`, `panelEl`, `client`, and `entityRegistry`.

- [ ] **Step 2: Update index.ts to pass EntityRegistry**

Pass the Phase 2 `EntityRegistry` instance to `InquiryPanel` so D&D stat blocks and entity autocomplete work in chat.

- [ ] **Step 3: Wire WebSocket message routing in ChatView**

Route `ServerMessage` types to appropriate controllers: stream messages to `StreamController`, approval/plan/askuser to `InputController`, session.loaded to `ConversationController`, notifications to toast renderer.

- [ ] **Step 4: Build and end-to-end test**

```bash
npm run build
```

1. Start sidecar: `cd sidecar && node dist/cli.js --graph /path/to/graph`
2. Open Logseq, `Cmd+Shift+I`
3. Verify: connected indicator, send message, streaming response, tool calls render, thinking blocks collapsible, D&D stat blocks, multi-tab, session resume

- [ ] **Step 5: Commit**

```bash
git add src/inquiry/ src/index.ts
git commit -m "feat: wire full inquiry pipeline -- panel to sidecar end-to-end"
```

---

## Task 17: Tests

**Files:**
- Create: `tests/inquiry/SidecarClient.integration.test.ts`
- Copy: selected core tests to sidecar (if not done in Task 4)

- [ ] **Step 1: SidecarClient integration test**

Test with mock WebSocket server: discovery, message round trip, reconnection.

- [ ] **Step 2: Run all tests**

```bash
npx vitest run
cd sidecar && npx vitest run
```

- [ ] **Step 3: Commit**

```bash
git add tests/inquiry/
git commit -m "test: add inquiry system tests"
```

---

## Task 18: Build, Deploy, and Smoke Test

**Files:**
- Modify: `package.json` (add build:sidecar script)

- [ ] **Step 1: Add convenience build scripts**

```json
"build:sidecar": "cd sidecar && npm run build",
"build:all": "npm run build && npm run build:sidecar"
```

- [ ] **Step 2: Full build and tests**

```bash
npm run build:all && npx vitest run && cd sidecar && npx vitest run
```

- [ ] **Step 3: End-to-end smoke test**

1. Start sidecar, deploy plugin to Logseq
2. Verify: toggle panel, connected state, send message, streaming, tool calls, thinking, D&D blocks, tabs, session resume, settings, disconnect/reconnect
3. Stop sidecar -> "Reconnecting" -> restart -> auto-reconnect

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: Phase 6 complete -- AI/Inquiry system with sidecar server"
```

---

## Task Summary

| Task | Description | Est. Files | Type |
|------|-------------|-----------|------|
| 1 | Sidecar project scaffolding | 3 | New |
| 2 | WebSocket protocol types | 2 | New |
| 3 | Sidecar adapters (NodeFileAdapter, NotificationEmitter) | 4 | New + Test |
| 4 | Copy + adapt core/ backend | ~60 | Copy + Adapt |
| 5 | Sidecar server + CLI + handler + services | 5 | New + Test |
| 6 | Plugin i18n, icons, CSS foundation | ~15 | Copy + New |
| 7 | Plugin SidecarClient | 2 | New + Test |
| 8 | Plugin InquiryPanel (DOM injection) | 2 | New |
| 9 | Plugin ChatState + state types | 3 | Copy |
| 10 | Plugin markdown wrapper | 1 | New |
| 11 | Plugin rendering layer (all renderers) | ~14 | Port |
| 12 | Plugin controllers | 6 | Port |
| 13 | Plugin UI components | ~11 | Port + Rewrite |
| 14 | Plugin services + shared | ~11 | Port |
| 15 | CSS port from Obsidian | 1 | Port |
| 16 | Full integration wiring | 2 | Integration |
| 17 | Tests | ~3 | Test |
| 18 | Build, deploy, smoke test | 1 | Integration |
