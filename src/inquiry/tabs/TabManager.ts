/**
 * TabManager — Coordinates multiple chat tabs.
 *
 * Ported from Obsidian's TabManager.ts.
 * Key differences:
 * - Constructor takes `{ client, doc, containerEl }` instead of `InquiryModule`.
 * - No `McpServerManager` — lives in sidecar.
 * - No `ClaudianService` instantiation — sidecar handles this via `SessionRouter`.
 * - Service initialization sets `tab.serviceInitialized = true`.
 * - No cross-view coordination (Logseq has a single panel).
 * - Fork/rewind deferred to future tasks.
 */

import type { SidecarClient } from '../SidecarClient';
import type { ToolbarSettings } from '../ui';
import {
  activateTab,
  createTab,
  deactivateTab,
  destroyTab,
  getTabTitle,
  initializeTabControllers,
  initializeTabUI,
  wireTabInputEvents,
} from './Tab';
import type { InitializeTabUIOptions } from './Tab';
import {
  DEFAULT_MAX_TABS,
  MAX_TABS,
  MIN_TABS,
  type PersistedTabManagerState,
  type PersistedTabState,
  type TabBarItem,
  type TabData,
  type TabId,
  type TabManagerCallbacks,
  type TabManagerInterface,
} from './types';

export interface TabManagerOptions {
  client: SidecarClient;
  doc: Document;
  containerEl: HTMLElement;
  callbacks?: TabManagerCallbacks;
  /** Returns cached settings for toolbar display. */
  getSettings: () => ToolbarSettings;
  /** Called when model changes in any tab's toolbar. */
  onModelChange: (model: string) => void;
  /** Called when effort level changes in any tab's toolbar. */
  onEffortLevelChange: (effort: string) => void;
}

/**
 * TabManager coordinates multiple chat tabs.
 */
export class TabManager implements TabManagerInterface {
  private client: SidecarClient;
  private doc: Document;
  private containerEl: HTMLElement;
  private callbacks: TabManagerCallbacks;
  private getSettings: () => ToolbarSettings;
  private onModelChange: (model: string) => void;
  private onEffortLevelChange: (effort: string) => void;

  private tabs: Map<TabId, TabData> = new Map();
  private activeTabId: TabId | null = null;

  /** Guard to prevent concurrent tab switches. */
  private isSwitchingTab = false;

  /**
   * Gets the current max tabs limit.
   * Clamps to MIN_TABS and MAX_TABS bounds.
   */
  private getMaxTabs(): number {
    return Math.max(MIN_TABS, Math.min(MAX_TABS, DEFAULT_MAX_TABS));
  }

  constructor(options: TabManagerOptions) {
    this.client = options.client;
    this.doc = options.doc;
    this.containerEl = options.containerEl;
    this.callbacks = options.callbacks ?? {};
    this.getSettings = options.getSettings;
    this.onModelChange = options.onModelChange;
    this.onEffortLevelChange = options.onEffortLevelChange;
  }

  // ============================================
  // Tab Lifecycle
  // ============================================

  /**
   * Creates a new tab.
   * @param tabId Optional tab ID (for restoration).
   * @returns The created tab, or null if max tabs reached.
   */
  async createTab(tabId?: TabId): Promise<TabData | null> {
    const maxTabs = this.getMaxTabs();
    if (this.tabs.size >= maxTabs) {
      return null;
    }

    const tab = createTab({
      doc: this.doc,
      client: this.client,
      containerEl: this.containerEl,
      tabId,
      onStreamingChanged: (isStreaming) => {
        this.callbacks.onTabStreamingChanged?.(tab.id, isStreaming);
      },
      onTitleChanged: (title) => {
        this.callbacks.onTabTitleChanged?.(tab.id, title);
      },
      onAttentionChanged: (needsAttention) => {
        this.callbacks.onTabAttentionChanged?.(tab.id, needsAttention);
      },
      onConversationIdChanged: (conversationId) => {
        tab.conversationId = conversationId;
        this.callbacks.onTabConversationChanged?.(tab.id, conversationId);
      },
    });

    // Initialize UI components
    initializeTabUI(tab, this.doc, this.client, {
      getSettings: this.getSettings,
      onModelChange: this.onModelChange,
      onEffortLevelChange: this.onEffortLevelChange,
    });

    // Initialize controllers
    initializeTabControllers(tab, this.doc, this.client);

    // Wire input event handlers
    wireTabInputEvents(tab);

    this.tabs.set(tab.id, tab);
    this.callbacks.onTabCreated?.(tab);

    // Auto-switch to the newly created tab
    await this.switchToTab(tab.id);

    return tab;
  }

