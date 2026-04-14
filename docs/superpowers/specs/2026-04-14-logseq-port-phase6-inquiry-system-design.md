# Archivist TTRPG Blocks -- Logseq Port: Phase 6 Inquiry (Claudian) AI Chat System

**Date:** 2026-04-14
**Status:** Spec -- awaiting user review, then implementation plan
**Scope:** Phase 6 of 6 -- Full port of the Claudian AI chat engine from Obsidian to Logseq

---

## Overview

Port the entire Claudian/Inquiry AI chat system (~49,000 lines in Obsidian) to the Logseq plugin. The system provides a persistent right-sidebar chat panel powered by the Claude Agent SDK, with streaming responses, multi-tab sessions, tool use rendering, D&D stat block rendering in chat, MCP server support, security/permissions, inline editing, session management (resume/fork/rewind), and i18n (10 languages).

Because Logseq plugins run in a sandboxed iframe with no Node.js access (`nodeIntegration: false`, `contextIsolation: true`), the architecture splits into two processes:

1. **Sidecar Server** (Node.js) -- Runs the Claude Agent SDK and the entire `core/` backend from the Obsidian plugin. Communicates with the plugin over WebSocket + HTTP on localhost.
2. **Plugin UI** (browser iframe) -- Injects a chat sidebar panel into Logseq's host document via `parent.document`. Pure DOM manipulation, no React.

## Source Attribution

The inquiry system is forked from:
- **Repository:** `~/w/archivist-obsidian/src/inquiry/`
- **Size:** ~49,000 lines (130 TS files, 35 CSS files, 10 locale JSONs)
- **License:** Same project, same author

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Plugin sandbox constraint | Logseq plugins have no Node.js access | `nodeIntegration: false`, `contextIsolation: true` in Logseq's Electron config. Confirmed by GitHub issues #8836, #3430 and community forums. |
| Architecture split | Fat sidecar + thin UI client | Maximizes code reuse. 50 of 55 `core/` files copy-paste with zero changes. Only 5 files adapted (replace `Notice` and `VaultFileAdapter`). |
| Chat panel hosting | Right sidebar injection into host document | Matches Obsidian's `ItemView` sidebar UX. Uses `parent.document` DOM injection (same pattern as inline-tag-observer and dice overlay). |
| Sidecar communication | WebSocket (streaming) + HTTP (request/response) | WebSocket for real-time streaming chunks. HTTP for settings, session lists, MCP test. |
| Sidecar discovery | Port scan + settings override | Plugin is sandboxed and can't read files from disk. Scans localhost ports (52340-52360) checking `/health` endpoint. User can set a fixed port in Logseq settings to skip scanning. |
| Markdown rendering | markdown-it (~30KB) | Replaces Obsidian's `MarkdownRenderer.render()`. Lightweight, extensible, supports code highlighting via highlight.js (lazy-loaded). |
| Obsidian `Notice` replacement | WebSocket `notification` event | Sidecar emits notifications over WebSocket. Plugin renders as toast overlay in host document. |
| Obsidian `VaultFileAdapter` replacement | `NodeFileAdapter` using Node `fs` | Sidecar has full Node.js access. Same file operations, different implementation. |
| CSS theming | Map Obsidian variables to Logseq variables | `--background-primary` -> `var(--ls-primary-background-color)`, etc. Injected into host document via `<style>` element. |
| Icon system | Inline Lucide SVGs | Replaces Obsidian's `setIcon()`. Same icon set, no framework dependency. |
| UI construction | Direct DOM manipulation | Matches existing Logseq plugin patterns (entity-search, dice overlay). No React bundled. |
| Storage location | `<graph-root>/.archivist/` | Mirrors Obsidian's `.claude/` directory. Same file formats (JSONL sessions, JSON settings). |
| Browser/Canvas selection | Dropped | Logseq doesn't have Obsidian's Surfing browser or Canvas features. |
| Editor selection polling | Host DOM `window.getSelection()` | Logseq doesn't expose CM6/ProseMirror to plugins. Polling the host document's selection API instead. |

---

## Architecture

### System Diagram

