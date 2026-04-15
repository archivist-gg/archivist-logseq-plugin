/**
 * Tab system types — adapted from Obsidian's tab types.
 *
 * Changes from Obsidian:
 * - Removed `Component`, `WorkspaceLeaf` (Obsidian-specific lifecycle).
 * - `TabData.service` replaced with `serviceInitialized: boolean` (sidecar handles ClaudianService).
 * - Removed `InlineEditService` from `TabServices` (not in scope).
 * - Removed `BrowserSelectionController` and `CanvasSelectionController` from `TabControllers`.
 * - `TabManagerViewHost` is a simple interface with no-op lifecycle methods.
 * - UI components adapted to Logseq versions.
 */

import type {
  ConversationController,
  InputController,
  NavigationController,
  SelectionController,
  StreamController,
} from '../controllers';
import type { MessageRenderer } from '../rendering/MessageRenderer';
import type { ChatState } from '../state/ChatState';
import type {
  RichInput,
  SendButton,
  StatusPanel,
  FileContextManager,
  ImageContextManager,
  ModelSelector,
  ThinkingBudgetSelector,
  ContextUsageMeter,
  ExternalContextSelector,
  McpServerSelector,
  InstructionModeManager,
  BangBashModeManager,
} from '../ui';

/**
 * Default number of tabs allowed.
 */
export const DEFAULT_MAX_TABS = 10;

/**
 * Minimum number of tabs allowed (settings floor).
 */
export const MIN_TABS = 3;

/**
 * Maximum number of tabs allowed (settings ceiling).
 */
export const MAX_TABS = 10;

/**
 * Minimum max-height for textarea in pixels.
 */
export const TEXTAREA_MIN_MAX_HEIGHT = 150;

/**
 * Percentage of view height for max textarea height.
 */
export const TEXTAREA_MAX_HEIGHT_PERCENT = 0.55;

/**
 * Minimal interface for the view host used by TabManager.
 * Replaces Obsidian's Component + WorkspaceLeaf.
 */
export interface TabManagerViewHost {
  /** Gets the tab manager instance (used for cross-view coordination). */
  getTabManager(): TabManagerInterface | null;
}

/**
 * Minimal interface for TabManager methods used by external code.
 */
export interface TabManagerInterface {
  /** Switches to a specific tab. */
  switchToTab(tabId: TabId): Promise<void>;

  /** Gets all tabs. */
  getAllTabs(): TabData[];
}

/** Tab identifier type. */
export type TabId = string;

/** Generates a unique tab ID. */
export function generateTabId(): TabId {
  return `tab-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Controllers managed per-tab.
 * Each tab has its own set of controllers for independent operation.
 */
export interface TabControllers {
  selectionController: SelectionController | null;
  conversationController: ConversationController | null;
  streamController: StreamController | null;
  inputController: InputController | null;
  navigationController: NavigationController | null;
}

/**
 * UI components managed per-tab.
 */
export interface TabUIComponents {
  fileContextManager: FileContextManager | null;
  imageContextManager: ImageContextManager | null;
  modelSelector: ModelSelector | null;
  thinkingBudgetSelector: ThinkingBudgetSelector | null;
  contextUsageMeter: ContextUsageMeter | null;
  externalContextSelector: ExternalContextSelector | null;
  mcpServerSelector: McpServerSelector | null;
  instructionModeManager: InstructionModeManager | null;
  bangBashModeManager: BangBashModeManager | null;
  statusPanel: StatusPanel | null;
}

/**
 * DOM elements managed per-tab.
 */
export interface TabDOMElements {
  contentEl: HTMLElement;
  messagesEl: HTMLElement;
  welcomeEl: HTMLElement | null;

  /** Container for status panel (fixed between messages and input). */
  statusPanelContainerEl: HTMLElement;

  inputContainerEl: HTMLElement;
  inputWrapper: HTMLElement;
  inputEl: HTMLDivElement;
  richInput: RichInput;
  sendButton: SendButton | null;

  /** Nav row for tab badges and header icons (above input wrapper). */
  navRowEl: HTMLElement;

  /** Context row for file chips and selection indicator (inside input wrapper). */
  contextRowEl: HTMLElement;

  selectionIndicatorEl: HTMLElement | null;

  /** History dropdown for conversation list (per-tab, positioned in messages wrapper). */
  historyDropdownEl: HTMLElement | null;

  /** Cleanup functions for event listeners (prevents memory leaks). */
  eventCleanups: Array<() => void>;
}

/**
 * Represents a single tab in the multi-tab system.
 * Each tab is an independent chat session.
 *
 * Unlike Obsidian, the Logseq tab does NOT hold a ClaudianService instance.
 * The sidecar handles service creation/lifecycle via SessionRouter.
 * The tab just tracks whether the service has been initialized.
 */
export interface TabData {
  /** Unique tab identifier. */
  id: TabId;

  /** Conversation ID bound to this tab (null for new/empty tabs). */
  conversationId: string | null;

  /** Whether the sidecar service for this tab has been initialized. */
  serviceInitialized: boolean;

  /** Per-tab chat state. */
  state: ChatState;

  /** Per-tab controllers. */
  controllers: TabControllers;

  /** Per-tab UI components. */
  ui: TabUIComponents;

  /** Per-tab DOM elements. */
  dom: TabDOMElements;

  /** Per-tab renderer. */
  renderer: MessageRenderer | null;
}

/**
 * Persisted tab state for restoration on plugin reload.
 */
export interface PersistedTabState {
  tabId: TabId;
  conversationId: string | null;
}

/**
 * Tab manager state persisted to storage.
 */
export interface PersistedTabManagerState {
  openTabs: PersistedTabState[];
  activeTabId: TabId | null;
}

/**
 * Callbacks for tab state changes.
 */
export interface TabManagerCallbacks {
  /** Called when a tab is created. */
  onTabCreated?: (tab: TabData) => void;

  /** Called when switching to a different tab. */
  onTabSwitched?: (fromTabId: TabId | null, toTabId: TabId) => void;

  /** Called when a tab is closed. */
  onTabClosed?: (tabId: TabId) => void;

  /** Called when tab streaming state changes. */
  onTabStreamingChanged?: (tabId: TabId, isStreaming: boolean) => void;

  /** Called when tab title changes. */
  onTabTitleChanged?: (tabId: TabId, title: string) => void;

  /** Called when tab attention state changes (approval pending, etc.). */
  onTabAttentionChanged?: (tabId: TabId, needsAttention: boolean) => void;

  /** Called when a tab's conversation changes. */
  onTabConversationChanged?: (tabId: TabId, conversationId: string | null) => void;
}

/**
 * Tab bar item representation for rendering.
 */
export interface TabBarItem {
  id: TabId;
  /** 1-based index for display. */
  index: number;
  title: string;
  isActive: boolean;
  isStreaming: boolean;
  needsAttention: boolean;
  canClose: boolean;
}
