/**
 * ChatView -- Panel shell orchestrator for the Logseq sidebar chat.
 *
 * REWRITE from Obsidian's ClaudianView.ts.
 * This is the central orchestrator that:
 *   - Creates messages container, input area, toolbar, tab bar
 *   - Instantiates controllers (InputController, StreamController) and UI components
 *   - Wires WebSocket message routing to StreamController
 *   - Manages tab lifecycle (via TabBar)
 *   - Uses `doc: Document` and `client: SidecarClient` (no Obsidian deps)
 *
 * The ChatView is mounted into an existing panel element (created by InquiryPanel).
 * It replaces the placeholder content with the full interactive chat UI.
 */

import type { SidecarClient } from '../SidecarClient';
import type { ServerMessage } from '../protocol';
import { ChatState } from '../state/ChatState';
import type { ChatMessage, TodoItem } from '../state/types';
import { setIcon } from '../shared/icons';

import { RichInput, SendButton } from './RichInput';
import type { SendButtonState } from './RichInput';
import { createInputToolbar } from './InputToolbar';
import type { ToolbarSettings, ContextUsageMeter, ModelSelector, ThinkingBudgetSelector } from './InputToolbar';
import { FileContextManager } from './FileContext';
import { ImageContextManager } from './ImageContext';
import { TabBar } from './TabBar';
import type { TabInfo } from './TabBar';
import { StatusPanel } from './StatusPanel';
import { InstructionModeManager } from './InstructionMode';
import type { InstructionInputLike } from './InstructionMode';
import { BangBashModeManager } from './BangBashMode';
import { StreamController } from '../controllers/StreamController';

// ── Types ──

export interface ChatViewOptions {
  /** The host document (top.document for Logseq). */
  doc: Document;
  /** The connected sidecar client. */
  client: SidecarClient;
  /** The container element to mount into. */
  containerEl: HTMLElement;
}

interface TabState {
  id: string;
  title: string;
  chatState: ChatState;
  messagesEl: HTMLElement;
  streamController: StreamController;
}

// ── ChatView ──

export class ChatView {
  private doc: Document;
  private client: SidecarClient;
  private containerEl: HTMLElement;

  // DOM elements
  private tabBarEl: HTMLElement | null = null;
  private messagesContainerEl: HTMLElement | null = null;
  private welcomeEl: HTMLElement | null = null;
  private inputAreaEl: HTMLElement | null = null;
  private inputWrapperEl: HTMLElement | null = null;
  private chipsContainerEl: HTMLElement | null = null;
  private toolbarEl: HTMLElement | null = null;

  // UI Components
  private tabBar: TabBar | null = null;
  private richInput: RichInput | null = null;
  private sendButton: SendButton | null = null;
  private modelSelector: ModelSelector | null = null;
  private thinkingBudgetSelector: ThinkingBudgetSelector | null = null;
  private contextUsageMeter: ContextUsageMeter | null = null;
  private fileContextManager: FileContextManager | null = null;
  private imageContextManager: ImageContextManager | null = null;
  private statusPanel: StatusPanel | null = null;
  private instructionMode: InstructionModeManager | null = null;
  private bangBashMode: BangBashModeManager | null = null;

  // Tab management
  private tabs: TabState[] = [];
  private activeTabId: string | null = null;
  private tabIdCounter = 0;