```
┌─────────────────────────────────────────────────┐
│                  Logseq (Electron)               │
│                                                  │
│  ┌──────────────────────┐  ┌──────────────────┐ │
│  │    Main Document     │  │  Plugin iframe    │ │
│  │                      │  │  (lsp:// sandbox) │ │
│  │  ┌────────────────┐  │  │                   │ │
│  │  │ Injected Chat  │  │  │  Entity search    │ │
│  │  │ Sidebar Panel  │◄─┼──┤  Stat block CSS   │ │
│  │  │ (DOM injection)│  │  │  Inline tags      │ │
│  │  └───────┬────────┘  │  │                   │ │
│  │          │            │  └──────────────────┘ │
│  └──────────┼────────────┘                       │
└─────────────┼────────────────────────────────────┘
              │ WebSocket (localhost:PORT)
              ▼
┌─────────────────────────────────────────────────┐
│           Archivist Sidecar Server               │
│           (Node.js, `npx archivist serve`)       │
│                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ Claude   │ │ Storage  │ │ Security / MCP   │ │
│  │ Agent SDK│ │ (fs-based│ │ Prompts / Hooks  │ │
│  │ Service  │ │ JSONL)   │ │                  │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
│                                                  │
│  core/ from Obsidian (copy-paste, 5 files adapted)│
└─────────────────────────────────────────────────┘
```

### Data Flow

```
User types message in chat input
        |
        v
InputController captures text, @-mentions, images
        |
        v
SidecarClient.send({ type: "query", text, images, context })
        |
        v  WebSocket
Sidecar: ws/handler.ts routes to ClaudianService
        |
        v
ClaudianService.query() -> agentQuery() (Claude Agent SDK)
        |
        v
SDK streams responses -> transformSDKMessage() -> StreamChunk
        |
        v  WebSocket
Plugin: StreamController.handleStreamChunk()
        |
        v
MessageRenderer updates DOM (text, tool calls, thinking, diffs, stat blocks)
        |
        v
ChatState persists messages (plugin-side for display, sidecar-side for sessions)
```

---

## 1. Sidecar Server

### Startup & Discovery

```bash
# User starts the sidecar from the Logseq graph directory
npx archivist serve --graph ~/Documents/my-graph

# Sidecar:
# 1. Resolves --graph to absolute path
# 2. Creates .archivist/ directory if needed
# 3. StorageService.init() -- loads settings, sessions, commands, MCP config
# 4. Starts Express + WebSocket server on random available port
# 5. Writes discovery info to <graph>/.archivist/server.json
# 6. Logs: "Archivist sidecar running on ws://localhost:52341"
```

**Discovery file** (`<graph-root>/.archivist/server.json`):
```json
{
  "port": 52341,
  "pid": 12345,
  "graphRoot": "/Users/shinoobi/Documents/my-graph",
  "startedAt": "2026-04-14T10:30:00Z"
}
```

**Plugin-side discovery** (plugin is sandboxed, cannot read files from disk):
1. **Settings override**: If `sidecarPort` is set in Logseq plugin settings, connect directly to that port.
2. **Port scan**: Try ports 52340-52360 with `fetch("http://localhost:<port>/health")`. The health endpoint returns `{ service: "archivist", graphRoot }` so the plugin can confirm it found the right sidecar. The sidecar picks a port in this range by default.
3. **Manual fallback**: If neither works, show the sidecar's connection instructions in the panel.

**Context resolution**: The plugin sends file *paths* (from @-mentions) and editor selection *text* in the `query` message. The sidecar resolves file contents from the filesystem since it has Node.js `fs` access. Entity references (`[[Goblin]]`) are sent as entity slugs and the sidecar looks them up from the compendium data.

**Storage directory** (`<graph-root>/.archivist/`):
```
.archivist/
  server.json                 # Discovery file (sidecar port/pid)
  settings.json               # CC-compatible settings (permissions, model, env)
  claudian-settings.json      # Claudian-specific settings
  mcp.json                    # MCP server configurations
  sessions/                   # Chat session JSONL + .meta.json
  commands/                   # User-defined slash commands
  agents/                     # Agent definitions
  skills/                     # Skill definitions
```

This mirrors the Obsidian `.claude/` directory structure exactly -- same file formats, same storage modules.

### WebSocket Protocol

Single WebSocket connection. All messages are JSON with a `type` field.

**Client -> Server (plugin to sidecar):**

