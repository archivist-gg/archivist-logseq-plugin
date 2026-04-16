# Phase 6.5: Inquiry System Fix & Obsidian Parity

**Date:** 2026-04-15
**Status:** Design spec
**Scope:** Fix all bugs in the current Logseq Inquiry implementation, close every feature gap with the Obsidian Inquiry system, and reach full behavioral parity.
**Approach:** Architecture-first -- fix sidecar multi-session foundation, then bugs, then wire stubs, then port missing features.
**Code strategy:** Copy from archivist-obsidian wherever possible. Only adapt when Logseq's sandbox constraints require it.

---

## 1. Sidecar Multi-Session Architecture

### Problem

The sidecar currently manages a single `ClaudianService` instance. All tabs share the same session, so opening a new tab does not create a new conversation -- it continues the same one. In Obsidian, each tab creates its own independent `ClaudianService` with its own persistent query, session ID, model, and streaming state.

### Design

Add a `SessionRouter` class to the sidecar that manages a `Map<string, ClaudianService>` keyed by `tabId`.

**Protocol change:** Every `ClientMessage` gains a required `tabId: string` field. The sidecar routes each message to the correct `ClaudianService` instance via `SessionRouter`.

**SessionRouter API:**
```typescript
class SessionRouter {
  private sessions: Map<string, ClaudianService> = new Map();
  
  getOrCreate(tabId: string): ClaudianService  // lazy init on first query
  destroy(tabId: string): void                  // cleanup on tab close
  get(tabId: string): ClaudianService | undefined
  destroyAll(): void                            // server shutdown
}
```

**Lifecycle:**
- `getOrCreate(tabId)` lazily creates a `ClaudianService` using the same initialization pattern as Obsidian's `Tab.ts`
- Each `ClaudianService` gets its own `SessionManager`, `MessageChannel`, and persistent query loop
- `destroy(tabId)` interrupts any active query, cleans up the service, removes from map
- On WebSocket disconnect, all sessions for that client are preserved (reconnection resumes them)

**Plugin-side change:** `SidecarClient` methods (`sendQuery`, `sendApprove`, `sendDeny`, `sendInterrupt`, etc.) all gain a `tabId` parameter. `ChatView` passes `tab.id` through every call.

**Sidecar handler change:** `ws/handler.ts` extracts `msg.tabId` and routes through `SessionRouter` instead of accessing `services.claudian` directly.

### Excluded from scope

- Sidecar auto-start (user starts it manually)
- Browser/Canvas selection controllers (Obsidian-specific)
- Inline edit feature (Obsidian CM6-specific)

**Included:** Editor selection via Logseq API (see Section 8g)

---

## 2. Bug Fixes

### 2a. Default model -- Opus

**Problem:** `ChatView.ts` defaults to `claude-sonnet-4-20250514`. Should be `opus`.

**Fix:** Change `cachedSettings.model` to `'opus'`. Update `InputToolbar.ts` model list to use shorthand names (`haiku`, `sonnet`, `sonnet[1m]`, `opus`, `opus[1m]`) matching `core/types/models.ts`. This also fixes the model string mismatch bug -- the plugin was sending full API strings while the sidecar core expects shorthand.

### 2b. Messages start at top

**Problem:** Messages are rendered centered or at bottom instead of starting from the top of the container.

**Fix:** Ensure the messages container uses `justify-content: flex-start` (or no justify-content at all). Messages stack top-down, input stays pinned at bottom via flex layout. Inspect and fix any CSS rule that pushes content down.

### 2c. Tabs layout broken

**Problem:** Tab bar has visual/layout issues.

**Fix:** Port tab bar CSS from Obsidian's `components/tab-bar.css`. Ensure tab items have correct sizing, overflow scrolling with arrows, and active tab indicator styling. Match Obsidian's tab appearance exactly.

### 2d. Markdown rendering during streaming

**Problem:** `StreamController.setRendererBridge()` is never called, so streaming text falls back to plain `textContent` instead of rendered markdown.

**Fix:** After creating `StreamController`, wire the renderer bridge so streaming text goes through `markdown-it`. Copy the bridge wiring pattern from Obsidian's `Tab.ts` where it connects the stream controller to the markdown renderer.

### 2e. Images ignored in queries

**Problem:** `ws/handler.ts` passes `undefined` for images even though the plugin sends image data.

**Fix:** Pass `msg.images` through to `ClaudianService.query()`.

### 2f. Welcome element per-tab

