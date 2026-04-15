# Phase 6.5: Inquiry Fix & Obsidian Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all bugs in the Logseq Inquiry chat system and close every feature gap with the Obsidian Inquiry system to reach full behavioral parity.

**Architecture:** Two-process split: sidecar (Node.js) runs Claude Agent SDK with per-tab `SessionRouter`, plugin (browser iframe) runs UI with `TabManager`/`Tab` architecture copied from Obsidian. Copy code from `~/w/archivist-obsidian` wherever possible; adapt only for Logseq sandbox constraints.

**Tech Stack:** TypeScript, Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), Express, WebSocket (`ws`), markdown-it, Vite, Vitest

**Reference codebase:** `~/w/archivist-obsidian/src/inquiry/` (Obsidian plugin)
**Target codebase:** `~/w/archivist-logseq/` (Logseq plugin + sidecar)

**Critical architecture note:** The current `ChatView.ts` (711 lines) is a broken orchestrator that reimplements `InputController` logic inline and never instantiates `InputController`, `ConversationController`, `SelectionController`, or `MessageRenderer`. The `StreamController.rendererBridge` is never set, so markdown falls back to plain text. The fix is to port the `TabManager`/`Tab` architecture from Obsidian, which properly creates and wires all controllers per tab.

---

## Phase A: Foundation (Sidecar)

### Task 1: SessionRouter — Multi-Session Sidecar Architecture

**Files:**
- Create: `sidecar/src/SessionRouter.ts`
- Modify: `sidecar/src/services.ts`
- Modify: `sidecar/src/ws/protocol.ts`
- Modify: `src/inquiry/protocol.ts` (plugin-side mirror)

The sidecar currently creates a single `ClaudianService` in `services.ts`. We need a `SessionRouter` that manages one `ClaudianService` per tab, and a `tabId` field on all client messages.

- [ ] **Step 1: Add `tabId` to protocol**

In `sidecar/src/ws/protocol.ts`, add `tabId: string` to every `ClientMessage` variant. Add a base type:

```typescript
interface ClientMessageBase {
  tabId: string;
}
```

Apply `extends ClientMessageBase` to all 19 client message types: `QueryMessage`, `InterruptMessage`, `ApproveMessage`, `DenyMessage`, `AllowAlwaysMessage`, `SessionListMessage`, `SessionResumeMessage`, `SessionForkMessage`, `SessionRewindMessage`, `SettingsGetMessage`, `SettingsUpdateMessage`, `McpListMessage`, `McpUpdateMessage`, `CommandListMessage`, `PlanApproveMessage`, `PlanApproveNewSessionMessage`, `PlanFeedbackMessage`, `AskUserAnswerMessage`, `AskUserDismissMessage`.

Also add optional `tabId?: string` to all `ServerMessage` variants via a `ServerMessageBase`.

Add a new `TabDestroyMessage`:
```typescript
export interface TabDestroyMessage extends ClientMessageBase {
  type: 'tab.destroy';
}
```

Add it to the `ClientMessage` union.

- [ ] **Step 2: Mirror protocol changes to plugin**

Copy the updated `sidecar/src/ws/protocol.ts` to `src/inquiry/protocol.ts` (they must stay in sync per the file header comment).

- [ ] **Step 3: Create SessionRouter**

Create `sidecar/src/SessionRouter.ts`:

```typescript
import { ClaudianService, SidecarContext } from './core/agent/ClaudianService';
import { McpServerManager } from './core/mcp/McpServerManager';

export class SessionRouter {
  private sessions = new Map<string, ClaudianService>();
  private context: SidecarContext;
  private mcpManager: McpServerManager;

  constructor(context: SidecarContext, mcpManager: McpServerManager) {
    this.context = context;
    this.mcpManager = mcpManager;
  }

  getOrCreate(tabId: string): ClaudianService {
    let service = this.sessions.get(tabId);
    if (!service) {
      service = new ClaudianService(this.context, this.mcpManager);
      this.sessions.set(tabId, service);
    }
    return service;
  }

  get(tabId: string): ClaudianService | undefined {
    return this.sessions.get(tabId);
  }

  destroy(tabId: string): void {
    const service = this.sessions.get(tabId);
    if (service) {
      service.cancel();
      this.sessions.delete(tabId);
    }
  }

  destroyAll(): void {
    for (const [tabId] of this.sessions) {
      this.destroy(tabId);
    }
  }

  get size(): number {
    return this.sessions.size;
  }
}
```

- [ ] **Step 4: Replace single ClaudianService with SessionRouter in services.ts**

In `sidecar/src/services.ts`:

1. Add import: `import { SessionRouter } from './SessionRouter';`
2. Change the `SidecarServices` interface -- replace `claudian` field with `sessionRouter: SessionRouter`
3. In `initializeServices()`, replace the `ClaudianService` construction:
```typescript
// Replace:
//   const claudian = new ClaudianService(sidecarContext, mcpManager);
//   const claudianProxy = Object.assign(claudian, { getSettings: () => currentSettings });
// With:
const sessionRouter = new SessionRouter(sidecarContext, mcpManager);
```
4. Return `sessionRouter` instead of `claudian` in the services object.

- [ ] **Step 5: Verify sidecar compiles**

Run: `cd ~/w/archivist-logseq/sidecar && npx tsc --noEmit`

Expected: Compilation errors in `handler.ts` and `server.ts` where they reference `services.claudian`. These are fixed in Task 2.

- [ ] **Step 6: Commit**

```bash
cd ~/w/archivist-logseq
git add sidecar/src/SessionRouter.ts sidecar/src/services.ts sidecar/src/ws/protocol.ts src/inquiry/protocol.ts
git commit -m "feat: add SessionRouter for per-tab ClaudianService instances"
```