  // Settings cache (from sidecar)
  private cachedSettings: ToolbarSettings = {
    model: 'claude-sonnet-4-20250514',
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
   * Initialize the ChatView: build DOM, wire components, create first tab.
   */
  init(): void {
    this.buildDOM();
    this.wireComponents();
    this.createTab();

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

    this.instructionMode?.destroy();
    this.bangBashMode?.destroy();
    this.fileContextManager?.destroy();
    this.imageContextManager?.clearImages();
    this.statusPanel?.destroy();
    this.tabBar?.destroy();

    // Clear container
    while (this.containerEl.firstChild) {
      this.containerEl.removeChild(this.containerEl.firstChild);
    }

    this.tabs = [];
    this.activeTabId = null;
  }

  // ============================================
  // DOM Construction
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

    // Messages wrapper (flex:1, overflow:hidden) -> messages scroll container inside
    const messagesWrapper = doc.createElement('div');
    messagesWrapper.className = 'claudian-messages-wrapper';
    this.containerEl.appendChild(messagesWrapper);

    this.messagesContainerEl = doc.createElement('div');
    this.messagesContainerEl.className = 'claudian-messages';
    messagesWrapper.appendChild(this.messagesContainerEl);

    // Welcome message
    this.welcomeEl = doc.createElement('div');
    this.welcomeEl.className = 'claudian-welcome';
    const welcomeSvg = doc.createElement('div');
    setIcon(welcomeSvg, 'bot');
    this.welcomeEl.appendChild(welcomeSvg);
    const welcomeGreeting = doc.createElement('div');
    welcomeGreeting.className = 'claudian-welcome-greeting';
    welcomeGreeting.textContent = 'How can I help?';
    this.welcomeEl.appendChild(welcomeGreeting);
    this.messagesContainerEl.appendChild(this.welcomeEl);

    // Input area
    this.inputAreaEl = doc.createElement('div');
    this.inputAreaEl.className = 'claudian-input-container';
    this.containerEl.appendChild(this.inputAreaEl);

    // Context row (above input)
    this.chipsContainerEl = doc.createElement('div');
    this.chipsContainerEl.className = 'claudian-context-row';
    this.inputAreaEl.appendChild(this.chipsContainerEl);

    // Input wrapper (contains rich input + send button)
    this.inputWrapperEl = doc.createElement('div');
    this.inputWrapperEl.className = 'claudian-input-wrapper';
    this.inputAreaEl.appendChild(this.inputWrapperEl);

    // Toolbar (below input)
    this.toolbarEl = doc.createElement('div');
    this.toolbarEl.className = 'claudian-input-toolbar';
    this.inputAreaEl.appendChild(this.toolbarEl);
  }

  // ============================================
  // Component Wiring
  // ============================================

  private wireComponents(): void {
    const doc = this.doc;

    if (!this.inputWrapperEl || !this.toolbarEl || !this.tabBarEl || !this.chipsContainerEl) return;

    // Rich input
    this.richInput = new RichInput(doc, this.inputWrapperEl, {
      placeholder: 'Ask Claudian...',
      onInput: () => this.handleInputChange(),
    });

    // Send button
    this.sendButton = new SendButton(doc, this.inputWrapperEl,
      () => this.handleSend(),
      () => this.handleStop(),
    );

    // Toolbar (model selector, effort, context meter)
    const toolbar = createInputToolbar(doc, this.toolbarEl, {
      onModelChange: async (model) => {
        this.cachedSettings.model = model;
        this.client.sendSettingsUpdate({ model });
      },
      onEffortLevelChange: async (effort) => {
        this.cachedSettings.effortLevel = effort;
        this.client.sendSettingsUpdate({ effortLevel: effort });
      },
      getSettings: () => this.cachedSettings,
    });
    this.modelSelector = toolbar.modelSelector;
    this.thinkingBudgetSelector = toolbar.thinkingBudgetSelector;
    this.contextUsageMeter = toolbar.contextUsageMeter;

    // Tab bar
    this.tabBar = new TabBar(doc, this.tabBarEl, {
      onTabSelect: (tabId) => this.switchTab(tabId),
      onTabClose: (tabId) => this.closeTab(tabId),
      onNewTab: () => this.createTab(),
      onTabReorder: (from, to) => this.reorderTabs(from, to),
    });

    // File context
    this.fileContextManager = new FileContextManager(
      doc,
      this.client,
      this.chipsContainerEl,
      this.richInput,
      { onChipsChanged: () => this.updateSendButtonState() },
    );

    // Image context
    this.imageContextManager = new ImageContextManager(
      doc,
      this.inputAreaEl!,
      this.richInput.el,
      { onImagesChanged: () => this.updateSendButtonState() },
    );

    // Status panel
    this.statusPanel = new StatusPanel(doc);

    // Instruction mode (# prefix)
    const inputAdapter: InstructionInputLike = {
      getValue: () => this.richInput?.value ?? '',
      setValue: (text) => this.richInput?.setText(text),
      getPlaceholder: () => this.richInput?.el.dataset.placeholder ?? '',
      setPlaceholder: (text) => {
        if (this.richInput) this.richInput.el.dataset.placeholder = text;
      },
    };
    this.instructionMode = new InstructionModeManager(inputAdapter, {
      onSubmit: async (instruction) => {
        // Send instruction as a system prompt via sidecar
        this.client.sendSettingsUpdate({ customSystemPrompt: instruction });
        this.instructionMode?.clear();
      },
      getInputWrapper: () => this.inputWrapperEl,
      resetInputHeight: () => { /* contentEditable auto-sizes */ },
    });

    // Bang bash mode (! prefix)
    this.bangBashMode = new BangBashModeManager(inputAdapter, {
      onSubmit: async (command) => {
        // Execute via sidecar query (the sidecar will run it)
        this.client.sendQuery(`!${command}`);
      },
      getInputWrapper: () => this.inputWrapperEl,
      resetInputHeight: () => { /* contentEditable auto-sizes */ },
    });

    // Wire keyboard events on the rich input
    this.richInput.el.addEventListener('keydown', (e) => this.handleKeydown(e));

    // Wire scroll events for auto-scroll control
    this.messagesContainerEl?.addEventListener('scroll', () => {
      this.handleScroll();
    });
  }