**Problem:** `welcomeEl` is appended to the shared messages container instead of per-tab DOM.

**Fix:** Move `welcomeEl` creation into per-tab DOM (inside `tab.messagesEl`). Each tab manages its own welcome visibility based on `tab.chatState.messages.length`.

---

## 3. Wire Existing Stubs

### 3a. Session operations (resume/fork/rewind)

**Problem:** `ws/handler.ts` has stub handlers for `session.resume`, `session.fork`, `session.rewind` that just log to console.

**Fix:** Wire to per-tab `ClaudianService` using SDK options:
- `session.resume`: Pass `resume: sessionId` to SDK
- `session.fork`: Pass `forkSession: { sessionId, messageId }` to SDK
- `session.rewind`: Pass `resumeSessionAt: { sessionId, messageId }` to SDK

Copy logic from Obsidian's `ConversationController.ts`. Plugin-side `ConversationController.ts` already has the methods -- they just need the sidecar to process them.

### 3b. Approval flow

**Problem:** `InputController.ts` lines 205-215 have TODOs for `approval.request`, `askuser.question`, `plan_mode.request`.

**Fix:**
- Wire sidecar to forward SDK approval callbacks through WebSocket as `ServerMessage` types
- Plugin renders inline approval UI (approve/deny/allow-always buttons)
- Copy `InlineAskUserQuestion.ts` rendering trigger from Obsidian
- Copy `InlineExitPlanMode.ts` rendering trigger from Obsidian
- Wire `SidecarClient.sendApprove()`, `sendDeny()`, `sendAllowAlways()` responses back

### 3c. Settings sync

**Problem:** `settings.update` in handler.ts is a stub.

**Fix:** Wire to update the per-tab `ClaudianService` dynamically:
- Model changes: `claudianService.updateModel(model)`
- Effort level: `claudianService.updateThinking(effortLevel)`
- Permission changes: `claudianService.updatePermissions(permissions)`
- MCP server changes: `claudianService.updateMcpServers(servers)`

Copy the dynamic update flow from Obsidian's `ClaudianService`.

### 3d. MCP server management

**Problem:** `mcp.update` in handler.ts is a stub.

**Fix:** Wire to `McpServerManager` which already exists in sidecar core. Forward MCP server enable/disable/config changes.

---

## 4. Notification System

**Problem:** Obsidian uses `new Notice()` for 20+ user-facing messages. Logseq silently logs to `console.error`.

**Fix:** The `NotificationMessage` protocol type already exists. The sidecar's `NotificationEmitter` already sends notifications over WebSocket. Add a toast renderer in the plugin:
- Render toast notifications in the panel header area
- Support `info`, `warning`, `error` levels with appropriate styling
- Auto-dismiss after 5s for info, 8s for warning, persistent for error
- Copy toast CSS from the existing `archivist-inquiry.css` (lines 275-341 already have toast styles)

---

## 5. Connection Status Indicator

**Problem:** `SidecarClient` tracks connection state (`disconnected`, `connecting`, `connected`, `reconnecting`) but nothing renders it.

**Fix:** The CSS already has connection indicator styles (lines 214-270 with colored dots). Wire `SidecarClient.onStateChange()` to update the connection indicator dot in the panel header:
- Green dot: connected
- Yellow dot: connecting/reconnecting
- Red dot: disconnected

---

## 6. Plan Mode

**Problem:** No plan mode support -- no Shift+Tab toggle, no EnterPlanMode detection in stream, no state tracking.

**Fix:**
- Add `Shift+Tab` keyboard handler in input to toggle plan mode
- Add `EnterPlanMode` detection in `StreamController` -- when detected in stream, sync UI state (show shield icon, update permission mode)
- Wire `ExitPlanMode` inline card rendering with three options: "Approve (new session)", "Approve", "Provide feedback"
- Copy plan mode state management from Obsidian's `InputController`
- Wire `SidecarClient.sendPlanApprove()`, `sendPlanFeedback()`, `sendPlanApproveNewSession()` messages

---

## 7. Streaming Completeness

### 7a. Subagent chunk routing

**Problem:** `StreamController` does not route subagent-specific chunks to `SubagentRenderer`.

**Fix:** Copy subagent chunk routing from Obsidian's `StreamController`:
- Route `stream.tool_use` for Agent/Task tools to `SubagentRenderer`
- Track sync/async subagent state
- Handle nested tool calls within subagents
- Handle async subagent lifecycle (pending -> running -> completed)