  /**
   * Switches to a different tab.
   * @param tabId The tab to switch to.
   */
  async switchToTab(tabId: TabId): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      return;
    }

    // Guard against concurrent tab switches
    if (this.isSwitchingTab) {
      return;
    }

    this.isSwitchingTab = true;
    const previousTabId = this.activeTabId;

    try {
      // Deactivate current tab
      if (previousTabId && previousTabId !== tabId) {
        const currentTab = this.tabs.get(previousTabId);
        if (currentTab) {
          deactivateTab(currentTab);
        }
      }

      // Activate new tab
      this.activeTabId = tabId;
      activateTab(tab);

      // Load active state: shows welcome for new tabs, or loads conversation
      if (!tab.conversationId && tab.state.messages.length === 0) {
        void tab.controllers.conversationController?.loadActive();
      }

      this.callbacks.onTabSwitched?.(previousTabId, tabId);
    } finally {
      this.isSwitchingTab = false;
    }
  }

  /**
   * Closes a tab.
   * @param tabId The tab to close.
   * @param force If true, close even if streaming.
   * @returns True if the tab was closed.
   */
  async closeTab(tabId: TabId, force = false): Promise<boolean> {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      return false;
    }

    // Don't close if streaming unless forced
    if (tab.state.isStreaming && !force) {
      return false;
    }

    // If this is the last tab and it's already empty,
    // don't close it - it's already a fresh session.
    if (this.tabs.size === 1 && !tab.conversationId && tab.state.messages.length === 0) {
      return false;
    }

    // Capture tab order BEFORE deletion for fallback calculation
    const tabIdsBefore = Array.from(this.tabs.keys());
    const closingIndex = tabIdsBefore.indexOf(tabId);

    // Notify sidecar to destroy the session for this tab
    this.client.sendTabDestroy(tabId);

    // Destroy tab resources
    await destroyTab(tab);
    this.tabs.delete(tabId);
    this.callbacks.onTabClosed?.(tabId);

    // If we closed the active tab, switch to another
    if (this.activeTabId === tabId) {
      this.activeTabId = null;

      if (this.tabs.size > 0) {
        // Fallback strategy: prefer previous tab, except for first tab (go to next)
        const fallbackTabId = closingIndex === 0
          ? tabIdsBefore[1]
          : tabIdsBefore[closingIndex - 1];

        if (fallbackTabId && this.tabs.has(fallbackTabId)) {
          await this.switchToTab(fallbackTabId);
        }
      } else {
        // Create a new empty tab
        await this.createTab();
      }
    }

    return true;
  }

  // ============================================
  // Tab Queries
  // ============================================

  /** Gets the currently active tab. */
  getActiveTab(): TabData | null {
    return this.activeTabId ? this.tabs.get(this.activeTabId) ?? null : null;
  }

  /** Gets the active tab ID. */
  getActiveTabId(): TabId | null {
    return this.activeTabId;
  }

  /** Gets a tab by ID. */
  getTab(tabId: TabId): TabData | null {
    return this.tabs.get(tabId) ?? null;
  }

  /** Gets all tabs. */
  getAllTabs(): TabData[] {
    return Array.from(this.tabs.values());
  }

  /** Gets the number of tabs. */
  getTabCount(): number {
    return this.tabs.size;
  }

  /** Checks if more tabs can be created. */
  canCreateTab(): boolean {
    return this.tabs.size < this.getMaxTabs();
  }

  // ============================================
  // Tab Bar Data
  // ============================================

  /** Gets data for rendering the tab bar. */
  getTabBarItems(): TabBarItem[] {
    const items: TabBarItem[] = [];
    let index = 1;

    for (const tab of this.tabs.values()) {
      items.push({
        id: tab.id,
        index: index++,
        title: getTabTitle(tab),
        isActive: tab.id === this.activeTabId,
        isStreaming: tab.state.isStreaming,
        needsAttention: tab.state.needsAttention,
        canClose: this.tabs.size > 1 || !tab.state.isStreaming,
      });
    }

    return items;
  }

  // ============================================
  // Conversation Management
  // ============================================

  /**
   * Opens a conversation in a new tab or existing tab.
   * @param conversationId The conversation to open.
   * @param preferNewTab If true, prefer opening in a new tab.
   */
  async openConversation(conversationId: string, preferNewTab = false): Promise<void> {
    // Check if conversation is already open
    for (const tab of this.tabs.values()) {
      if (tab.conversationId === conversationId) {
        await this.switchToTab(tab.id);
        return;
      }
    }

    // Open in current tab or new tab
    if (preferNewTab && this.canCreateTab()) {
      const tab = await this.createTab();
      if (tab) {
        tab.conversationId = conversationId;
        await tab.controllers.conversationController?.switchTo(conversationId);
      }
    } else {
      const activeTab = this.getActiveTab();
      if (activeTab) {
        await activeTab.controllers.conversationController?.switchTo(conversationId);
      }
    }
  }

  /**
   * Creates a new conversation in the active tab.
   */
  async createNewConversation(): Promise<void> {
    const activeTab = this.getActiveTab();
    if (activeTab) {
      await activeTab.controllers.conversationController?.createNew();
      activeTab.conversationId = activeTab.state.currentConversationId;
    }
  }

  // ============================================
  // Persistence
  // ============================================

  /** Gets the state to persist. */
  getPersistedState(): PersistedTabManagerState {
    const openTabs: PersistedTabState[] = [];

    for (const tab of this.tabs.values()) {
      openTabs.push({
        tabId: tab.id,
        conversationId: tab.conversationId,
      });
    }

    return {
      openTabs,
      activeTabId: this.activeTabId,
    };
  }

  /** Restores state from persisted data. */
  async restoreState(state: PersistedTabManagerState): Promise<void> {
    for (const tabState of state.openTabs) {
      try {
        const tab = await this.createTab(tabState.tabId);
        if (tab && tabState.conversationId) {
          tab.conversationId = tabState.conversationId;
        }
      } catch {
        // Continue restoring other tabs
      }
    }

    // Switch to the previously active tab
    if (state.activeTabId && this.tabs.has(state.activeTabId)) {
      try {
        await this.switchToTab(state.activeTabId);
      } catch {
        // Ignore switch errors
      }
    }

    // If no tabs were restored, create a default one
    if (this.tabs.size === 0) {
      await this.createTab();
    }
  }

  // ============================================
  // Cleanup
  // ============================================

  /** Destroys all tabs and cleans up resources. */
  async destroy(): Promise<void> {
    for (const tab of this.tabs.values()) {
      this.client.sendTabDestroy(tab.id);
      await destroyTab(tab);
    }

    this.tabs.clear();
    this.activeTabId = null;
  }
}
