/**
 * InputController — Handles user input, send button, keyboard shortcuts.
 *
 * Ported from Obsidian's InputController.
 * Replaces `ClaudianService.query()` with `client.sendQuery()`.
 * Replaces `service.cancel()` with `client.sendInterrupt()`.
 * Approval flow: `client.sendApprove()`, `client.sendDeny()`, `client.sendAllowAlways()`.
 * Removes BrowserSelectionController and CanvasSelectionController deps (Obsidian-specific).
 */

import type { SidecarClient } from '../SidecarClient';
import type { ServerMessage } from '../protocol';
import type { ChatState } from '../state/ChatState';
import type { ChatMessage } from '../state/types';
import type { StreamController } from './StreamController';
import type { SelectionController } from './SelectionController';
import type { ConversationController } from './ConversationController';

// Flavor words appended to response completion durations
const COMPLETION_FLAVOR_WORDS = [
  'Baked', 'Cooked', 'Forged', 'Crafted', 'Conjured',
  'Brewed', 'Enchanted', 'Summoned', 'Invoked',
];

function formatDurationMmSs(seconds: number): string {
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return mm > 0 ? `${mm}m ${ss}s` : `${ss}s`;
}

export interface InputControllerDeps {
  client: SidecarClient;
  doc: Document;
  state: ChatState;
  streamController: StreamController;
  selectionController: SelectionController;
  conversationController: ConversationController;
  getInputEl: () => HTMLElement;
  getWelcomeEl: () => HTMLElement | null;
  getMessagesEl: () => HTMLElement;
  getInputContainerEl: () => HTMLElement;
  generateId: () => string;
  resetInputHeight: () => void;
}

export class InputController {
  private deps: InputControllerDeps;
  private unsubscribeMessage: (() => void) | null = null;
  private currentAssistantMsg: ChatMessage | null = null;

  constructor(deps: InputControllerDeps) {
    this.deps = deps;
  }

  // ============================================
  // Helpers
  // ============================================