### 7b. D&D skeleton streaming

**Problem:** No `activeSkeletons` map or partial update logic during D&D entity generation.

**Fix:** Copy skeleton streaming from Obsidian's `ToolCallRenderer`:
- `activeSkeletons` map tracks in-progress D&D tool calls
- As tool input streams in (name, AC, HP fields), update skeleton preview
- Pulsing placeholder bars show progressive data
- On completion, replace skeleton with full rendered entity

### 7c. Blocked content rendering

**Problem:** `stream.blocked` messages silently dropped.

**Fix:** Render blocked content inline in the message flow. Copy blocked message rendering from Obsidian.

---

## 8. Port Missing Features

### 8a. Rewind & Fork

Copy from Obsidian:
- **Rewind button** on user messages (rewind icon from `icons.ts`). Click truncates messages back to that point, restores content to input, sends `session.rewind` to sidecar.
- **Fork button** on user messages (fork icon). Click shows `ForkTargetModal` (new tab vs current tab). Deep clones messages, creates new conversation with `forkSource` metadata.
- **`/fork` command** forks entire conversation to new tab.
- Add `forkSource` field to `Conversation` type.
- Copy `ForkTargetModal` from Obsidian's `shared/modals/`, adapt to use injected modal system.

### 8b. History dropdown

Copy from Obsidian's `ConversationController`:
- History panel showing all past conversations (title, preview, message count, date)
- Session switching via sidecar's `/sessions` HTTP endpoint
- Inline rename (click title to edit)
- Title regeneration button (retry failed generations)
- Delete with confirmation
- Session search/filter

### 8c. Built-in slash commands

Wire all commands from Obsidian's `builtInCommands.ts`:
- `/clear` (alias `/new`) -- Start new conversation (create new tab or clear current)
- `/add-dir [path]` -- Add external context directory
- `/resume` -- Resume a previous conversation (show `ResumeSessionDropdown`)
- `/fork` -- Fork entire conversation to new session
- `/generate <type> [description]` -- Generate D&D entity via MCP
- `/search-srd [query]` -- Search SRD content
- `/roll <notation>` -- Roll dice

Copy the `SlashCommandDropdown` wiring to trigger these on selection. Verify hidden command filtering and argument hints display.

### 8d. D&D entity rendering in chat

- Wire D&D code fence detection in `markdown.ts` to trigger `DndEntityRenderer`
- Copy "Copy & Save to Compendium" button logic from Obsidian
- Copy "Update" button logic (when entity already exists in compendium)
- Wire `dndUpdateCallback` for updating existing entities

### 8e. D&D MCP generation tools

- Register the Archivist MCP server in sidecar's `McpServerManager` configuration with generation tools (`generate_monster`, `generate_spell`, `generate_item`)
- Copy MCP server configuration from Obsidian's `.claude/claudian-settings.json` MCP section
- Wire the `/generate` command to trigger MCP tool calls via the sidecar

### 8f. D&D thinking flavor texts

- Copy full `FLAVOR_TEXTS` array (50 D&D-themed entries) from Obsidian's `constants.ts`
- Copy `COMPLETION_FLAVOR_WORDS` array
- Replace Logseq's 6 basic flavor texts with the full set

### 8g. Editor selection context

- Use `logseq.Editor.getEditingBlockContent()` to get current editing block text
- Poll on 250ms interval (same as Obsidian)
- Show selection indicator in context row
- Auto-attach current note context using `logseq.Editor.getCurrentPage()`

### 8h. File @-mention dropdown