  // ============================================
  // Tab Management
  // ============================================

  private createTab(): string {
    const doc = this.doc;
    const id = `tab-${++this.tabIdCounter}`;

    const messagesEl = doc.createElement('div');
    messagesEl.className = 'claudian-messages';

    const chatState = new ChatState({
      onStreamingStateChanged: (isStreaming) => {
        if (this.activeTabId === id) {
          this.updateSendButtonState();
          if (isStreaming) {
            this.sendButton?.setState('streaming');
          }
        }
      },
      onUsageChanged: (usage) => {
        if (this.activeTabId === id) {
          this.contextUsageMeter?.update(usage);
        }
      },
      onTodosChanged: (todos: TodoItem[] | null) => {
        if (this.activeTabId === id && this.statusPanel) {
          this.statusPanel.updateTodos(todos);
        }
      },
    });

    const streamController = new StreamController({
      client: this.client,
      doc,
      state: chatState,
      getMessagesEl: () => messagesEl,
    });

    const tab: TabState = {
      id,
      title: 'New Chat',
      chatState,
      messagesEl,
      streamController,
    };

    this.tabs.push(tab);
    this.switchTab(id);
    this.updateTabBar();

    return id;
  }

  private switchTab(tabId: string): void {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab || this.activeTabId === tabId) return;

    this.activeTabId = tabId;

    // Swap messages container content
    if (this.messagesContainerEl) {
      // Detach all tab messages
      for (const t of this.tabs) {
        if (t.messagesEl.parentElement === this.messagesContainerEl) {
          this.messagesContainerEl.removeChild(t.messagesEl);
        }
      }
      // Attach active tab
      this.messagesContainerEl.appendChild(tab.messagesEl);

      // Remount status panel
      if (this.statusPanel) {
        this.statusPanel.mount(tab.messagesEl);
      }
    }

    // Update toolbar state
    this.contextUsageMeter?.update(tab.chatState.usage);
    this.updateSendButtonState();
    this.updateTabBar();

