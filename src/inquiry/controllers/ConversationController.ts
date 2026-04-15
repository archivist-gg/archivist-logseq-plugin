/**
 * ConversationController — Manages conversation lifecycle and history.
 *
 * Ported from Obsidian's ConversationController.
 * Session operations via WebSocket: `client.sendSessionList()`,
 * `client.sendSessionResume()`, `client.sendSessionFork()`, `client.sendSessionRewind()`.
 * Session responses come via `session.loaded` and `session.list_result` WebSocket messages.
 * Replaces `plugin: InquiryModule` with `client: SidecarClient` + `doc: Document`.
 * Replaces `containerEl.createDiv()` with `doc.createElement('div')` + `appendChild()`.
 * Replaces `setIcon` from obsidian with `setIcon` from `../shared/icons`.
 */

import type { SidecarClient } from '../SidecarClient';
import type { MessageRenderer } from '../rendering/MessageRenderer';
import type { ChatState } from '../state/ChatState';
import type { ChatMessage, Conversation, ConversationMeta } from '../state/types';
import { setIcon } from '../shared/icons';

export interface ConversationCallbacks {
  onNewConversation?: () => void;
  onConversationLoaded?: () => void;
  onConversationSwitched?: () => void;
}

export interface ConversationControllerDeps {
  client: SidecarClient;
  doc: Document;
  state: ChatState;
  renderer?: MessageRenderer;
  getHistoryDropdown: () => HTMLElement | null;
  getWelcomeEl: () => HTMLElement | null;
  setWelcomeEl: (el: HTMLElement | null) => void;
  getMessagesEl: () => HTMLElement;
  getInputEl: () => HTMLElement;
  clearQueuedMessage: () => void;
}

export class ConversationController {
  private deps: ConversationControllerDeps;
  private callbacks: ConversationCallbacks;

  /** Locally cached conversation list (populated via WebSocket session.list_result). */
  private conversationList: ConversationMeta[] = [];

  constructor(deps: ConversationControllerDeps, callbacks: ConversationCallbacks = {}) {
    this.deps = deps;
    this.callbacks = callbacks;
  }