| Type | Purpose | Payload |
|------|---------|---------|
| `query` | Send a user message | `{ text, images?, filePaths?, editorSelection?, entityRefs?, sessionId? }` |
| `interrupt` | Stop current generation | `{}` |
| `approve` | Approve a tool use | `{ toolCallId }` |
| `deny` | Deny a tool use | `{ toolCallId }` |
| `allow_always` | Allow tool pattern permanently | `{ toolCallId, pattern }` |
| `session.list` | List saved sessions | `{}` |
| `session.resume` | Resume a session by ID | `{ sessionId }` |
| `session.fork` | Fork at a message | `{ sessionId, messageIndex }` |
| `session.rewind` | Rewind to a message | `{ sessionId, messageIndex }` |
| `settings.get` | Get current settings | `{}` |
| `settings.update` | Update settings | `{ patch }` |
| `mcp.list` | List MCP servers | `{}` |
| `mcp.update` | Update MCP config | `{ config }` |
| `command.list` | List slash commands | `{}` |

**Server -> Client (sidecar to plugin):**

| Type | Purpose | Payload |
|------|---------|---------|
| `stream.text` | Streaming text chunk | `{ text }` |
| `stream.thinking` | Thinking block content | `{ text, duration? }` |
| `stream.tool_use` | Tool call started | `{ id, name, input }` |
| `stream.tool_result` | Tool call result | `{ id, result, diffData? }` |
| `stream.done` | Generation complete | `{ usage, durationSeconds }` |
| `stream.error` | Error occurred | `{ message }` |
| `stream.usage` | Token usage update | `{ inputTokens, outputTokens, cacheRead, cacheWrite, percentUsed }` |
| `stream.subagent` | Subagent status | `{ id, status, type, result? }` |
| `approval.request` | Tool needs approval | `{ toolCallId, name, input, description }` |
| `session.loaded` | Session data loaded | `{ conversation }` |
| `session.list_result` | Session list response | `{ sessions[] }` |
| `settings.current` | Current settings | `{ claudian, cc }` |
| `notification` | Toast notification | `{ message, type }` |

These map directly to the existing `StreamChunk` discriminated union and `ResponseHandler` interface from the Obsidian code.

### HTTP Endpoints

```
GET  /health              # { service: "archivist", graphRoot, version }
GET  /settings            # Get all settings
POST /settings            # Update settings
GET  /sessions            # List sessions
GET  /mcp/servers         # List MCP servers
POST /mcp/test            # Test MCP server connectivity
GET  /commands            # List slash commands
```

### Shutdown

- Handles `SIGINT`/`SIGTERM` gracefully: saves in-flight session state, removes `server.json`, exits
- Plugin detects WebSocket close, enters `reconnecting` state
- Sidecar continues running independently if Logseq closes

### Sidecar Adaptations (5 files changed from Obsidian)

| File | Change |
|------|--------|
| `core/agent/ClaudianService.ts` | Replace `Notice` with `NotificationEmitter`. Remove `InquiryModule` type import. |
| `core/hooks/SecurityHooks.ts` | Replace `Notice` with `NotificationEmitter` (1 usage). |
| `core/plugins/PluginManager.ts` | Replace `Notice` with `NotificationEmitter` (1 usage). |
| `core/storage/StorageService.ts` | Replace `App`/`Plugin` constructor params with `graphRoot: string`. Replace `Notice`. Create `NodeFileAdapter` instead of `VaultFileAdapter`. |
| `core/storage/VaultFileAdapter.ts` | Replaced entirely by `NodeFileAdapter` using Node `fs` (same interface: `exists`, `read`, `write`, `append`, `list`, `remove`, `rename`, `mkdir`). |

All other 50 files in `core/` copy verbatim with zero changes.

---

## 2. Plugin UI -- Sidebar Injection

### DOM Injection

```typescript
// Access host document (established pattern)
const hostDoc = parent?.document ?? top?.document;

// Create the chat sidebar
const chatPanel = hostDoc.createElement("div");
chatPanel.id = "archivist-inquiry-panel";
appContainer.appendChild(chatPanel);
```

### CSS Positioning

```css
#archivist-inquiry-panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 420px;
  z-index: 999;
  background: var(--ls-primary-background-color);
  border-left: 1px solid var(--ls-border-color);
  display: flex;
  flex-direction: column;
  transform: translateX(100%);       /* hidden by default */
  transition: transform 0.2s ease;
}

#archivist-inquiry-panel.is-open {
  transform: translateX(0);
}

/* Push Logseq content left when panel is open */
body.archivist-inquiry-open #main-content-container {
  margin-right: 420px;
  transition: margin-right 0.2s ease;
}
```