---

### Task 2: Route Handler Through SessionRouter

**Files:**
- Modify: `sidecar/src/ws/handler.ts`
- Modify: `sidecar/src/server.ts`

- [ ] **Step 1: Update handler to use SessionRouter**

In `sidecar/src/ws/handler.ts`, update `routeMessage()`:

1. At the top of `routeMessage`, extract `tabId`:
```typescript
async function routeMessage(ws: WebSocket, message: ClientMessage, services: SidecarServices): Promise<void> {
  const tabId = message.tabId;
```

2. Replace every `services.claudian` reference:
   - `handleQuery`: `services.sessionRouter.getOrCreate(tabId)` instead of `services.claudian`
   - `interrupt`: `services.sessionRouter.get(tabId)?.cancel()`
   - `approve/deny/allow_always`: Use `services.pendingApprovals` (unchanged -- these are global registries)
   - `session.list`: Unchanged (global)
   - `tab.destroy`: `services.sessionRouter.destroy(tabId)`

3. In `handleQuery`, add `tabId` to outgoing messages:
```typescript
async function handleQuery(ws: WebSocket, message: QueryMessage, services: SidecarServices): Promise<void> {
  const claudian = services.sessionRouter.getOrCreate(message.tabId);
  // ... existing query logic using claudian ...
  // In the stream loop, add tabId to each server message:
  const serverMsg = chunkToMessage(chunk);
  if (serverMsg) {
    (serverMsg as any).tabId = message.tabId;
    send(ws, serverMsg);
  }
}
```

- [ ] **Step 2: Update server.ts if needed**

In `sidecar/src/server.ts`, update any direct `services.claudian` references. The REST endpoints (`/health`, `/settings`, `/sessions`) use `services.getSettings()` and `services.storage` -- these don't need changes. Verify no compile errors remain.

- [ ] **Step 3: Verify sidecar compiles cleanly**

Run: `cd ~/w/archivist-logseq/sidecar && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
cd ~/w/archivist-logseq
git add sidecar/src/ws/handler.ts sidecar/src/server.ts
git commit -m "feat: route all handler messages through SessionRouter by tabId"
```

---

### Task 3: Update SidecarClient to Send tabId

**Files:**
- Modify: `src/inquiry/SidecarClient.ts`

- [ ] **Step 1: Add tabId to all send methods**

In `src/inquiry/SidecarClient.ts`, update every `send*` method to take `tabId: string` as the first parameter and include it in the message payload. All 19 send methods need this change:

`sendQuery(tabId, text, options?)`, `sendInterrupt(tabId)`, `sendApprove(tabId, toolCallId)`, `sendDeny(tabId, toolCallId)`, `sendAllowAlways(tabId, toolCallId, pattern)`, `sendSessionList(tabId)`, `sendSessionResume(tabId, sessionId)`, `sendSessionFork(tabId, sessionId, messageIndex)`, `sendSessionRewind(tabId, sessionId, messageIndex)`, `sendSettingsGet(tabId)`, `sendSettingsUpdate(tabId, patch)`, `sendMcpList(tabId)`, `sendMcpUpdate(tabId, config)`, `sendCommandList(tabId)`, `sendPlanApprove(tabId, toolCallId)`, `sendPlanApproveNewSession(tabId, toolCallId, planContent)`, `sendPlanFeedback(tabId, toolCallId, text)`, `sendAskUserAnswer(tabId, toolCallId, answers)`, `sendAskUserDismiss(tabId, toolCallId)`.

Add new: `sendTabDestroy(tabId)`.

- [ ] **Step 2: Add tab-filtered message subscription**

Add a method to subscribe to messages for a specific tab:

```typescript
onTabMessage(tabId: string, listener: (msg: ServerMessage) => void): () => void {
  const filtered = (msg: ServerMessage) => {
    if (!(msg as any).tabId || (msg as any).tabId === tabId) {
      listener(msg);
    }
  };
  return this.onMessage(filtered);
}
```

- [ ] **Step 3: Commit**

```bash
cd ~/w/archivist-logseq
git add src/inquiry/SidecarClient.ts
git commit -m "feat: add tabId to all SidecarClient send methods"
```

---

### Task 4: Model Normalization

**Files:**
- Modify: `src/inquiry/ui/InputToolbar.ts`
- Modify: `src/inquiry/ui/ChatView.ts`

- [ ] **Step 1: Fix InputToolbar model list**

In `src/inquiry/ui/InputToolbar.ts`, replace the hardcoded `DEFAULT_MODELS` array (lines ~36-38):

```typescript
// Replace full API strings with shorthand matching sidecar core/types/models.ts:
const DEFAULT_MODELS: ModelOption[] = [
  { value: 'haiku', label: 'Haiku', description: 'Fast and efficient' },
  { value: 'sonnet', label: 'Sonnet', description: 'Balanced performance' },
  { value: 'opus', label: 'Opus', description: 'Most capable' },
  { value: 'opus[1m]', label: 'Opus (1M)', description: 'Most capable (1M context)' },
];
```

- [ ] **Step 2: Fix isAdaptiveThinkingModel stub**

In `src/inquiry/ui/InputToolbar.ts`, replace the stub that always returns true:

```typescript
function isAdaptiveThinkingModel(model: string): boolean {
  const shortNames = ['haiku', 'sonnet', 'sonnet[1m]', 'opus', 'opus[1m]'];
  return shortNames.includes(model) || /claude-(haiku|sonnet|opus)-/.test(model);
}
```

- [ ] **Step 3: Fix default model in ChatView**

In `src/inquiry/ui/ChatView.ts`, change `cachedSettings.model` from `'claude-sonnet-4-20250514'` to `'opus'` (line ~91).