Copy `MentionDropdownController` from Obsidian, adapt data source:
- Use `logseq.Editor.getAllPages()` for page list instead of vault files
- Support agent mentions (from sidecar's AgentManager)
- Support MCP server mentions (from sidecar's McpServerManager)
- File chips with remove buttons in context row

### 8i. StatusPanel (TodoWrite)

- `StatusPanel.ts` already exists -- wire it up
- Route `TodoWrite` tool calls from stream to update the status panel
- Copy `TodoListRenderer` rendering from Obsidian
- Show collapsed header with progress count, expandable list

### 8j. Bang-bash execution

- `BangBashMode.ts` already exists -- wire the execution path
- Sidecar's `/commands` endpoint handles execution
- Output displays in StatusPanel's command panel
- Pink border + monospace font indicator in input

### 8k. Instruction mode service

- `InstructionMode.ts` UI already exists
- Copy `InstructionRefineService` from Obsidian -- runs as cold-start query through sidecar
- Multi-turn conversation support for clarifications
- Result saved to custom system prompt setting

### 8l. External context directories

- Copy ExternalContextSelector UI from Obsidian's `InputToolbar.ts`
- Add/remove external directories with path validation
- Wire to sidecar's `additionalDirectories` in SDK options
- Support `persistentExternalContextPaths` setting

### 8m. MCP server selector

- Copy McpServerSelector UI from Obsidian's `InputToolbar.ts`
- Toggle individual MCP servers on/off per-session
- Wire to sidecar's `McpServerManager` via settings update

### 8n. File link processing

- Copy `processFileLinks()` from Obsidian's `MessageRenderer.ts`
- Make vault file references clickable in assistant messages
- Adapt to use `logseq.App.pushState()` for navigation

### 8o. Image embed rendering

- Copy `replaceImageEmbedsWithHtml()` from Obsidian
- Render `![[image.png]]` references as inline images in messages
- Add full-size image viewer modal on click

### 8p. Compact boundary rendering

- Copy visual separator rendering for `stream.compact_boundary`
- Show "Conversation compacted" marker in message flow

### 8q. Conversation rename

- Add inline rename UI in history dropdown
- Click conversation title to edit
- Send rename to sidecar, update tab title

### 8r. Title regeneration

- Add retry button on failed title generations in history
- Wire to `TitleGenerationService` for re-generation

---

## 9. Welcome Screen

- Copy owl icon SVG from Obsidian's `owl-icon.ts`
- Add `userName` setting for personalized greetings
- Copy greeting variety from Obsidian's `constants.ts` (including named variants)
- Remount StatusPanel on new conversation

---

## 10. Tab System Upgrade

### 10a. TabManager orchestrator

Copy `TabManager.ts` from Obsidian:
- Max tabs limit (configurable 3-10 via `maxTabs` setting)
- Tab creation with lazy service initialization
- Tab switching with scroll position preservation
- Tab close with cleanup
- Fork conversation to new/current tab
- Title tracking and tab bar updates

### 10b. Tab module

Copy `Tab.ts` from Obsidian:
- Individual tab state with `createTab()`, `activateTab()`, `deactivateTab()`, `destroyTab()`
- `initializeTabControllers()`, `initializeTabService()`
- Fork request handling

### 10c. Tab persistence

- Copy `PersistedTabManagerState` type
- Save/restore tab state across plugin reloads
- Store in sidecar's StorageService (consistent with all other persistence -- sessions, settings, etc. already live in `<graph>/.archivist/`)

### 10d. Tab title generation

- Auto-generate titles using Haiku model after first exchange
- Copy `TitleGenerationService` wiring from Obsidian
- Concurrent per-tab with separate AbortControllers

### 10e. Tab bar position

- Add `tabBarPosition` setting: `'header'` (default) or `'input'`
- Copy positioning logic from Obsidian's `ClaudianView.ts`

---

## 11. Settings Parity

Port the following settings from Obsidian to Logseq's SettingsPanel:

| Setting | Type | Default |
|---------|------|---------|
| `userName` | string | `''` |
| `permissionMode` | `'unleashed' \| 'guarded'` | `'unleashed'` |
| `enableBlocklist` | boolean | `true` |
| `allowExternalAccess` | boolean | `false` |
| `enableBangBash` | boolean | `false` |
| `enableOpus1M` | boolean | `true` |
| `enableSonnet1M` | boolean | `true` |
| `enableAutoScroll` | boolean | `true` |
| `maxTabs` | number (3-10) | `10` |
| `tabBarPosition` | `'input' \| 'header'` | `'header'` |
| `hiddenSlashCommands` | string[] | `[]` |
| `envSnippets` | EnvSnippet[] | `[]` |
| `customContextLimits` | Record<string, number> | `{}` |
| `excludedTags` | string[] | `[]` |
| `mediaFolder` | string | `''` |
| `systemPrompt` | string | `''` |
| `allowedExportPaths` | string[] | `['~/Desktop', '~/Downloads']` |
| `persistentExternalContextPaths` | string[] | `[]` |
| `keyboardNavigation` | object | `{ scrollUpKey: 'w', scrollDownKey: 's', focusInputKey: 'i' }` |

Wire all settings to sidecar via `settings.update` protocol message.

---

## 12. Tool Handling Parity

### 12a. Centralized tool constants

Copy `toolNames.ts` from Obsidian's `core/tools/`:
- All tool name constants
- Helper predicates (`isReadOnlyTool`, `isEditTool`, `skipsBlockedDetection`)

### 12b. Comprehensive tool icons

Copy `toolIcons.ts` from Obsidian's `core/tools/`:
- Full icon mapping for all SDK tools
- `MCP_ICON_MARKER` pattern for custom MCP SVG icons

### 12c. Tool input parsing

Copy `toolInput.ts` from Obsidian's `core/tools/`:
- `getToolSummary()`, `getToolLabel()`, `getPathFromToolInput()`, `getToolName()`

### 12d. Todo parsing

Copy `todo.ts` from Obsidian's `core/tools/`:
- `parseTodoInput()`, `extractResolvedAnswers()`

---

## 13. Accessibility

- Copy `accessibility.css` from Obsidian (40 lines of focus-visible styles)
- Add ARIA labels on history actions (rename, delete, regenerate, loading)
- Ensure consistent `aria-label` usage on all interactive elements

---

## 14. CSS Polish

- Copy missing CSS modules from Obsidian:
  - `external-context.css`
  - `mcp-selector.css`
  - `fork-target.css`
  - `resume-session.css`
  - `file-link.css`
  - `image-embed.css`
  - `image-modal.css`
  - `accessibility.css`
  - Settings CSS modules (env-snippets, agent, plugin, slash, mcp, mcp-modal)
- Append to `archivist-inquiry.css` (maintaining the single-file approach for Logseq) with Obsidian-to-Logseq CSS variable mapping
- Verify all Obsidian CSS class names are present and styled

---

## 15. Excluded from Scope

These features are Obsidian-specific and have no Logseq equivalent:

- **Inline edit** (CM6 in-editor editing with diff preview)
- **Browser selection controller** (Surfing plugin webview polling)
- **Canvas selection controller** (Obsidian canvas node polling)
- **Hover Editor compatibility**
- **Open in main tab** (Obsidian sidebar vs main editor area)
- **Image file picker dialog** (Electron-only)
- **Chrome extension support** (Obsidian-specific)

---

## 16. Architecture Summary

```
Logseq Plugin (browser iframe)              Sidecar (Node.js server)
==================================          ==================================
InquiryPanel                                Express + WebSocket server
  |-- ChatView                              SessionRouter
       |-- TabManager                         |-- ClaudianService (tab-1)
       |    |-- Tab (tab-1)                   |    |-- SessionManager
       |    |    |-- StreamController         |    |-- MessageChannel
       |    |    |-- InputController          |    |-- persistent agentQuery()
       |    |    |-- ConversationController   |
       |    |    |-- NavigationController     |-- ClaudianService (tab-2)
       |    |    |-- SubagentManager          |    |-- (same structure)
       |    |    |-- TitleGenerationService   |
       |    |-- Tab (tab-2)                   StorageService
       |    |    |-- (same structure)         McpServerManager
       |                                      PluginManager
       |-- TabBar                             AgentManager
       |-- RichInput
       |-- InputToolbar
       |-- StatusPanel
       |-- SettingsPanel
       |
  SidecarClient (WebSocket + HTTP)
    |-- sendQuery(text, tabId, ...)
    |-- sendApprove(toolId, tabId)
    |-- sendDeny(toolId, tabId)
    |-- ... (all methods take tabId)
```

---

## 17. Implementation Order

1. **Sidecar multi-session** -- SessionRouter, protocol tabId, handler routing
2. **Model normalization** -- shorthand names everywhere
3. **Bug fixes batch** -- messages layout, tabs CSS, markdown streaming, default model, images, welcome per-tab
4. **Wire stubs** -- approval flow, session ops, settings sync, MCP management
5. **Notification & connection** -- toast system, connection indicator
6. **Plan mode** -- state tracking, Shift+Tab toggle, inline cards
7. **Streaming completeness** -- subagent routing, D&D skeletons, blocked content
8. **Tab system upgrade** -- TabManager, Tab module, persistence, title generation, position setting
9. **Port features** -- rewind/fork, history, built-in commands, D&D rendering, flavor texts, slash commands, StatusPanel wiring, bang-bash, instruction service, external contexts, MCP selector, file mentions, file links, image embeds, compact boundary, rename, title regen
10. **Settings parity** -- full settings panel
11. **Tool handling** -- centralized constants, icons, parsing
12. **Welcome screen** -- owl icon, personalized greetings
13. **CSS polish** -- missing modules, accessibility
14. **Editor selection context** -- Logseq API polling, context row