### Panel Layout

```
┌─────────────────────────────┐
│  Header                      │
│  [owl-icon] Claudian  [tabs] │
│  [history] [new] [close]     │
├─────────────────────────────┤
│  Tab Bar (if >1 tab)        │
│  [Tab 1] [Tab 2] [+]        │
├─────────────────────────────┤
│                              │
│  Messages (scrollable)       │
│  ┌─ User ──────────────────┐│
│  │ How does fireball work? ││
│  └─────────────────────────┘│
│  ┌─ Assistant ─────────────┐│
│  │ [thinking...]           ││
│  │ Fireball is a 3rd-level ││
│  │ ```monster              ││
│  │ [rendered stat block]   ││
│  │ ```                     ││
│  │ [tool call: Read file]  ││
│  └─────────────────────────┘│
│                              │
├─────────────────────────────┤
│  Context Row                 │
│  [@file chips] [selection]   │
├─────────────────────────────┤
│  Input Toolbar               │
│  [model] [thinking] [perms]  │
│  [context meter] [MCP]       │
├─────────────────────────────┤
│  [Rich input area      ]    │
│  [                  [Send]] │
└─────────────────────────────┘
```

### Toggle Mechanism

- **Command palette**: `logseq.App.registerCommandPalette({ key: "toggle-inquiry", label: "Toggle Claudian" }, togglePanel)`
- **Keyboard shortcut**: `Cmd+Shift+I`
- **Toolbar button**: Owl icon injected into Logseq's toolbar area

### Connection States

| State | Panel Shows |
|---|---|
| `disconnected` | "Start sidecar with `npx archivist serve`" + copy button |
| `connecting` | Spinner + "Connecting..." |
| `connected` | Normal chat UI, green dot indicator |
| `reconnecting` | Yellow dot + "Reconnecting..." (auto-retry: 1s, 2s, 4s, max 30s) |

### Markdown Rendering