- [ ] **Step 4: Search for remaining hardcoded model strings**

Run: `grep -r 'claude-sonnet-4\|claude-opus-4\|claude-haiku' src/inquiry/ --include='*.ts' -l`

Fix any files found to use shorthand names.

- [ ] **Step 5: Commit**

```bash
cd ~/w/archivist-logseq
git add src/inquiry/ui/InputToolbar.ts src/inquiry/ui/ChatView.ts
git commit -m "fix: normalize model names to shorthand matching sidecar core"
```

---

## Phase B: Foundation (Plugin Architecture)

### Task 5: Port Tab Architecture from Obsidian

**Files:**
- Create: `src/inquiry/tabs/types.ts`
- Create: `src/inquiry/tabs/Tab.ts`
- Create: `src/inquiry/tabs/TabManager.ts`
- Modify: `src/inquiry/ui/ChatView.ts`

This is the critical architecture fix. ChatView currently reimplements controller logic inline and doesn't use InputController, ConversationController, or MessageRenderer.

- [ ] **Step 1: Copy tab types from Obsidian**

Copy `~/w/archivist-obsidian/src/inquiry/features/chat/tabs/types.ts` to `~/w/archivist-logseq/src/inquiry/tabs/types.ts`.

Adapt:
1. Remove `Component` import (Obsidian-specific). Replace `TabManagerViewHost extends Component` with a simpler interface that has no-op lifecycle methods.
2. Change `TabData.service` type: since `ClaudianService` lives in the sidecar, replace with `serviceInitialized: boolean`. The plugin communicates via `SidecarClient`, not direct service calls.
3. Remove `InlineEditService` from `TabServices` (excluded from scope).
4. Remove `BrowserSelectionController` and `CanvasSelectionController` from `TabControllers`.
5. Keep: `TabDOMElements`, `PersistedTabState`, `PersistedTabManagerState`, `TabManagerCallbacks`, `TabBarItem`, constants, `generateTabId()`.

- [ ] **Step 2: Port Tab.ts from Obsidian**

Copy `~/w/archivist-obsidian/src/inquiry/features/chat/tabs/Tab.ts` to `~/w/archivist-logseq/src/inquiry/tabs/Tab.ts`.

Key adaptations:
1. Remove all `App`, `Plugin`, `Component` references.
2. Remove `ClaudianService` instantiation -- sidecar handles this. The tab just tracks `serviceInitialized: boolean`.
3. Remove `InlineEditService`, `BrowserSelectionController`, `CanvasSelectionController`.
4. Replace `setIcon()` calls with inline Lucide SVGs from `shared/icons.ts`.
5. Replace `MarkdownRenderer.render()` with `renderMarkdownToEl()` from `rendering/markdown.ts`.
6. `initializeTabControllers()` creates StreamController, InputController, ConversationController, NavigationController, SelectionController -- wire them to use `SidecarClient` via `tab.tabId`.
7. Wire `StreamController.setRendererBridge()` to `renderMarkdownToEl()` in `initializeTabControllers()`.
8. `buildTabDOM()` creates: messagesWrapper, messagesEl, welcomeEl, statusPanelContainer, inputContainer, navRow, inputWrapper, contextRow, RichInput.

- [ ] **Step 3: Port TabManager.ts from Obsidian**

Copy `~/w/archivist-obsidian/src/inquiry/features/chat/tabs/TabManager.ts` to `~/w/archivist-logseq/src/inquiry/tabs/TabManager.ts`.

Key adaptations:
1. Constructor takes `{ client: SidecarClient, doc: Document, containerEl: HTMLElement }` instead of `InquiryModule`.
2. Remove `McpServerManager` dependency (lives in sidecar).
3. Tab creation calls `createTab()` from `Tab.ts`.
4. Service initialization sets `tab.serviceInitialized = true` (sidecar creates `ClaudianService` lazily via `SessionRouter`).
5. Keep: max tabs enforcement, fork orchestration, title tracking, tab bar updates, scroll position preservation.

- [ ] **Step 4: Rewrite ChatView to delegate to TabManager**

Slim `ChatView.ts` from 711 lines to ~200:
1. Build the outer DOM shell (panel layout with header, content area).
2. Create `TabManager` and `TabBar`.
3. Wire `SidecarClient` message routing to the active tab via `client.onTabMessage(activeTabId, ...)`.
4. Handle global messages (settings, connection ready) that aren't tab-specific.
5. Remove all inline `handleSend()`, `renderUserMessage()`, `renderAssistantMessage()`, and per-tab state tracking -- that now lives in `Tab.ts` controllers.

- [ ] **Step 5: Fix all import paths and verify compilation**

Run: `cd ~/w/archivist-logseq && npx tsc --noEmit`

Fix any import path or type errors.

- [ ] **Step 6: Commit**

```bash
cd ~/w/archivist-logseq
git add src/inquiry/tabs/ src/inquiry/ui/ChatView.ts
git commit -m "feat: port TabManager/Tab architecture from Obsidian"
```

---

### Task 6: Wire MessageRenderer and StreamController Bridge

**Files:**
- Modify: `src/inquiry/tabs/Tab.ts`
- Modify: `src/inquiry/controllers/StreamController.ts`

- [ ] **Step 1: Verify rendererBridge wiring in Tab initialization**

In `src/inquiry/tabs/Tab.ts`, inside `initializeTabControllers()`, verify that after creating `StreamController` and `MessageRenderer`, the bridge is wired:

```typescript
streamController.setRendererBridge({
  renderContent: (el: HTMLElement, markdown: string) => {
    return renderMarkdownToEl(el, markdown);
  },
  addTextCopyButton: (el: HTMLElement, text: string) => {
    renderer.addCopyButton(el, text);
  },
});
```