    // Show/hide welcome
    if (this.welcomeEl) {
      this.welcomeEl.style.display = tab.chatState.messages.length === 0 ? '' : 'none';
    }
  }

  private closeTab(tabId: string): void {
    const idx = this.tabs.findIndex(t => t.id === tabId);
    if (idx < 0 || this.tabs.length <= 1) return;

    const tab = this.tabs[idx];
    tab.messagesEl.remove();
    this.tabs.splice(idx, 1);

    if (this.activeTabId === tabId) {
      const newActiveIdx = Math.min(idx, this.tabs.length - 1);
      this.switchTab(this.tabs[newActiveIdx].id);
    }

    this.updateTabBar();
  }

  private reorderTabs(fromIndex: number, toIndex: number): void {
    const [moved] = this.tabs.splice(fromIndex, 1);
    this.tabs.splice(toIndex, 0, moved);
    this.updateTabBar();
  }

  private updateTabBar(): void {
    if (!this.tabBar) return;
    const tabInfos: TabInfo[] = this.tabs.map(t => ({
      id: t.id,
      title: t.title,
      isActive: t.id === this.activeTabId,
    }));
    this.tabBar.update(tabInfos);
  }

  // ============================================
  // Input Handling
  // ============================================

  private handleInputChange(): void {
    // Forward to file context for @ mention detection
    this.fileContextManager?.handleInputChange();

    // Forward to instruction mode
    this.instructionMode?.handleInputChange();

    // Forward to bang bash mode
    this.bangBashMode?.handleInputChange();

    this.updateSendButtonState();
  }

  private handleKeydown(e: KeyboardEvent): void {
    // Instruction mode trigger
    if (this.instructionMode?.handleTriggerKey(e)) return;
    if (this.instructionMode?.handleKeydown(e)) return;

    // Bang bash mode trigger
    if (this.bangBashMode?.handleTriggerKey(e)) return;
    if (this.bangBashMode?.handleKeydown(e)) return;

    // Mention dropdown navigation
    if (this.fileContextManager?.handleMentionKeydown(e)) return;

    // Enter to send (not shift+enter)
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      this.handleSend();
      return;
    }

    // Escape to cancel streaming
    if (e.key === 'Escape') {
      const activeTab = this.getActiveTab();
      if (activeTab?.chatState.isStreaming) {
        this.handleStop();
      }
    }
  }

  private handleSend(): void {
    if (!this.richInput) return;

    const serialized = this.richInput.serialize();
    const text = serialized.text.trim();
    if (!text && !this.imageContextManager?.hasImages()) return;

    const activeTab = this.getActiveTab();
    if (!activeTab) return;

    // If streaming, queue the message
    if (activeTab.chatState.isStreaming) {
      if (activeTab.chatState.queuedMessage) {
        activeTab.chatState.queuedMessage.content += '\n\n' + text;
      } else {
        activeTab.chatState.queuedMessage = { content: text };
      }
      this.richInput.clear();
      return;
    }

    // Hide welcome
    if (this.welcomeEl) {
      this.welcomeEl.style.display = 'none';
    }

    // Create user message
    const userMsg: ChatMessage = {
      id: this.generateId(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    activeTab.chatState.addMessage(userMsg);
    this.renderUserMessage(activeTab, userMsg);

    // Create assistant placeholder
    const assistantMsg: ChatMessage = {
      id: this.generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [],
      contentBlocks: [],
    };
    activeTab.chatState.addMessage(assistantMsg);
    const msgEl = this.renderAssistantMessage(activeTab, assistantMsg);
    const contentEl = msgEl.querySelector('.claudian-message-content') as HTMLElement;

    // Set streaming state
    activeTab.chatState.isStreaming = true;
    activeTab.chatState.autoScrollEnabled = true;
    activeTab.chatState.currentContentEl = contentEl;
    activeTab.chatState.toolCallElements.clear();
    activeTab.chatState.responseStartTime = performance.now();
    const streamGeneration = activeTab.chatState.bumpStreamGeneration();

    activeTab.streamController.showThinkingIndicator();
    this.sendButton?.setState('streaming');

    // Subscribe to messages for this stream
    const unsub = this.client.onMessage((msg: ServerMessage) => {
      if (activeTab.chatState.streamGeneration !== streamGeneration) return;
      if (activeTab.chatState.cancelRequested && msg.type !== 'stream.done') return;

      if (msg.type.startsWith('stream.')) {
        void activeTab.streamController.handleServerMessage(msg, assistantMsg);
      }

      if (msg.type === 'stream.sdk_user_uuid') {
        userMsg.sdkUserUuid = msg.uuid;
      }

      if (msg.type === 'stream.done' || msg.type === 'stream.error') {
        unsub();
        activeTab.streamController.finalizeCurrentThinkingBlock(assistantMsg);
        activeTab.streamController.finalizeCurrentTextBlock(assistantMsg);
        activeTab.streamController.hideThinkingIndicator();
        activeTab.chatState.isStreaming = false;
        activeTab.chatState.cancelRequested = false;
        activeTab.streamController.resetStreamingState();
        this.updateSendButtonState();
      }
    });

    // Send query
    const images = this.imageContextManager?.getAttachedImages().map(img => img.data);
    const filePaths = serialized.filePaths.length > 0 ? serialized.filePaths : undefined;
    const entityRefs = serialized.entityRefs.length > 0
      ? serialized.entityRefs.map(r => `${r.type}:${r.name}`)
      : undefined;

    this.client.sendQuery(text, {
      images: images && images.length > 0 ? images : undefined,
      filePaths,
      entityRefs,
      sessionId: activeTab.chatState.currentConversationId ?? undefined,
    });

    // Clear input
    this.richInput.clear();
    this.imageContextManager?.clearImages();
    this.updateSendButtonState();
  }

  private handleStop(): void {
    const activeTab = this.getActiveTab();
    if (!activeTab?.chatState.isStreaming) return;

    activeTab.chatState.cancelRequested = true;
    this.client.sendInterrupt();
    activeTab.streamController.hideThinkingIndicator();
  }

  private handleScroll(): void {
    const activeTab = this.getActiveTab();
    if (!activeTab || !this.messagesContainerEl) return;

    const el = this.messagesContainerEl;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;

    if (!isAtBottom && activeTab.chatState.isStreaming) {
      activeTab.chatState.autoScrollEnabled = false;
    } else if (isAtBottom) {
      activeTab.chatState.autoScrollEnabled = true;
    }
  }

  // ============================================
  // Message Rendering
  // ============================================

  private renderUserMessage(tab: TabState, msg: ChatMessage): HTMLElement {
    const doc = this.doc;

    const msgEl = doc.createElement('div');
    msgEl.className = 'claudian-message claudian-message-user';
    msgEl.dataset.messageId = msg.id;

    const contentEl = doc.createElement('div');
    contentEl.className = 'claudian-message-content';
    contentEl.textContent = msg.displayContent ?? msg.content;
    msgEl.appendChild(contentEl);

    tab.messagesEl.appendChild(msgEl);
    return msgEl;
  }

  private renderAssistantMessage(tab: TabState, msg: ChatMessage): HTMLElement {
    const doc = this.doc;

    const msgEl = doc.createElement('div');
    msgEl.className = 'claudian-message claudian-message-assistant';
    msgEl.dataset.messageId = msg.id;

    const contentEl = doc.createElement('div');
    contentEl.className = 'claudian-message-content';
    msgEl.appendChild(contentEl);

    tab.messagesEl.appendChild(msgEl);
    return msgEl;
  }

  // ============================================
  // State Helpers
  // ============================================

  private getActiveTab(): TabState | undefined {
    return this.tabs.find(t => t.id === this.activeTabId);
  }

  private updateSendButtonState(): void {
    if (!this.sendButton || !this.richInput) return;

    const activeTab = this.getActiveTab();
    if (activeTab?.chatState.isStreaming) {
      this.sendButton.setState('streaming');
      return;
    }

    const hasContent = !this.richInput.isEmpty || (this.imageContextManager?.hasImages() ?? false);
    const state: SendButtonState = hasContent ? 'idle-ready' : 'idle-empty';
    this.sendButton.setState(state);
  }

  private applySettings(settings: Record<string, unknown>): void {
    if (typeof settings.model === 'string') {
      this.cachedSettings.model = settings.model;
    }
    if (settings.effortLevel === 'low' || settings.effortLevel === 'medium' || settings.effortLevel === 'high') {
      this.cachedSettings.effortLevel = settings.effortLevel;
    }
    this.modelSelector?.updateDisplay();
    this.thinkingBudgetSelector?.updateDisplay();
  }

  private handleGlobalMessage(msg: ServerMessage): void {
    // Handle settings updates
    if (msg.type === 'settings.current') {
      const claudian = msg.claudian as Record<string, unknown>;
      if (claudian) {
        this.applySettings(claudian);
      }
    }

    // Handle connection ready
    if (msg.type === 'connection.ready') {
      this.modelSelector?.setReady(true);
    }
  }

  private generateId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  // ============================================
  // Public API (called from InquiryPanel)
  // ============================================

  /** Create a new chat session tab. */
  newSession(): void {
    this.createTab();
  }

  /** Request session history from the sidecar. */
  showSessionHistory(): void {
    this.client.sendSessionList();
  }
}
