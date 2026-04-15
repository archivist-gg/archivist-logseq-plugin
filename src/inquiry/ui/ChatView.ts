/**
 * ChatView -- Thin panel shell orchestrator for the Logseq sidebar chat.
 *
 * Delegates all tab/controller/rendering logic to TabManager.
 * This file is responsible for:
 *   1. Building the outer DOM shell (panel layout with header, content area).
 *   2. Creating TabManager and TabBar.
 *   3. Wiring SidecarClient message routing to the active tab.
 *   4. Handling global messages (settings, connection ready).
 *   5. Public API for InquiryPanel (newSession, showSessionHistory).
 */

import type { SidecarClient } from '../SidecarClient';
import type { ServerMessage } from '../protocol';

import { TabBar } from './TabBar';
import type { TabInfo } from './TabBar';
import type { ToolbarSettings } from './InputToolbar';
import { TabManager } from '../tabs/TabManager';

// ── Types ──

export interface ChatViewOptions {
  /** The host document (top.document for Logseq). */
  doc: Document;
  /** The connected sidecar client. */
  client: SidecarClient;
  /** The container element to mount into. */
  containerEl: HTMLElement;
}

// ── ChatView ──

export class ChatView {
  private doc: Document;
  private client: SidecarClient;
  private containerEl: HTMLElement;

  // DOM elements
  private tabBarEl: HTMLElement | null = null;
  private contentAreaEl: HTMLElement | null = null;

  // UI Components
  private tabBar: TabBar | null = null;
  private tabManager: TabManager | null = null;

  // Settings cache (from sidecar)
  private cachedSettings: ToolbarSettings = {
    model: 'opus',
    effortLevel: 'high',
  };

  // Unsubscribe from sidecar messages
  private unsubscribeMessage: (() => void) | null = null;

  constructor(options: ChatViewOptions) {
    this.doc = options.doc;
    this.client = options.client;
    this.containerEl = options.containerEl;
  }

  // ============================================
  // Lifecycle
  // ============================================

  /**
   * Initialize the ChatView: build DOM shell, create TabManager, create first tab.
   */
  init(): void {
    this.buildDOM();
    this.wireTabSystem();

    // Create initial tab (fire-and-forget; tab creation is non-blocking)
    void this.tabManager!.createTab().catch(() => {
      // Tab creation failed; UI will be empty but not broken
    });

    // Subscribe to sidecar messages for global routing
    this.unsubscribeMessage = this.client.onMessage((msg) => {
      this.handleGlobalMessage(msg);
    });

    // Fetch initial settings from sidecar
    this.client.fetchSettings().then((settings) => {
      if (settings) {
        this.applySettings(settings);
      }
    }).catch(() => {
      // Settings fetch failed; use defaults
    });
  }

  /**
   * Tear down the ChatView and all its components.
   */
  destroy(): void {
    if (this.unsubscribeMessage) {
      this.unsubscribeMessage();
      this.unsubscribeMessage = null;
    }

    // Fire-and-forget async cleanup (tabs may have async teardown)
    void this.tabManager?.destroy().catch(() => {});
    this.tabBar?.destroy();

    // Clear container
    while (this.containerEl.firstChild) {
      this.containerEl.removeChild(this.containerEl.firstChild);
    }
  }

  // ============================================
  // DOM Construction (thin shell)
  // ============================================

  private buildDOM(): void {
    const doc = this.doc;

    // Clear existing content
    while (this.containerEl.firstChild) {
      this.containerEl.removeChild(this.containerEl.firstChild);
    }

    // Tab bar area
    this.tabBarEl = doc.createElement('div');
    this.tabBarEl.className = 'claudian-tab-bar-container';
    this.containerEl.appendChild(this.tabBarEl);

    // Content area where tab content elements are mounted
    this.contentAreaEl = doc.createElement('div');
    this.contentAreaEl.className = 'claudian-content-area';
    this.containerEl.appendChild(this.contentAreaEl);
  }