If this wasn't included in Task 5 Step 2, add it now.

- [ ] **Step 2: Verify StreamController uses the bridge**

Read `src/inquiry/controllers/StreamController.ts` fully. Find every place that checks `this.rendererBridge`:
- Text appending should use `rendererBridge.renderContent()` to re-render accumulated markdown
- Fallback to `textEl.textContent` only when bridge is null

Fix any code paths that bypass the bridge.

- [ ] **Step 3: Build and test**

```bash
cd ~/w/archivist-logseq && npm run build
```

Start sidecar, open chat, send a message with markdown. Verify formatted rendering.

- [ ] **Step 4: Commit**

```bash
cd ~/w/archivist-logseq
git add src/inquiry/tabs/Tab.ts src/inquiry/controllers/StreamController.ts
git commit -m "fix: wire StreamController rendererBridge for markdown rendering"
```

---

### Task 7: CSS Bug Fixes

**Files:**
- Modify: `src/styles/archivist-inquiry.css`

- [ ] **Step 1: Fix messages starting at top**

The `.archivist-inquiry-messages` container (line ~98) uses `display: flex; flex-direction: column; flex: 1`. Messages should start at top. Check for conflicting rules:
1. Search for any `justify-content: center` or `justify-content: flex-end` on messages containers (both `.archivist-inquiry-messages` and any `.claudian-messages` variants in the ported CSS section below line 384).
2. Check if the welcome element has `margin: auto` or similar that could push messages down.
3. Fix by adding explicit `justify-content: flex-start` to the messages container.

- [ ] **Step 2: Fix tab bar layout**

Compare Obsidian's `~/w/archivist-obsidian/src/inquiry/style/components/tab-bar.css` with lines 525-640 of `archivist-inquiry.css`. Copy any missing or different rules, applying the CSS variable mapping:
- `var(--background-primary)` -> `var(--ls-primary-background-color)`
- `var(--background-secondary)` -> `var(--ls-secondary-background-color)`
- `var(--text-normal)` -> `var(--ls-primary-text-color)`
- `var(--text-muted)` -> `var(--ls-secondary-text-color)`
- `var(--interactive-accent)` -> `var(--ls-active-primary-color)`
- `var(--background-modifier-border)` -> `var(--ls-border-color)`

- [ ] **Step 3: Build and verify visually**

```bash
cd ~/w/archivist-logseq && npm run build
```

Open Logseq, verify messages start at top, tab bar renders correctly.

- [ ] **Step 4: Commit**

```bash
cd ~/w/archivist-logseq
git add src/styles/archivist-inquiry.css
git commit -m "fix: messages start at top, fix tab bar layout"
```

---

### Task 8: Fix Remaining Bugs (Images, Welcome Per-Tab)

**Files:**
- Modify: `sidecar/src/ws/handler.ts`
- Modify: `src/inquiry/tabs/Tab.ts`

- [ ] **Step 1: Fix images ignored in queries**

In `sidecar/src/ws/handler.ts`, in `handleQuery()`, find where query options are built. Change the images parameter from `undefined` to `message.images`:

```typescript
// Find the line that passes images to the query and change undefined to message.images
```

- [ ] **Step 2: Verify welcome element is per-tab**

In `Tab.ts`, `buildTabDOM()` should create the welcome element inside the tab's `messagesEl`. Verify:
1. Welcome element is a child of `tab.dom.messagesEl` (not a shared container)
2. `ChatState.onMessagesChanged` toggles welcome visibility per-tab
3. Each tab independently shows/hides its own welcome

- [ ] **Step 3: Commit**

```bash
cd ~/w/archivist-logseq
git add sidecar/src/ws/handler.ts src/inquiry/tabs/Tab.ts
git commit -m "fix: pass images in queries, welcome element per-tab"
```

---

## Phase C: Wiring

### Task 9: Wire Session Operations (Resume/Fork/Rewind)

**Files:**
- Modify: `sidecar/src/ws/handler.ts`
- Modify: `src/inquiry/controllers/ConversationController.ts`

- [ ] **Step 1: Wire sidecar session stubs**

In `sidecar/src/ws/handler.ts`, replace the console.log stubs. Read the full `ClaudianService.ts` to find `ensureReady()`, `pendingForkSession`, and `pendingResumeAt`. Copy the patterns from Obsidian's `ConversationController.ts`:

For `session.resume`: call `claudian.ensureReady({ sessionId })`, then send `session.loaded` response.

For `session.fork`: set `claudian.pendingForkSession = { sessionId, messageId }`, send `session.loaded`.

For `session.rewind`: set `claudian.pendingResumeAt = { sessionId, messageId }`, send `session.loaded`.

- [ ] **Step 2: Fix ConversationController message rendering**

In `ConversationController.ts`, `onSessionLoaded()` currently renders messages as plain `textContent`. Fix to use `MessageRenderer.renderMessages()`:

```typescript
onSessionLoaded(conversation: unknown): void {
  // ... existing setup ...
  // Replace textContent rendering with MessageRenderer:
  if (this.renderer) {
    this.renderer.renderMessages(messages, () => this.getGreeting());
  }
}
```

- [ ] **Step 3: Commit**

```bash
cd ~/w/archivist-logseq
git add sidecar/src/ws/handler.ts src/inquiry/controllers/ConversationController.ts
git commit -m "feat: wire session resume/fork/rewind through sidecar"
```

---

### Task 10: Wire Approval Flow

**Files:**
- Modify: `sidecar/src/ws/handler.ts`
- Modify: `src/inquiry/controllers/InputController.ts`

- [ ] **Step 1: Wire sidecar approval forwarding**