  /** Read value from the input element (works for textarea and contentEditable). */
  private getInputText(): string {
    const el = this.deps.getInputEl();
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      return el.value;
    }
    return el.textContent ?? '';
  }

  /** Clear the input element. */
  private clearInputEl(): void {
    const el = this.deps.getInputEl();
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      el.value = '';
    } else {
      while (el.firstChild) el.removeChild(el.firstChild);
    }
  }

  /** Set text in the input element. */
  private setInputText(text: string): void {
    const el = this.deps.getInputEl();
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      el.value = text;
    } else {
      el.textContent = text;
    }
  }

  // ============================================
  // Message Sending
  // ============================================

  async sendMessage(options?: { content?: string }): Promise<void> {
    const { client, state, streamController, selectionController, conversationController, doc } =
      this.deps;

    // During conversation creation/switching, don't send - input is preserved so user can retry
    if (state.isCreatingConversation || state.isSwitchingConversation) return;

    const contentOverride = options?.content;
    const shouldUseInput = contentOverride === undefined;

    const content = (contentOverride ?? this.getInputText()).trim();
    if (!content) return;

    // If agent is working, queue the message instead of dropping it
    if (state.isStreaming) {
      if (state.queuedMessage) {
        state.queuedMessage.content += '\n\n' + content;
      } else {
        state.queuedMessage = { content };
      }

      if (shouldUseInput) {
        this.clearInputEl();
        this.deps.resetInputHeight();
      }
      this.updateQueueIndicator();
      return;
    }

    if (shouldUseInput) {
      this.clearInputEl();
      this.deps.resetInputHeight();
    }

    state.isStreaming = true;
    state.cancelRequested = false;
    state.ignoreUsageUpdates = false;
    state.autoScrollEnabled = true;
    const streamGeneration = state.bumpStreamGeneration();

    // Hide welcome message when sending first message
    const welcomeEl = this.deps.getWelcomeEl();
    if (welcomeEl) {
      welcomeEl.style.display = 'none';
    }

    // Build and display user message
    const displayContent = content;
    let promptToSend = content;

    // Append editor selection context if available
    const editorContext = selectionController.getContext();
    if (editorContext) {
      promptToSend += `\n\n<editor_selection>\n${editorContext.selectedText}\n</editor_selection>`;
    }

    const userMsg: ChatMessage = {
      id: this.deps.generateId(),
      role: 'user',
      content: promptToSend,
      displayContent,
      timestamp: Date.now(),
    };
    state.addMessage(userMsg);
    this.renderUserMessage(userMsg);

    // Trigger title generation on first message
    await this.triggerTitleGeneration();

    // Create and display assistant message placeholder
    const assistantMsg: ChatMessage = {
      id: this.deps.generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [],
      contentBlocks: [],
    };
    state.addMessage(assistantMsg);
    this.currentAssistantMsg = assistantMsg;

    const msgEl = this.renderAssistantMessage(assistantMsg);
    const contentEl = msgEl.querySelector('.claudian-message-content') as HTMLElement;

    state.toolCallElements.clear();
    state.currentContentEl = contentEl;
    state.currentTextEl = null;
    state.currentTextContent = '';

    streamController.showThinkingIndicator();
    state.responseStartTime = performance.now();

    // Subscribe to incoming server messages
    this.unsubscribeMessage = client.onMessage((msg: ServerMessage) => {
      if (state.streamGeneration !== streamGeneration) return;
      if (state.cancelRequested && msg.type !== 'stream.done') return;

      // Route stream messages to StreamController
      if (msg.type.startsWith('stream.')) {
        void streamController.handleServerMessage(msg, assistantMsg);
      }

      // Handle sdk UUIDs
      if (msg.type === 'stream.sdk_user_uuid') {
        userMsg.sdkUserUuid = msg.uuid;
      }

      // Stream done handling
      if (msg.type === 'stream.done' || msg.type === 'stream.error') {
        this.finalizeStream(assistantMsg, streamGeneration);
      }

      // Approval requests
      if (msg.type === 'approval.request') {
        // TODO: Wire approval UI
      }

      // Ask user question
      if (msg.type === 'askuser.question') {
        // TODO: Wire ask user UI
      }

      // Plan mode
      if (msg.type === 'plan_mode.request') {
        // TODO: Wire plan mode UI
      }
    });

    // Send the query via WebSocket
    client.sendQuery(promptToSend, {
      editorSelection: editorContext?.selectedText,
      sessionId: state.currentConversationId ?? undefined,
    });
  }

  private finalizeStream(assistantMsg: ChatMessage, streamGeneration: number): void {
    const { state, streamController, conversationController, doc } = this.deps;

    // Unsubscribe from message stream
    if (this.unsubscribeMessage) {
      this.unsubscribeMessage();
      this.unsubscribeMessage = null;
    }

    if (state.streamGeneration !== streamGeneration) return;

    const didCancel = state.cancelRequested;
    if (didCancel) {
      void streamController.appendText(
        '\n\n<span class="claudian-interrupted">Interrupted</span> <span class="claudian-interrupted-hint">· What should Claudian do instead?</span>'
      );
    }

    streamController.hideThinkingIndicator();
    state.isStreaming = false;
    state.cancelRequested = false;

    // Capture response duration
    if (!didCancel) {
      const durationSeconds = state.responseStartTime
        ? Math.floor((performance.now() - state.responseStartTime) / 1000)
        : 0;
      if (durationSeconds > 0 && state.currentContentEl) {
        const flavorWord =
          COMPLETION_FLAVOR_WORDS[Math.floor(Math.random() * COMPLETION_FLAVOR_WORDS.length)];
        assistantMsg.durationSeconds = durationSeconds;
        assistantMsg.durationFlavorWord = flavorWord;

        const footerEl = doc.createElement('div');
        footerEl.className = 'claudian-response-footer';
        const durationSpan = doc.createElement('span');
        durationSpan.textContent = `* ${flavorWord} for ${formatDurationMmSs(durationSeconds)}`;
        durationSpan.className = 'claudian-baked-duration';
        footerEl.appendChild(durationSpan);
        state.currentContentEl.appendChild(footerEl);
      }
    }

    state.currentContentEl = null;
    streamController.finalizeCurrentThinkingBlock(assistantMsg);
    streamController.finalizeCurrentTextBlock(assistantMsg);

    // Auto-hide completed todo panel
    if (state.currentTodos && state.currentTodos.every(t => t.status === 'completed')) {
      state.currentTodos = null;
    }

    // Save conversation
    void conversationController.save(true);

    // Process queued message
    if (!didCancel) {
      this.processQueuedMessage();
    }

    this.currentAssistantMsg = null;
    streamController.resetStreamingState();
  }

  // ============================================
  // Message Rendering
  // ============================================

  private renderUserMessage(msg: ChatMessage): HTMLElement {
    const doc = this.deps.doc;
    const messagesEl = this.deps.getMessagesEl();

    const msgEl = doc.createElement('div');
    msgEl.className = 'claudian-message claudian-message--user';
    msgEl.dataset.messageId = msg.id;

    const contentEl = doc.createElement('div');
    contentEl.className = 'claudian-message-content';
    contentEl.textContent = msg.displayContent ?? msg.content;
    msgEl.appendChild(contentEl);

    messagesEl.appendChild(msgEl);
    return msgEl;
  }

  private renderAssistantMessage(msg: ChatMessage): HTMLElement {
    const doc = this.deps.doc;
    const messagesEl = this.deps.getMessagesEl();

    const msgEl = doc.createElement('div');
    msgEl.className = 'claudian-message claudian-message--assistant';
    msgEl.dataset.messageId = msg.id;

    const contentEl = doc.createElement('div');
    contentEl.className = 'claudian-message-content';
    msgEl.appendChild(contentEl);

    messagesEl.appendChild(msgEl);
    return msgEl;
  }

  // ============================================
  // Queue Management
  // ============================================

  updateQueueIndicator(): void {
    const { state } = this.deps;
    if (!state.queueIndicatorEl) return;

    if (state.queuedMessage) {
      const rawContent = state.queuedMessage.content.trim();
      const preview =
        rawContent.length > 40 ? rawContent.slice(0, 40) + '...' : rawContent;
      state.queueIndicatorEl.textContent = `Queued: ${preview}`;
      state.queueIndicatorEl.style.display = 'block';
    } else {
      state.queueIndicatorEl.style.display = 'none';
    }
  }

  clearQueuedMessage(): void {
    const { state } = this.deps;
    state.queuedMessage = null;
    this.updateQueueIndicator();
  }

  private processQueuedMessage(): void {
    const { state } = this.deps;
    if (!state.queuedMessage) return;

    const { content } = state.queuedMessage;
    state.queuedMessage = null;
    this.updateQueueIndicator();

    this.setInputText(content);

    setTimeout(() => {
      this.sendMessage().catch(() => {
        // sendMessage() handles its own errors internally
      });
    }, 0);
  }

  // ============================================
  // Title Generation
  // ============================================

  private async triggerTitleGeneration(): Promise<void> {
    const { state, conversationController } = this.deps;

    if (state.messages.length !== 1) return;

    const firstUserMsg = state.messages.find(m => m.role === 'user');
    if (!firstUserMsg) return;

    const userContent = firstUserMsg.displayContent || firstUserMsg.content;
    const fallbackTitle = conversationController.generateFallbackTitle(userContent);

    // TODO: When conversation persistence is wired, set the title here
    // For now just store locally
    void fallbackTitle;
  }

  // ============================================
  // Streaming Control
  // ============================================

  cancelStreaming(): void {
    const { client, state, streamController } = this.deps;
    if (!state.isStreaming) return;
    state.cancelRequested = true;

    // Restore queued message to input instead of discarding
    if (state.queuedMessage) {
      this.setInputText(state.queuedMessage.content);
      state.queuedMessage = null;
      this.updateQueueIndicator();
    }

    client.sendInterrupt();
    streamController.hideThinkingIndicator();
  }

  // ============================================
  // Approval Flow
  // ============================================

  approveToolCall(toolCallId: string): void {
    this.deps.client.sendApprove(toolCallId);
  }

  denyToolCall(toolCallId: string): void {
    this.deps.client.sendDeny(toolCallId);
  }

  allowAlwaysToolCall(toolCallId: string, pattern: string): void {
    this.deps.client.sendAllowAlways(toolCallId, pattern);
  }

  // ============================================
  // Cleanup
  // ============================================

  dispose(): void {
    if (this.unsubscribeMessage) {
      this.unsubscribeMessage();
      this.unsubscribeMessage = null;
    }
  }
}