  // ============================================
  // Tab System Wiring
  // ============================================

  private wireTabSystem(): void {
    if (!this.tabBarEl || !this.contentAreaEl) return;

    // Create TabManager
    this.tabManager = new TabManager({
      client: this.client,
      doc: this.doc,
      containerEl: this.contentAreaEl,
      getSettings: () => this.cachedSettings,
      onModelChange: (model) => {
        this.cachedSettings.model = model;
        const activeTab = this.tabManager?.getActiveTab();
        if (activeTab) {
          this.client.sendSettingsUpdate(activeTab.id, { model });
        }
      },
      onEffortLevelChange: (effort) => {
        this.cachedSettings.effortLevel = effort as ToolbarSettings['effortLevel'];
        const activeTab = this.tabManager?.getActiveTab();
        if (activeTab) {
          this.client.sendSettingsUpdate(activeTab.id, { effortLevel: effort });
        }
      },
      callbacks: {
        onTabCreated: () => this.updateTabBar(),
        onTabSwitched: () => this.updateTabBar(),
        onTabClosed: () => this.updateTabBar(),
        onTabStreamingChanged: () => this.updateTabBar(),
        onTabTitleChanged: () => this.updateTabBar(),
        onTabAttentionChanged: () => this.updateTabBar(),
      },
    });

    // Create TabBar
    this.tabBar = new TabBar(this.doc, this.tabBarEl, {
      onTabSelect: (tabId) => { void this.tabManager?.switchToTab(tabId); },
      onTabClose: (tabId) => { void this.tabManager?.closeTab(tabId); },
      onNewTab: () => { void this.tabManager?.createTab(); },
    });
  }

  // ============================================
  // Tab Bar Updates
  // ============================================

  private updateTabBar(): void {
    if (!this.tabBar || !this.tabManager) return;

    const items = this.tabManager.getTabBarItems();
    const tabInfos: TabInfo[] = items.map(item => ({
      id: item.id,
      title: item.title,
      isActive: item.isActive,
      isDirty: item.isStreaming || item.needsAttention,
    }));
    this.tabBar.update(tabInfos);
  }

  // ============================================
  // Settings & Global Messages
  // ============================================

  private applySettings(settings: Record<string, unknown>): void {
    if (typeof settings.model === 'string') {
      this.cachedSettings.model = settings.model;
    }
    if (settings.effortLevel === 'low' || settings.effortLevel === 'medium' || settings.effortLevel === 'high') {
      this.cachedSettings.effortLevel = settings.effortLevel;
    }

    // Update all tabs' model selectors
    const tabs = this.tabManager?.getAllTabs() ?? [];
    for (const tab of tabs) {
      tab.ui.modelSelector?.updateDisplay();
      tab.ui.thinkingBudgetSelector?.updateDisplay();
    }
  }

  private handleGlobalMessage(msg: ServerMessage): void {
    // Handle settings updates
    if (msg.type === 'settings.current') {
      const claudian = (msg as any).claudian as Record<string, unknown>;
      if (claudian) {
        this.applySettings(claudian);
      }
    }

    // Handle connection ready
    if (msg.type === 'connection.ready') {
      const tabs = this.tabManager?.getAllTabs() ?? [];
      for (const tab of tabs) {
        tab.ui.modelSelector?.setReady(true);
      }
    }
  }

  // ============================================
  // Public API (called from InquiryPanel)
  // ============================================

  /** Create a new chat session tab. */
  newSession(): void {
    void this.tabManager?.createTab();
  }

  /** Toggle the session history dropdown on the active tab. */
  showSessionHistory(): void {
    const activeTab = this.tabManager?.getActiveTab();
    if (activeTab) {
      activeTab.controllers.conversationController?.toggleHistoryDropdown();
    }
  }

  /** Get the tab manager (for external coordination). */
  getTabManager(): TabManager | null {
    return this.tabManager;
  }
}