In `sidecar/src/ws/handler.ts`, before calling `claudian.query()` in `handleQuery`, set up approval callbacks that forward over WebSocket. Read Obsidian's `Tab.ts` `setupServiceCallbacks()` for exact callback signatures.

Set `claudian.setApprovalCallback(...)` to send `approval.request` to client and wait via `services.pendingApprovals.create(toolCallId)`.

Set `claudian.setAskUserQuestionCallback(...)` to send `askuser.question` and wait via `services.pendingAskUser.create(toolCallId)`.

Set `claudian.setExitPlanModeCallback(...)` to send `plan_mode.request` and wait via `services.pendingPlanDecisions.create(toolCallId)`.

- [ ] **Step 2: Wire plugin-side approval handling**

In `src/inquiry/controllers/InputController.ts`, replace the TODO stubs at lines 205-215. Copy the approval flow from Obsidian's `InputController.ts` (lines 770-926):

1. `handleApprovalRequest()` -- renders inline approval UI with approve/deny/allow-always buttons
2. `handleAskUserQuestion()` -- renders `InlineAskUserQuestion` card
3. `handleExitPlanMode()` -- renders `InlineExitPlanMode` card

Wire these to the tab's message subscription in `Tab.ts`. When the tab receives an `approval.request`, `askuser.question`, or `plan_mode.request` message, call the appropriate handler.

- [ ] **Step 3: Commit**

```bash
cd ~/w/archivist-logseq
git add sidecar/src/ws/handler.ts src/inquiry/controllers/InputController.ts src/inquiry/tabs/Tab.ts
git commit -m "feat: wire approval/askuser/planmode flow end-to-end"
```

---

### Task 11: Wire Settings Sync + MCP Management

**Files:**
- Modify: `sidecar/src/ws/handler.ts`

- [ ] **Step 1: Wire settings.update**

In `sidecar/src/ws/handler.ts`, replace the stub:

```typescript
case 'settings.update': {
  const patch = message.patch as Partial<ClaudianSettings>;
  const currentSettings = services.getSettings();
  Object.assign(currentSettings, patch);
  await services.storage.saveClaudianSettings(currentSettings);

  // Update the tab's service if model or effort changed
  const claudian = services.sessionRouter.get(message.tabId);
  if (claudian && patch.model) claudian.updateModel(patch.model);
  if (claudian && patch.effortLevel) claudian.updateThinking(patch.effortLevel);

  send(ws, { type: 'settings.current', tabId: message.tabId, claudian: currentSettings, cc: {} });
  break;
}
```

- [ ] **Step 2: Wire mcp.list and mcp.update**

Replace stubs with actual `McpServerManager` calls. Add `mcp.list_result` to the protocol if not present.

- [ ] **Step 3: Commit**

```bash
cd ~/w/archivist-logseq
git add sidecar/src/ws/handler.ts sidecar/src/ws/protocol.ts src/inquiry/protocol.ts
git commit -m "feat: wire settings sync and MCP management"
```

---

### Task 12: Notification System + Connection Status

**Files:**
- Create: `src/inquiry/ui/ToastRenderer.ts`
- Modify: `src/inquiry/InquiryPanel.ts`
- Modify: `src/inquiry/ui/ChatView.ts`

- [ ] **Step 1: Create ToastRenderer**

Create `src/inquiry/ui/ToastRenderer.ts` with a `show(message, level)` method that renders toast notifications. Support `info` (5s auto-dismiss), `warning` (8s), `error` (persistent, click to dismiss). The CSS already exists in `archivist-inquiry.css` lines 275-341.

- [ ] **Step 2: Wire notification messages**

In `ChatView` or `InquiryPanel`, subscribe to `notification` messages from `SidecarClient` and call `toastRenderer.show()`.

- [ ] **Step 3: Wire connection status indicator**

In `src/inquiry/InquiryPanel.ts`, wire `SidecarClient.onStateChange()` to update the connection indicator dot:
- `connected` -> green (`archivist-connection-connected`)
- `connecting`/`reconnecting` -> yellow (`archivist-connection-connecting`)
- `disconnected` -> red (`archivist-connection-disconnected`)

CSS already exists at lines 214-270.

- [ ] **Step 4: Commit**

```bash
cd ~/w/archivist-logseq
git add src/inquiry/ui/ToastRenderer.ts src/inquiry/InquiryPanel.ts src/inquiry/ui/ChatView.ts
git commit -m "feat: add toast notification system and connection status indicator"
```

---

## Phase D: Streaming & Plan Mode

### Task 13: Plan Mode

**Files:**
- Modify: `src/inquiry/controllers/InputController.ts`
- Modify: `src/inquiry/controllers/StreamController.ts`
- Modify: `src/inquiry/state/types.ts`

- [ ] **Step 1: Fix PermissionMode type**

In `src/inquiry/state/types.ts`, update `PermissionMode` to match Obsidian:
```typescript
export type PermissionMode = 'unleashed' | 'guarded';
```

Add plan mode fields to `ChatStateData` if not present: `pendingNewSessionPlan: string | null`, `planFilePath: string | null`.

- [ ] **Step 2: Add Shift+Tab toggle in InputController**

Copy `togglePlanMode()` from Obsidian's InputController. Add the keyboard handler:
```typescript
if (e.key === 'Tab' && e.shiftKey) {
  e.preventDefault();
  this.togglePlanMode();
}
```

- [ ] **Step 3: Detect EnterPlanMode in StreamController**

Add `EnterPlanMode` tool detection in `handleToolUse()`. Copy plan mode sync logic from Obsidian's StreamController.

- [ ] **Step 4: Commit**

```bash
cd ~/w/archivist-logseq
git add src/inquiry/controllers/InputController.ts src/inquiry/controllers/StreamController.ts src/inquiry/state/types.ts
git commit -m "feat: add plan mode with Shift+Tab toggle and stream detection"
```