Obsidian's `MarkdownRenderer.render()` replaced with **markdown-it** (~30KB), configured with:
- Code syntax highlighting (highlight.js, lazy-loaded)
- D&D code fence detection (` ```monster `, ` ```spell `, ` ```item `) rendered as stat blocks using existing parsers/renderers
- Wikilink `[[entity]]` rendered as clickable links navigating via `logseq.App.pushState("page", { name })`

### Obsidian -> Logseq UI Mapping

| Obsidian Pattern | Logseq Equivalent |
|---|---|
| `containerEl.createDiv()` | `hostDoc.createElement("div")` |
| `MarkdownRenderer.render()` | `markdown-it` instance |
| `new Notice("msg")` | Toast overlay from sidecar `notification` event |
| `Modal` subclasses | Injected overlay divs in host document |
| `Setting` (settings UI) | Custom DOM settings panel in sidebar |
| `setIcon(el, "icon-name")` | Inline Lucide SVG icons |
| `ItemView` | DOM-injected sidebar panel |
| `WorkspaceLeaf` | N/A -- tabs managed by plugin state |
| `Scope` (keyboard) | `addEventListener("keydown")` on panel element |
| `TFile` / `Vault` | File ops via sidecar HTTP/WebSocket |

---

## 3. CSS & Styling

Obsidian's ~5,343 lines of CSS consolidated into a single `archivist-inquiry.css` injected into the host document.

### Variable Mapping

| Obsidian Variable | Logseq Variable |
|---|---|
| `--background-primary` | `var(--ls-primary-background-color)` |
| `--background-secondary` | `var(--ls-secondary-background-color)` |
| `--text-normal` | `var(--ls-primary-text-color)` |
| `--text-muted` | `var(--ls-secondary-text-color)` |
| `--text-faint` | `var(--ls-tertiary-text-color)` |
| `--interactive-accent` | `var(--ls-active-primary-color)` |
| `--background-modifier-border` | `var(--ls-border-color)` |
| `--font-text-size` | `var(--ls-font-size)` |

### Injection Method

```typescript
const style = hostDoc.createElement("style");
style.textContent = inquiryCss;
hostDoc.head.appendChild(style);
```

All selectors prefixed with `#archivist-inquiry-panel` or `.archivist-` to avoid collisions with Logseq styles. Parchment theme colors (`#fdf1dc`, `#922610`, `#d9c484`) remain hardcoded for D&D stat blocks.

---

## 4. Plugin Initialization (Updated)

```
logseq.ready(main)
  |
  v
1.  logseq.provideStyle(dndCss + editCss)                    # Phase 1 + 3
2.  logseq.useSettingsSchema(settingsSchema)                   # Phase 3, MODIFIED (sidecarPort added)
3.  Register 3 fenced code renderers                           # Phase 1
4.  Register 3 slash commands                                  # Phase 1
5.  Create SrdStore, EntityRegistry, CompendiumManager         # Phase 2
6.  compendiumManager.discover() + loadAllEntities()           # Phase 2
7.  Register "Import SRD" command                              # Phase 2
8.  Register "Search Entity" command                           # Phase 2
9.  logseq.provideModel({ ...searchUIHandlers })               # Phase 2
10. startInlineTagObserver(hostDoc)                             # Phase 4
11. initDiceRenderer(hostDoc)                                  # Phase 5
12. NEW: InquiryPanel.init(hostDoc)                            # Phase 6
      a. Inject sidebar DOM (hidden)
      b. Inject toolbar toggle button
      c. Inject inquiry CSS into host document
13. NEW: Register command palette commands                      # Phase 6
      - "Toggle Claudian" (Cmd+Shift+I)
      - "Claudian: New Session"
      - "Claudian: Inline Edit"
14. NEW: SidecarClient.discover() -> WebSocket connect          # Phase 6
```

---

## 5. Settings

**Logseq plugin settings** (added to existing schema):

| Setting | Type | Default | Purpose |
|---------|------|---------|---------|
| `sidecarPort` | number | `0` | Fixed sidecar port (0 = auto-discover) |

All other Claudian settings are managed by the sidecar and stored in `.archivist/claudian-settings.json`. The settings UI in the sidebar reads/writes these via the WebSocket `settings.get` / `settings.update` protocol.

---

## 6. Project Structure

```
archivist-logseq/
  src/                              # Plugin (browser, existing)
    inquiry/                        # NEW -- Plugin-side UI
      InquiryPanel.ts               # DOM injection, toggle, lifecycle
      SidecarClient.ts              # WebSocket + HTTP client

      ui/
        ChatView.ts                 # Panel shell
        TabBar.ts                   # Tab bar DOM
        RichInput.ts                # ContentEditable + @-mentions
        InputToolbar.ts             # Model selector, thinking, perms, context meter
        FileContext.ts              # @-mention file chips
        ImageContext.ts             # Image paste/drop
        StatusPanel.ts              # Todo/command output
        SettingsPanel.ts            # Settings UI
        InstructionMode.ts          # # mode UI
        BangBashMode.ts             # ! mode UI

      controllers/
        StreamController.ts         # WebSocket stream -> DOM updates
        InputController.ts          # Input handling, slash commands, send
        ConversationController.ts   # Session ops via WebSocket
        SelectionController.ts      # Host document selection polling
        NavigationController.ts     # Vim-style keyboard nav

      rendering/
        MessageRenderer.ts          # Orchestrates all rendering
        ToolCallRenderer.ts         # Tool use blocks
        WriteEditRenderer.ts        # File write/edit diffs
        DiffRenderer.ts             # Hunked inline diffs
        ThinkingBlockRenderer.ts    # Collapsible thinking
        TodoListRenderer.ts         # Todo panel
        SubagentRenderer.ts         # Subagent progress
        DndEntityRenderer.ts        # D&D stat blocks in chat
        InlineExitPlanMode.ts       # Plan mode cards
        InlineAskUserQuestion.ts    # AskUser cards
        dndCodeFence.ts             # D&D code fence detection
        collapsible.ts              # Collapsible block utility
        markdown.ts                 # markdown-it wrapper

      state/
        ChatState.ts                # Per-tab state
        types.ts                    # State types

      services/
        SubagentManager.ts          # Subagent lifecycle (via sidecar)
        TitleGenerationService.ts   # Auto-title (via sidecar)
        InlineEditService.ts        # Inline edit (via sidecar)

      shared/
        MentionDropdown.ts          # @-mention dropdown
        SlashCommandDropdown.ts     # Slash command dropdown
        EntityAutocomplete.ts       # [[ entity autocomplete
        ResumeSessionDropdown.ts    # Resume session list
        icons.ts                    # Lucide SVG icon helper
        modals.ts                   # Injected overlay modals

      i18n/                         # Copy verbatim from Obsidian
        i18n.ts
        types.ts
        constants.ts
        locales/*.json              # 10 languages

    styles/
      archivist-inquiry.css         # NEW -- Chat panel styles

  sidecar/                          # NEW -- Sidecar server (Node.js)
    package.json
    tsconfig.json

    src/
      server.ts                     # Express + WebSocket server entry
      cli.ts                        # CLI entry: `npx archivist serve`

      ws/
        handler.ts                  # WebSocket message routing
        protocol.ts                 # Message type definitions

      adapter/
        NodeFileAdapter.ts          # Replaces VaultFileAdapter (Node fs)
        NotificationEmitter.ts      # Replaces Obsidian Notice

      core/                         # Copy from Obsidian src/inquiry/core/
        agent/                      # 7 files (1 adapted: ClaudianService)
        agents/                     # 3 files (verbatim)
        commands/                   # 2 files (verbatim)
        hooks/                      # 3 files (1 adapted: SecurityHooks)
        mcp/                        # 3 files (verbatim)
        plugins/                    # 2 files (1 adapted: PluginManager)
        prompts/                    # 5 files (verbatim)
        sdk/                        # 5 files (verbatim)
        security/                   # 4 files (verbatim)
        storage/                    # 11 files (2 adapted: StorageService, VaultFileAdapter)
        tools/                      # 5 files (verbatim)
        types/                      # 10 files (verbatim)
```

---

## 7. New Dependencies

### Plugin (browser)

| Package | Size (minified) | Purpose |
|---------|----------------|---------|
| `markdown-it` | ~30KB | Markdown rendering in chat messages |
| `highlight.js` | Lazy-loaded | Code syntax highlighting |

### Sidecar (Node.js)

| Package | Size | Purpose |
|---------|------|---------|
| `@anthropic-ai/claude-agent-sdk` | -- | Claude Agent SDK |
| `ws` | ~10KB | WebSocket server |
| `express` | ~200KB | HTTP endpoints |
| `@modelcontextprotocol/sdk` | -- | MCP client (for MCP tester) |

---

## 8. Port Effort Summary

### Sidecar (core/ backend)

| Category | Files | Changes |
|----------|-------|---------|
| Copy verbatim | 50 | Zero changes |
| Adapt (replace Notice/VaultFileAdapter) | 5 | Minimal, mechanical replacements |
| New (server, CLI, adapters, WebSocket handler) | ~6 | New code for the server shell |
| **Total** | **~61** | |

### Plugin (UI layer)

| Category | Files | Est. Lines |
|----------|-------|-----------|
| Copy/near-copy (i18n, ChatState, renderers with minor setIcon changes) | ~15 | ~3,000 |
| Adapt (controllers, services, UI components) | ~18 | ~8,000 |
| Rewrite (InquiryPanel, SidecarClient, SettingsPanel, InlineEditModal) | ~4 | ~2,000 |
| **Total new plugin code** | **~37** | **~13,000** |

### CSS

| Category | Est. Lines |
|----------|-----------|
| Ported from Obsidian (variable mapping) | ~5,000 |
| New (sidebar injection, connection states) | ~200 |
| **Total** | **~5,200** |

### Grand Total

| Component | Files | Est. Lines |
|-----------|-------|-----------|
| Sidecar (core/ copy + server shell) | ~61 | ~9,000 |
| Plugin UI | ~37 | ~13,000 |
| CSS | 1 | ~5,200 |
| i18n (copy) | 13 | ~3,000 |
| **Total** | **~112** | **~30,200** |

---

## 9. What Phase 6 Does NOT Include

- **Browser/Canvas selection controllers** -- Logseq lacks Obsidian's Surfing browser and Canvas features
- **CodeMirror selection decorations** -- Logseq doesn't expose CM6 to plugins; selection uses host DOM `window.getSelection()`
- **Sidecar auto-start** -- User must start the sidecar manually; no Logseq hook to auto-launch subprocesses
- **Plugin system** (`PluginManager`) -- Ported for compatibility but Claude Code plugins may not be exercised in Logseq context

---

## Phase Roadmap (Updated)

| Phase | Status |
|-------|--------|
| Phase 1: Core Rendering | Done |
| Phase 2: Entity & Compendium | Done |
| Phase 3: Edit Mode | Done |
| Phase 4: Inline Tags | Done |
| Phase 5: Dice Rolling System | Done |
| **Phase 6: AI / Inquiry System** | **This spec** |