  /** Clear the input element (works for both textarea and contentEditable). */
  private clearInputEl(): void {
    const el = this.deps.getInputEl();
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      el.value = '';
    } else {
      while (el.firstChild) el.removeChild(el.firstChild);
    }
  }

  // ============================================
  // Conversation Lifecycle
  // ============================================

  /**
   * Resets to entry point state (New Chat).
   *
   * Entry point is a blank UI state - no conversation is created until the
   * first message is sent. This prevents empty conversations cluttering history.
   */
  async createNew(options: { force?: boolean } = {}): Promise<void> {
    const { client, state, doc } = this.deps;
    const force = !!options.force;
    if (state.isStreaming && !force) return;
    if (state.isCreatingConversation) return;
    if (state.isSwitchingConversation) return;

    state.isCreatingConversation = true;

    try {
      if (force && state.isStreaming) {
        state.cancelRequested = true;
        state.bumpStreamGeneration();
        client.sendInterrupt();
      }

      // Save current conversation if it has messages
      if (state.currentConversationId && state.messages.length > 0) {
        await this.save();
      }

      // Clear streaming state and related DOM references
      state.currentContentEl = null;
      state.currentTextEl = null;
      state.currentTextContent = '';
      state.currentThinkingState = null;
      state.toolCallElements.clear();
      state.writeEditStates.clear();
      state.isStreaming = false;

      // Reset to entry point state - no conversation created yet
      state.currentConversationId = null;
      state.clearMessages();
      state.usage = null;
      state.currentTodos = null;
      state.pendingNewSessionPlan = null;
      state.planFilePath = null;

      state.autoScrollEnabled = true;

      const messagesEl = this.deps.getMessagesEl();
      while (messagesEl.firstChild) messagesEl.removeChild(messagesEl.firstChild);

      // Recreate welcome element
      const welcomeEl = doc.createElement('div');
      welcomeEl.className = 'claudian-welcome';

      const greetingEl = doc.createElement('div');
      greetingEl.className = 'claudian-welcome-greeting';
      greetingEl.textContent = this.getGreeting();
      welcomeEl.appendChild(greetingEl);

      const subtitleEl = doc.createElement('div');
      subtitleEl.className = 'claudian-welcome-subtitle';
      subtitleEl.textContent = 'What knowledge do you seek?';
      welcomeEl.appendChild(subtitleEl);

      messagesEl.appendChild(welcomeEl);
      this.deps.setWelcomeEl(welcomeEl);

      this.clearInputEl();
      this.deps.clearQueuedMessage();

      this.callbacks.onNewConversation?.();
    } finally {
      state.isCreatingConversation = false;
    }
  }

  /**
   * Loads the current conversation, or starts at entry point if none.
   */
  async loadActive(): Promise<void> {
    const { state, doc } = this.deps;

    const conversationId = state.currentConversationId;

    // No active conversation - start at entry point
    if (!conversationId) {
      state.currentConversationId = null;
      state.clearMessages();
      state.usage = null;
      state.currentTodos = null;
      state.pendingNewSessionPlan = null;
      state.planFilePath = null;
      state.autoScrollEnabled = true;

      const messagesEl = this.deps.getMessagesEl();
      while (messagesEl.firstChild) messagesEl.removeChild(messagesEl.firstChild);

      const welcomeEl = doc.createElement('div');
      welcomeEl.className = 'claudian-welcome';

      const greetingEl = doc.createElement('div');
      greetingEl.className = 'claudian-welcome-greeting';
      greetingEl.textContent = this.getGreeting();
      welcomeEl.appendChild(greetingEl);

      const subtitleEl = doc.createElement('div');
      subtitleEl.className = 'claudian-welcome-subtitle';
      subtitleEl.textContent = 'What knowledge do you seek?';
      welcomeEl.appendChild(subtitleEl);

      messagesEl.appendChild(welcomeEl);
      this.deps.setWelcomeEl(welcomeEl);

      this.updateWelcomeVisibility();
      this.callbacks.onConversationLoaded?.();
      return;
    }

    // Session with messages — request resume via WebSocket
    this.deps.client.sendSessionResume(conversationId);
    this.callbacks.onConversationLoaded?.();
  }

  /** Switches to a different conversation by resuming its session. */
  async switchTo(id: string): Promise<void> {
    const { client, state } = this.deps;

    if (id === state.currentConversationId) return;
    if (state.isStreaming) return;
    if (state.isSwitchingConversation) return;
    if (state.isCreatingConversation) return;

    state.isSwitchingConversation = true;

    try {
      await this.save();

      state.currentConversationId = id;
      state.clearMessages();
      state.usage = null;
      state.autoScrollEnabled = true;
      state.currentTodos = null;

      this.clearInputEl();
      this.deps.clearQueuedMessage();

      // Resume session via WebSocket
      client.sendSessionResume(id);

      const dropdown = this.deps.getHistoryDropdown();
      if (dropdown) {
        dropdown.classList.remove('visible');
      }

      this.callbacks.onConversationSwitched?.();
    } finally {
      state.isSwitchingConversation = false;
    }
  }

  /**
   * Handles a session.loaded message from the server.
   * Called by the panel's onMessage listener.
   */
  onSessionLoaded(conversation: unknown): void {
    const { state } = this.deps;
    const conv = conversation as Partial<Conversation>;

    if (conv.id) {
      state.currentConversationId = conv.id;
    }
    if (conv.messages) {
      state.messages = [...conv.messages];
    }
    if (conv.usage) {
      state.usage = conv.usage;
    }

    // Re-render messages using MessageRenderer (markdown, tool calls, etc.)
    if (this.deps.renderer) {
      const welcomeEl = this.deps.renderer.renderMessages(
        state.messages,
        () => this.getGreeting(),
      );
      this.deps.setWelcomeEl(welcomeEl);
    } else {
      // Fallback: plain DOM rendering (no renderer wired yet)
      const { doc } = this.deps;
      const messagesEl = this.deps.getMessagesEl();
      while (messagesEl.firstChild) messagesEl.removeChild(messagesEl.firstChild);

      if (state.messages.length === 0) {
        const welcomeEl = doc.createElement('div');
        welcomeEl.className = 'claudian-welcome';
        const greetingEl = doc.createElement('div');
        greetingEl.className = 'claudian-welcome-greeting';
        greetingEl.textContent = this.getGreeting();
        welcomeEl.appendChild(greetingEl);
        const subtitleEl = doc.createElement('div');
        subtitleEl.className = 'claudian-welcome-subtitle';
        subtitleEl.textContent = 'What knowledge do you seek?';
        welcomeEl.appendChild(subtitleEl);
        messagesEl.appendChild(welcomeEl);
        this.deps.setWelcomeEl(welcomeEl);
      } else {
        this.deps.setWelcomeEl(null);
      }
    }

    this.updateWelcomeVisibility();
  }

  /**
   * Handles a session.list_result message from the server.
   * Called by the panel's onMessage listener.
   */
  onSessionListResult(
    sessions: Array<{ id: string; title: string; lastModified: number; messageCount: number }>
  ): void {
    this.conversationList = sessions.map(s => ({
      id: s.id,
      title: s.title,
      createdAt: s.lastModified,
      updatedAt: s.lastModified,
      lastResponseAt: s.lastModified,
      messageCount: s.messageCount,
      preview: '',
    }));

    this.updateHistoryDropdown();
  }

  /**
   * Saves the current conversation.
   * In the WebSocket model, saving is implicit — the sidecar manages persistence.
   * This method is retained for API compatibility and local state cleanup.
   */
  async save(_updateLastResponse = false, _options?: { resumeSessionAt?: string }): Promise<void> {
    // In the sidecar model, conversation persistence is server-side.
    // No-op for now; the sidecar auto-saves conversations.
  }

  // ============================================
  // History Dropdown
  // ============================================

  toggleHistoryDropdown(): void {
    const dropdown = this.deps.getHistoryDropdown();
    if (!dropdown) return;

    const isVisible = dropdown.classList.contains('visible');
    if (isVisible) {
      dropdown.classList.remove('visible');
    } else {
      // Request fresh session list from server
      this.deps.client.sendSessionList();
      dropdown.classList.add('visible');
    }
  }

  updateHistoryDropdown(): void {
    const dropdown = this.deps.getHistoryDropdown();
    if (!dropdown) return;

    this.renderHistoryItems(dropdown, {
      onSelectConversation: (id) => this.switchTo(id),
      onRerender: () => this.updateHistoryDropdown(),
    });
  }

  private renderHistoryItems(
    container: HTMLElement,
    options: {
      onSelectConversation: (id: string) => Promise<void>;
      onRerender: () => void;
    }
  ): void {
    const { state, doc } = this.deps;

    while (container.firstChild) container.removeChild(container.firstChild);

    const dropdownHeader = doc.createElement('div');
    dropdownHeader.className = 'claudian-history-header';
    const headerSpan = doc.createElement('span');
    headerSpan.textContent = 'Conversations';
    dropdownHeader.appendChild(headerSpan);
    container.appendChild(dropdownHeader);

    const list = doc.createElement('div');
    list.className = 'claudian-history-list';
    container.appendChild(list);

    if (this.conversationList.length === 0) {
      const emptyEl = doc.createElement('div');
      emptyEl.className = 'claudian-history-empty';
      emptyEl.textContent = 'No conversations';
      list.appendChild(emptyEl);
      return;
    }

    // Sort by lastResponseAt descending
    const conversations = [...this.conversationList].sort((a, b) => {
      return (b.lastResponseAt ?? b.createdAt) - (a.lastResponseAt ?? a.createdAt);
    });

    for (const conv of conversations) {
      const isCurrent = conv.id === state.currentConversationId;
      const item = doc.createElement('div');
      item.className = `claudian-history-item${isCurrent ? ' active' : ''}`;

      const iconEl = doc.createElement('div');
      iconEl.className = 'claudian-history-item-icon';
      setIcon(iconEl, isCurrent ? 'message-square' : 'message-square');
      item.appendChild(iconEl);

      const content = doc.createElement('div');
      content.className = 'claudian-history-item-content';

      const titleEl = doc.createElement('div');
      titleEl.className = 'claudian-history-item-title';
      titleEl.textContent = conv.title;
      titleEl.setAttribute('title', conv.title);
      content.appendChild(titleEl);

      const dateEl = doc.createElement('div');
      dateEl.className = 'claudian-history-item-date';
      dateEl.textContent = isCurrent
        ? 'Current session'
        : this.formatDate(conv.lastResponseAt ?? conv.createdAt);
      content.appendChild(dateEl);

      item.appendChild(content);

      if (!isCurrent) {
        content.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            await options.onSelectConversation(conv.id);
          } catch {
            // Failed to load conversation
          }
        });
      }

      const actions = doc.createElement('div');
      actions.className = 'claudian-history-item-actions';

      const deleteBtn = doc.createElement('button');
      deleteBtn.className = 'claudian-action-btn claudian-delete-btn';
      setIcon(deleteBtn, 'trash-2');
      deleteBtn.setAttribute('aria-label', 'Delete');
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (state.isStreaming) return;
        // TODO: Wire conversation deletion via sidecar when API is available
        options.onRerender();
      });
      actions.appendChild(deleteBtn);

      item.appendChild(actions);
      list.appendChild(item);
    }
  }

  // ============================================
  // Welcome & Greeting
  // ============================================

  /** Generates a dynamic greeting based on time/day. */
  getGreeting(): string {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();

    const personalize = (base: string, noNameFallback?: string): string =>
      noNameFallback ?? base;

    // Day-specific greetings
    const dayGreetings: Record<number, string[]> = {
      0: [personalize('Happy Sunday'), 'Sunday session?', 'Welcome to the weekend'],
      1: [personalize('Happy Monday'), personalize('Back at it', 'Back at it!')],
      2: [personalize('Happy Tuesday')],
      3: [personalize('Happy Wednesday')],
      4: [personalize('Happy Thursday')],
      5: [personalize('Happy Friday'), personalize('That Friday feeling')],
      6: [personalize('Happy Saturday', 'Happy Saturday!'), personalize('Welcome to the weekend')],
    };

    // Time-specific greetings
    const getTimeGreetings = (): string[] => {
      if (hour >= 5 && hour < 12) {
        return [personalize('Good morning'), 'Coffee and Claudian time?'];
      } else if (hour >= 12 && hour < 18) {
        return [personalize('Good afternoon'), personalize('Hey there'), personalize("How's it going") + '?'];
      } else if (hour >= 18 && hour < 22) {
        return [personalize('Good evening'), personalize('Evening'), personalize('How was your day') + '?'];
      } else {
        return ['Hello, night owl', personalize('Evening')];
      }
    };

    // General greetings
    const generalGreetings = [
      personalize('Hey there'),
      'Hi, how are you?',
      personalize("How's it going") + '?',
      personalize('Welcome back') + '!',
      personalize("What's new") + '?',
      'You are absolutely right!',
    ];

    const allGreetings = [
      ...(dayGreetings[day] || []),
      ...getTimeGreetings(),
      ...generalGreetings,
    ];

    return allGreetings[Math.floor(Math.random() * allGreetings.length)];
  }

  /** Updates welcome element visibility based on message count. */
  updateWelcomeVisibility(): void {
    const welcomeEl = this.deps.getWelcomeEl();
    if (!welcomeEl) return;

    if (this.deps.state.messages.length === 0) {
      welcomeEl.style.display = '';
    } else {
      welcomeEl.style.display = 'none';
    }
  }

  // ============================================
  // Utilities
  // ============================================

  /** Generates a fallback title from the first message. */
  generateFallbackTitle(firstMessage: string): string {
    const firstSentence = firstMessage.split(/[.!?\n]/)[0].trim();
    const autoTitle = firstSentence.substring(0, 50);
    const suffix = firstSentence.length > 50 ? '...' : '';
    return `${autoTitle}${suffix}`;
  }

  /** Formats a timestamp for display. */
  formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();

    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    }
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  /**
   * Renders the history dropdown content to a provided container.
   */
  renderHistoryDropdown(
    container: HTMLElement,
    options: { onSelectConversation: (id: string) => Promise<void> }
  ): void {
    this.renderHistoryItems(container, {
      onSelectConversation: options.onSelectConversation,
      onRerender: () => this.renderHistoryDropdown(container, options),
    });
  }

  /** Returns the current conversation list. */
  getConversationList(): ConversationMeta[] {
    return this.conversationList;
  }
}