---

### Task 14: Streaming Completeness

**Files:**
- Modify: `src/inquiry/controllers/StreamController.ts`
- Modify: `src/inquiry/rendering/ToolCallRenderer.ts`

- [ ] **Step 1: Wire subagent chunk routing**

In `StreamController`, replace the `stream.subagent` TODO. Copy subagent chunk routing from Obsidian's `StreamController.ts`: check `parentToolUseId`, route to `SubagentRenderer`, track sync/async state.

- [ ] **Step 2: Wire D&D skeleton streaming**

In `ToolCallRenderer.ts`, copy `renderBlockSkeleton` logic from Obsidian: `activeSkeletons` map, partial YAML parsing, progressive skeleton preview.

- [ ] **Step 3: Wire blocked content rendering**

In `StreamController`, handle `stream.blocked` by rendering an inline blocked message.

- [ ] **Step 4: Commit**

```bash
cd ~/w/archivist-logseq
git add src/inquiry/controllers/StreamController.ts src/inquiry/rendering/ToolCallRenderer.ts
git commit -m "feat: complete streaming - subagent routing, D&D skeletons, blocked content"
```

---

## Phase E: Features (Port from Obsidian)

### Task 15: Tool Handling Parity

**Files:**
- Create: `src/inquiry/core/tools/toolNames.ts`
- Create: `src/inquiry/core/tools/toolIcons.ts`
- Create: `src/inquiry/core/tools/toolInput.ts`
- Create: `src/inquiry/core/tools/todo.ts`
- Modify: `src/inquiry/rendering/ToolCallRenderer.ts`

- [ ] **Step 1: Copy tool modules from Obsidian**

These are pure logic files with no Obsidian dependencies:
```bash
mkdir -p ~/w/archivist-logseq/src/inquiry/core/tools
cp ~/w/archivist-obsidian/src/inquiry/core/tools/toolNames.ts ~/w/archivist-logseq/src/inquiry/core/tools/
cp ~/w/archivist-obsidian/src/inquiry/core/tools/toolIcons.ts ~/w/archivist-logseq/src/inquiry/core/tools/
cp ~/w/archivist-obsidian/src/inquiry/core/tools/toolInput.ts ~/w/archivist-logseq/src/inquiry/core/tools/
cp ~/w/archivist-obsidian/src/inquiry/core/tools/todo.ts ~/w/archivist-logseq/src/inquiry/core/tools/
```

- [ ] **Step 2: Update ToolCallRenderer imports**

Replace the local inline `getToolIcon()` function in `ToolCallRenderer.ts` with imports from `core/tools/toolIcons.ts`.

- [ ] **Step 3: Commit**

```bash
cd ~/w/archivist-logseq
git add src/inquiry/core/tools/ src/inquiry/rendering/ToolCallRenderer.ts
git commit -m "feat: copy tool handling modules from Obsidian"
```

---

### Task 16: D&D Features

**Files:**
- Create: `src/inquiry/constants.ts`
- Modify: `src/inquiry/controllers/StreamController.ts`
- Modify: `src/inquiry/rendering/DndEntityRenderer.ts`
- Modify: `src/inquiry/rendering/MessageRenderer.ts`

- [ ] **Step 1: Copy flavor texts and constants from Obsidian**

Copy `~/w/archivist-obsidian/src/inquiry/features/chat/constants.ts` to `~/w/archivist-logseq/src/inquiry/constants.ts`. Contains `LOGO_SVG`, `COMPLETION_FLAVOR_WORDS` (15 entries), `ThinkingFlavor` interface, `FLAVOR_TEXTS` (50 D&D-themed entries).

- [ ] **Step 2: Update StreamController to use full flavor texts**

Replace the local 6-entry `FLAVOR_TEXTS` in `StreamController.ts` with the import from the new constants file.

- [ ] **Step 3: Register Archivist MCP server for D&D generation tools**

In the sidecar's `McpServerManager` configuration, register the Archivist MCP server with `generate_monster`, `generate_spell`, `generate_item` tools. Copy the MCP server config from Obsidian's `.claude/claudian-settings.json`. Wire the `/generate` slash command to trigger these MCP tool calls via the sidecar.

- [ ] **Step 4: Wire D&D code fence rendering and compendium buttons**

In `MessageRenderer.ts`, verify `replaceDndCodeFences()` is called after markdown rendering. In `DndEntityRenderer.ts`, add "Copy & Save to Compendium" and "Update" buttons. Copy from Obsidian.

- [ ] **Step 5: Commit**

```bash
cd ~/w/archivist-logseq
git add src/inquiry/constants.ts src/inquiry/controllers/StreamController.ts src/inquiry/rendering/DndEntityRenderer.ts src/inquiry/rendering/MessageRenderer.ts
git commit -m "feat: port D&D flavor texts, MCP generation tools, code fence rendering, compendium buttons"
```

---

### Task 17: Rewind & Fork

**Files:**
- Modify: `src/inquiry/rendering/MessageRenderer.ts`
- Create: `src/inquiry/shared/modals/ForkTargetModal.ts`
- Modify: `src/inquiry/state/types.ts`

- [ ] **Step 1: Add rewind and fork buttons to user messages**

In `MessageRenderer.ts`, copy rewind and fork button creation from Obsidian. Add SVG icons from `shared/icons.ts`. Wire click handlers to call `onRewind(messageId)` and `onFork(messageId, messageIndex)` callbacks.

- [ ] **Step 2: Wire rewind action**

On click: truncate messages in ChatState, restore content to input, send `client.sendSessionRewind(tabId, sessionId, messageIndex)`.

- [ ] **Step 3: Port ForkTargetModal**

Copy from Obsidian, adapt to use Logseq's injected modal system. Modal presents "Fork to new tab" and "Fork in current tab".

- [ ] **Step 4: Add forkSource to Conversation type**

In `src/inquiry/state/types.ts`, add: `forkSource?: { sessionId: string; resumeAt: string }`.

- [ ] **Step 5: Commit**

```bash
cd ~/w/archivist-logseq
git add src/inquiry/rendering/MessageRenderer.ts src/inquiry/shared/modals/ForkTargetModal.ts src/inquiry/state/types.ts
git commit -m "feat: add rewind/fork buttons with ForkTargetModal"
```

---

### Task 18: History Dropdown + Rename + Title Regen

**Files:**
- Modify: `src/inquiry/controllers/ConversationController.ts`
- Modify: `src/inquiry/tabs/Tab.ts`

- [ ] **Step 1: Wire history dropdown**

`ConversationController` already has `toggleHistoryDropdown()`, `updateHistoryDropdown()`, `renderHistoryItems()`. Verify they work now that the controller is instantiated by Tab.ts. Wire the history button in the header to call `toggleHistoryDropdown()`.

- [ ] **Step 2: Add inline rename**

Copy inline rename from Obsidian's ConversationController. Click title to edit, blur/enter saves. Add `session.rename` message to protocol if needed.

- [ ] **Step 3: Add title regeneration button**

Add refresh icon button next to each history item. Click triggers `TitleGenerationService.regenerateTitle()`.

- [ ] **Step 4: Commit**

```bash
cd ~/w/archivist-logseq
git add src/inquiry/controllers/ConversationController.ts src/inquiry/tabs/Tab.ts
git commit -m "feat: wire history dropdown with rename and title regeneration"
```

---

### Task 19: Built-in Slash Commands

**Files:**
- Modify: `src/inquiry/controllers/InputController.ts`
- Modify: `src/inquiry/shared/SlashCommandDropdown.ts`

- [ ] **Step 1: Add built-in command handling**

Add `handleBuiltInCommand(command, args): boolean` to InputController. Handle `/clear`, `/new`, `/resume`, `/fork`, `/generate`, `/search-srd`, `/roll`.

- [ ] **Step 2: Wire SlashCommandDropdown**

Verify the dropdown shows on `/` input, fetches commands from sidecar, includes built-in commands, and executes on selection.

- [ ] **Step 3: Commit**

```bash
cd ~/w/archivist-logseq
git add src/inquiry/controllers/InputController.ts src/inquiry/shared/SlashCommandDropdown.ts
git commit -m "feat: wire built-in slash commands"
```

---

### Task 20: StatusPanel, Bang-Bash, Instruction Mode

**Files:**
- Modify: `src/inquiry/ui/StatusPanel.ts`
- Modify: `src/inquiry/ui/BangBashMode.ts`
- Modify: `src/inquiry/ui/InstructionMode.ts`

- [ ] **Step 1: Wire StatusPanel TodoWrite rendering**

Route `TodoWrite` tool calls from StreamController to `ChatState.currentTodos`. Wire `ChatState.onTodosChanged` to StatusPanel re-render. Copy `TodoListRenderer` logic from Obsidian.

- [ ] **Step 2: Wire Bang-Bash execution**

Wire `!command` input to sidecar's `/commands` endpoint. Display output in StatusPanel command panel.

- [ ] **Step 3: Wire Instruction Mode service**

Copy `InstructionRefineService` from Obsidian. Add `instruction.refine` message to protocol. Wire `#instruction` input to sidecar cold-start query.

- [ ] **Step 4: Commit**

```bash
cd ~/w/archivist-logseq
git add src/inquiry/ui/StatusPanel.ts src/inquiry/ui/BangBashMode.ts src/inquiry/ui/InstructionMode.ts
git commit -m "feat: wire StatusPanel, bang-bash, instruction mode"
```

---

### Task 21: Context Features

**Files:**
- Modify: `src/inquiry/shared/MentionDropdown.ts`
- Modify: `src/inquiry/ui/InputToolbar.ts`
- Create: `src/inquiry/controllers/EditorSelectionController.ts`

- [ ] **Step 1: Wire file @-mention dropdown**

Adapt `MentionDropdown.ts` to fetch pages from Logseq (`logseq.Editor.getAllPages()`), plus agents and MCP servers from sidecar.

- [ ] **Step 2: Add ExternalContextSelector and McpServerSelector**

Copy from Obsidian's `InputToolbar.ts`. ExternalContextSelector uses text input for path entry (no Electron dialog). McpServerSelector fetches from sidecar.

- [ ] **Step 3: Create EditorSelectionController**

Create `src/inquiry/controllers/EditorSelectionController.ts` that polls `logseq.Editor.getEditingBlockContent()` every 250ms and `logseq.Editor.getCurrentPage()` for current note context.

- [ ] **Step 4: Commit**

```bash
cd ~/w/archivist-logseq
git add src/inquiry/shared/MentionDropdown.ts src/inquiry/ui/InputToolbar.ts src/inquiry/controllers/EditorSelectionController.ts
git commit -m "feat: wire file mentions, external dirs, MCP selector, editor selection"
```

---

### Task 22: Message Features

**Files:**
- Modify: `src/inquiry/rendering/MessageRenderer.ts`
- Modify: `src/inquiry/controllers/StreamController.ts`

- [ ] **Step 1: Add file link processing**

Copy `processFileLinks()` from Obsidian. Adapt to use `logseq.App.pushState('page', { name })` for navigation.

- [ ] **Step 2: Add image embed rendering**

Copy `replaceImageEmbedsWithHtml()` from Obsidian. Add click handler for full-size modal.

- [ ] **Step 3: Add compact boundary rendering**

Handle `stream.compact_boundary` in StreamController -- render visual separator.

- [ ] **Step 4: Commit**

```bash
cd ~/w/archivist-logseq
git add src/inquiry/rendering/MessageRenderer.ts src/inquiry/controllers/StreamController.ts
git commit -m "feat: add file links, image embeds, compact boundary"
```

---

## Phase F: Polish

### Task 23: Welcome Screen + Owl Icon

**Files:**
- Create: `src/inquiry/shared/owl-icon.ts`
- Modify: `src/inquiry/tabs/Tab.ts`
- Modify: `src/inquiry/controllers/ConversationController.ts`

- [ ] **Step 1: Copy owl icon**

```bash
cp ~/w/archivist-obsidian/src/ui/components/owl-icon.ts ~/w/archivist-logseq/src/inquiry/shared/owl-icon.ts
```

No Obsidian dependencies -- direct copy.

- [ ] **Step 2: Add owl icon to welcome screen and personalized greetings**

Wire `createOwlIcon(48)` into the welcome element. Copy greeting variety from Obsidian, including `userName` personalization.

- [ ] **Step 3: Commit**

```bash
cd ~/w/archivist-logseq
git add src/inquiry/shared/owl-icon.ts src/inquiry/tabs/Tab.ts src/inquiry/controllers/ConversationController.ts
git commit -m "feat: add owl icon and personalized greetings"
```

---

### Task 24: Settings Parity

**Files:**
- Modify: `src/inquiry/ui/SettingsPanel.ts`

- [ ] **Step 1: Add all missing settings**

Add UI controls for every setting from the spec table: `userName`, `permissionMode`, `enableBlocklist`, `allowExternalAccess`, `enableBangBash`, `enableOpus1M`, `enableSonnet1M`, `enableAutoScroll`, `maxTabs`, `tabBarPosition`, `hiddenSlashCommands`, `systemPrompt`, `allowedExportPaths`, `excludedTags`, `mediaFolder`, `persistentExternalContextPaths`, `envSnippets`, `customContextLimits`, `keyboardNavigation`.

Group into sections. Each control calls `client.sendSettingsUpdate(tabId, { key: value })` on change.

- [ ] **Step 2: Commit**

```bash
cd ~/w/archivist-logseq
git add src/inquiry/ui/SettingsPanel.ts
git commit -m "feat: add full settings parity with Obsidian"
```

---

### Task 25: Tab Persistence + Title Generation

**Files:**
- Modify: `src/inquiry/tabs/TabManager.ts`
- Modify: `src/inquiry/services/TitleGenerationService.ts`
- Modify: `sidecar/src/server.ts`

- [ ] **Step 1: Add tab state persistence**

Add `saveTabState()` and `restoreTabState()` to TabManager. Save to sidecar via `POST /tabs/state` (store in `<graph>/.archivist/tabs.json`). Restore on init. Add `GET/POST /tabs/state` REST endpoints to sidecar.

- [ ] **Step 2: Wire title generation with Haiku model**

Verify `TitleGenerationService` triggers after first exchange, uses `model: 'haiku'`, and updates tab title. Copy flow from Obsidian.

- [ ] **Step 3: Commit**

```bash
cd ~/w/archivist-logseq
git add src/inquiry/tabs/TabManager.ts src/inquiry/services/TitleGenerationService.ts sidecar/src/server.ts
git commit -m "feat: add tab persistence and Haiku title generation"
```

---

### Task 26: CSS Polish + Accessibility

**Files:**
- Modify: `src/styles/archivist-inquiry.css`

- [ ] **Step 1: Copy missing CSS modules from Obsidian**

Read and append these Obsidian CSS files to `archivist-inquiry.css`, applying the variable mapping:
- `toolbar/external-context.css`
- `toolbar/mcp-selector.css`
- `modals/fork-target.css`
- `features/resume-session.css`
- `features/file-link.css`
- `features/image-embed.css`
- `features/image-modal.css`
- `accessibility.css` (focus-visible styles)
- Settings CSS: `env-snippets.css`, `mcp-settings.css`, `mcp-modal.css`

- [ ] **Step 2: Add ARIA labels**

Audit interactive elements in the TypeScript files and add `setAttribute('aria-label', '...')` for: history buttons, tab close buttons, send/stop, model selector, effort selector, toolbar actions.

- [ ] **Step 3: Commit**

```bash
cd ~/w/archivist-logseq
git add src/styles/archivist-inquiry.css
git commit -m "feat: CSS polish and accessibility from Obsidian"
```

---

### Task 27: Final Build + Smoke Test

**Files:** None (verification only)

- [ ] **Step 1: Build everything**

```bash
cd ~/w/archivist-logseq && npm run build
cd ~/w/archivist-logseq/sidecar && npm run build
```

- [ ] **Step 2: Run tests**

```bash
cd ~/w/archivist-logseq && npx vitest run
cd ~/w/archivist-logseq/sidecar && npx vitest run
```

- [ ] **Step 3: Smoke test**

Start sidecar, open Logseq, verify:
1. Messages start at top
2. Default model is Opus
3. Tabs work (create, switch, close, persist across reload)
4. Markdown renders during streaming
5. D&D thinking flavor texts appear
6. Welcome screen has owl icon and greeting
7. History dropdown shows past conversations
8. Rewind/Fork buttons on user messages
9. Plan mode (Shift+Tab toggle)
10. Toast notifications appear
11. Connection indicator dot (green/yellow/red)
12. @-mention dropdown works
13. Slash command dropdown works
14. Tab titles auto-generated via Haiku
15. Context usage meter shows token counts

- [ ] **Step 4: Commit any fixes**

```bash
cd ~/w/archivist-logseq
git add -A
git commit -m "fix: integration test fixes"
```
