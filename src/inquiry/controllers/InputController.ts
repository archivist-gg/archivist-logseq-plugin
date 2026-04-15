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
import type {
  ServerMessage,
  ApprovalRequestMessage,
  AskUserQuestionMessage,
  PlanModeRequestMessage,
} from '../protocol';
import type { ChatState } from '../state/ChatState';
import type { ChatMessage } from '../state/types';
import type { StreamController } from './StreamController';
import type { SelectionController } from './SelectionController';
import type { ConversationController } from './ConversationController';
import { COMPLETION_FLAVOR_WORDS } from '../constants';

// ── Built-in Command Definitions ───────────────────────────

export type BuiltInCommandAction = 'clear' | 'new' | 'resume' | 'fork' | 'generate' | 'search-srd' | 'roll';

export interface BuiltInCommand {
  name: string;
  aliases?: string[];
  description: string;
  action: BuiltInCommandAction;
  hasArgs?: boolean;
  argumentHint?: string;
}

export const BUILT_IN_COMMANDS: BuiltInCommand[] = [
  {
    name: 'clear',
    description: 'Clear messages in current conversation',
    action: 'clear',
  },
  {
    name: 'new',
    description: 'Start a new conversation',
    action: 'new',
  },
  {
    name: 'resume',
    description: 'Resume a previous conversation',
    action: 'resume',
  },
  {
    name: 'fork',
    description: 'Fork current conversation to new session',
    action: 'fork',
  },
  {
    name: 'generate',
    description: 'Generate a D&D entity (monster, spell, item, encounter, NPC)',
    action: 'generate',
    hasArgs: true,
    argumentHint: '<monster|spell|item|encounter|npc> [description]',
  },
  {
    name: 'search-srd',
    description: 'Search SRD content by name',
    action: 'search-srd',
    hasArgs: true,
    argumentHint: '[query]',
  },
  {
    name: 'roll',
    description: 'Roll dice (e.g., /roll 2d6+3)',
    action: 'roll',
    hasArgs: true,
    argumentHint: '<notation>',
  },
];

/** Map of command names to their definitions. */
const builtInCommandMap = new Map<string, BuiltInCommand>();
for (const cmd of BUILT_IN_COMMANDS) {
  builtInCommandMap.set(cmd.name.toLowerCase(), cmd);
  if (cmd.aliases) {
    for (const alias of cmd.aliases) {
      builtInCommandMap.set(alias.toLowerCase(), cmd);
    }
  }
}

/**
 * Detects if input text is a built-in slash command.
 * Returns the command and args if found, null otherwise.
 */
export function detectBuiltInCommand(input: string): { command: BuiltInCommand; args: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;

  const match = trimmed.match(/^\/([a-zA-Z0-9_-]+)(?:\s(.*))?$/);
  if (!match) return null;

  const cmdName = match[1].toLowerCase();
  const command = builtInCommandMap.get(cmdName);
  if (!command) return null;

  return { command, args: (match[2] || '').trim() };
}

/**
 * Returns built-in commands formatted for the SlashCommandDropdown.
 */
export function getBuiltInCommandsForDropdown(): Array<{
  name: string;
  description: string;
  isBuiltIn: true;
}> {
  return BUILT_IN_COMMANDS.map((cmd) => ({
    name: cmd.name,
    description: cmd.description,
    isBuiltIn: true as const,
  }));
}

function formatDurationMmSs(seconds: number): string {
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return mm > 0 ? `${mm}m ${ss}s` : `${ss}s`;
}

export interface InputControllerDeps {
  client: SidecarClient;
  doc: Document;
  state: ChatState;
  tabId: string;
  streamController: StreamController;
  selectionController: SelectionController;
  conversationController: ConversationController;
  getInputEl: () => HTMLElement;
  getWelcomeEl: () => HTMLElement | null;
  getMessagesEl: () => HTMLElement;
  getInputContainerEl: () => HTMLElement;
  generateId: () => string;
  resetInputHeight: () => void;
  /** Callback when permission mode changes (toggle or stream detection). */
  onPermissionModeChanged?: (mode: 'unleashed' | 'guarded') => void;
  /** Callback to create a new tab. */
  onNewTab?: () => void;
  /** Callback to fork the entire current conversation. */
  onForkAll?: () => Promise<void>;
}

export class InputController {
  private deps: InputControllerDeps;
  private unsubscribeMessage: (() => void) | null = null;
  private currentAssistantMsg: ChatMessage | null = null;

  /** Currently mounted inline approval/askuser/planmode element, if any. */
  private activeInlineEl: HTMLElement | null = null;

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

    // Check for built-in commands first (e.g., /clear, /new, /roll)
    const builtInCmd = detectBuiltInCommand(content);
    if (builtInCmd) {
      if (shouldUseInput) {
        this.clearInputEl();
        this.deps.resetInputHeight();
      }
      const handled = await this.handleBuiltInCommand(builtInCmd.command.action, builtInCmd.args);
      if (handled) return;
      // If not handled, fall through to send as a query to the sidecar
    }

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
        this.handleApprovalRequest(msg as ApprovalRequestMessage);
      }

      // Ask user question
      if (msg.type === 'askuser.question') {
        this.handleAskUserQuestion(msg as AskUserQuestionMessage);
      }

      // Plan mode
      if (msg.type === 'plan_mode.request') {
        this.handleExitPlanMode(msg as PlanModeRequestMessage);
      }
    });

    // Send the query via WebSocket
    client.sendQuery(this.deps.tabId, promptToSend, {
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
    msgEl.className = 'claudian-message claudian-message-user';
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
    msgEl.className = 'claudian-message claudian-message-assistant';
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
  // Plan Mode Toggle
  // ============================================

  /**
   * Toggle permission mode between 'unleashed' and 'guarded'.
   * Called on Shift+Tab or when EnterPlanMode tool is detected in stream.
   */
  togglePlanMode(): void {
    const { client, state } = this.deps;
    const current = state.permissionMode ?? 'unleashed';
    const next = current === 'unleashed' ? 'guarded' : 'unleashed';
    state.permissionMode = next;
    client.sendSettingsUpdate(this.deps.tabId, { permissionMode: next });
    this.deps.onPermissionModeChanged?.(next);
  }

  /**
   * Set permission mode to a specific value (used by stream detection).
   */
  setPermissionMode(mode: 'unleashed' | 'guarded'): void {
    const { client, state } = this.deps;
    if (state.permissionMode === mode) return;
    state.permissionMode = mode;
    client.sendSettingsUpdate(this.deps.tabId, { permissionMode: mode });
    this.deps.onPermissionModeChanged?.(mode);
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

    client.sendInterrupt(this.deps.tabId);
    streamController.hideThinkingIndicator();
  }

  // ============================================
  // Approval Flow
  // ============================================

  approveToolCall(toolCallId: string): void {
    this.deps.client.sendApprove(this.deps.tabId, toolCallId);
  }

  denyToolCall(toolCallId: string): void {
    this.deps.client.sendDeny(this.deps.tabId, toolCallId);
  }

  allowAlwaysToolCall(toolCallId: string, pattern: string): void {
    this.deps.client.sendAllowAlways(this.deps.tabId, toolCallId, pattern);
  }

  /**
   * Handle an approval.request from the sidecar.
   * Renders an inline approve/deny/allow-always button row in the input area.
   */
  handleApprovalRequest(msg: ApprovalRequestMessage): void {
    const { doc, client, state } = this.deps;
    const tabId = this.deps.tabId;
    const { toolCallId, name: toolName, description } = msg;

    state.needsAttention = true;

    const container = doc.createElement('div');
    container.className = 'claudian-inline-approval';

    // Label
    const label = doc.createElement('div');
    label.className = 'claudian-inline-approval-label';
    label.textContent = description || `Allow ${toolName}?`;
    container.appendChild(label);

    // Button row
    const btnRow = doc.createElement('div');
    btnRow.className = 'claudian-inline-approval-buttons';

    const resolve = (action: () => void) => {
      action();
      state.needsAttention = false;
      this.dismissInlineEl();
    };

    const allowBtn = doc.createElement('button');
    allowBtn.className = 'claudian-inline-btn claudian-inline-btn-approve';
    allowBtn.textContent = 'Allow';
    allowBtn.addEventListener('click', () =>
      resolve(() => client.sendApprove(tabId, toolCallId))
    );
    btnRow.appendChild(allowBtn);

    const denyBtn = doc.createElement('button');
    denyBtn.className = 'claudian-inline-btn claudian-inline-btn-deny';
    denyBtn.textContent = 'Deny';
    denyBtn.addEventListener('click', () =>
      resolve(() => client.sendDeny(tabId, toolCallId))
    );
    btnRow.appendChild(denyBtn);

    const alwaysBtn = doc.createElement('button');
    alwaysBtn.className = 'claudian-inline-btn claudian-inline-btn-always';
    alwaysBtn.textContent = 'Always allow';
    alwaysBtn.addEventListener('click', () =>
      resolve(() => client.sendAllowAlways(tabId, toolCallId, toolName))
    );
    btnRow.appendChild(alwaysBtn);

    container.appendChild(btnRow);
    this.mountInlineEl(container);
  }

  /**
   * Handle an askuser.question from the sidecar.
   * Renders inline question fields in the input area.
   */
  handleAskUserQuestion(msg: AskUserQuestionMessage): void {
    const { doc, client, state } = this.deps;
    const tabId = this.deps.tabId;
    const { toolCallId, input } = msg;

    state.needsAttention = true;

    const container = doc.createElement('div');
    container.className = 'claudian-inline-askuser';

    // Extract questions from input
    const questions: Array<{ id: string; text: string }> = [];
    if (input.questions && Array.isArray(input.questions)) {
      for (const q of input.questions as Array<{ id?: string; text?: string }>) {
        if (q.text) {
          questions.push({ id: q.id ?? q.text, text: q.text });
        }
      }
    } else if (input.question && typeof input.question === 'string') {
      questions.push({ id: 'question', text: input.question as string });
    }

    if (questions.length === 0) {
      questions.push({ id: 'question', text: 'The agent has a question for you.' });
    }

    const inputFields: Array<{ id: string; el: HTMLInputElement }> = [];

    for (const q of questions) {
      const row = doc.createElement('div');
      row.className = 'claudian-inline-askuser-row';

      const label = doc.createElement('label');
      label.className = 'claudian-inline-askuser-label';
      label.textContent = q.text;
      row.appendChild(label);

      const field = doc.createElement('input');
      field.type = 'text';
      field.className = 'claudian-inline-askuser-input';
      field.placeholder = 'Type your answer...';
      row.appendChild(field);

      inputFields.push({ id: q.id, el: field });
      container.appendChild(row);
    }

    // Button row
    const btnRow = doc.createElement('div');
    btnRow.className = 'claudian-inline-approval-buttons';

    const submitBtn = doc.createElement('button');
    submitBtn.className = 'claudian-inline-btn claudian-inline-btn-approve';
    submitBtn.textContent = 'Submit';
    submitBtn.addEventListener('click', () => {
      const answers: Record<string, string> = {};
      for (const f of inputFields) {
        answers[f.id] = f.el.value;
      }
      client.sendAskUserAnswer(tabId, toolCallId, answers);
      state.needsAttention = false;
      this.dismissInlineEl();
    });
    btnRow.appendChild(submitBtn);

    const dismissBtn = doc.createElement('button');
    dismissBtn.className = 'claudian-inline-btn claudian-inline-btn-deny';
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.addEventListener('click', () => {
      client.sendAskUserDismiss(tabId, toolCallId);
      state.needsAttention = false;
      this.dismissInlineEl();
    });
    btnRow.appendChild(dismissBtn);

    container.appendChild(btnRow);
    this.mountInlineEl(container);

    // Focus the first input field
    if (inputFields.length > 0) {
      inputFields[0].el.focus();
    }
  }

  /**
   * Handle a plan_mode.request from the sidecar.
   * Renders an inline plan approval UI with approve / feedback / approve-new-session options.
   */
  handleExitPlanMode(msg: PlanModeRequestMessage): void {
    const { doc, client, state } = this.deps;
    const tabId = this.deps.tabId;
    const { toolCallId, input } = msg;

    state.needsAttention = true;

    const container = doc.createElement('div');
    container.className = 'claudian-inline-planmode';

    // Label
    const label = doc.createElement('div');
    label.className = 'claudian-inline-approval-label';
    label.textContent = 'The agent has a plan ready. How would you like to proceed?';
    container.appendChild(label);

    // Feedback input
    const feedbackRow = doc.createElement('div');
    feedbackRow.className = 'claudian-inline-askuser-row';
    const feedbackInput = doc.createElement('input');
    feedbackInput.type = 'text';
    feedbackInput.className = 'claudian-inline-askuser-input';
    feedbackInput.placeholder = 'Optional feedback...';
    feedbackRow.appendChild(feedbackInput);
    container.appendChild(feedbackRow);

    // Button row
    const btnRow = doc.createElement('div');
    btnRow.className = 'claudian-inline-approval-buttons';

    const approveBtn = doc.createElement('button');
    approveBtn.className = 'claudian-inline-btn claudian-inline-btn-approve';
    approveBtn.textContent = 'Approve';
    approveBtn.addEventListener('click', () => {
      client.sendPlanApprove(tabId, toolCallId);
      state.needsAttention = false;
      this.dismissInlineEl();
    });
    btnRow.appendChild(approveBtn);

    const feedbackBtn = doc.createElement('button');
    feedbackBtn.className = 'claudian-inline-btn claudian-inline-btn-always';
    feedbackBtn.textContent = 'Send feedback';
    feedbackBtn.addEventListener('click', () => {
      const text = feedbackInput.value.trim();
      if (!text) return;
      client.sendPlanFeedback(tabId, toolCallId, text);
      state.needsAttention = false;
      this.dismissInlineEl();
    });
    btnRow.appendChild(feedbackBtn);

    // Extract plan content for "approve as new session"
    const planContent =
      typeof input.plan === 'string' ? (input.plan as string) : '';

    const newSessionBtn = doc.createElement('button');
    newSessionBtn.className = 'claudian-inline-btn claudian-inline-btn-deny';
    newSessionBtn.textContent = 'New session';
    newSessionBtn.addEventListener('click', () => {
      client.sendPlanApproveNewSession(tabId, toolCallId, planContent);
      state.needsAttention = false;
      this.dismissInlineEl();
    });
    btnRow.appendChild(newSessionBtn);

    container.appendChild(btnRow);
    this.mountInlineEl(container);
  }

  // ============================================
  // Built-in Commands
  // ============================================

  /**
   * Handles a built-in slash command.
   * Returns true if the command was handled client-side, false to pass through to sidecar.
   */
  async handleBuiltInCommand(action: string, args: string): Promise<boolean> {
    const { conversationController, state, client } = this.deps;

    switch (action) {
      case 'clear':
        await conversationController.createNew();
        return true;

      case 'new':
        this.deps.onNewTab?.();
        return true;

      case 'resume':
        conversationController.toggleHistoryDropdown();
        return true;

      case 'fork': {
        if (!this.deps.onForkAll) return true;
        await this.deps.onForkAll();
        return true;
      }

      case 'generate': {
        if (!args) return true;
        // Send as a query with a generate-oriented prompt
        const generatePrompt = `Generate a D&D 5e ${args}. Output the result as a complete YAML code block that can be used in an Archivist stat block.`;
        void this.sendMessage({ content: generatePrompt });
        return true;
      }

      case 'search-srd': {
        if (!args) return true;
        // Send as a query asking the AI to search SRD
        const searchPrompt = `Search the SRD for: ${args}`;
        void this.sendMessage({ content: searchPrompt });
        return true;
      }

      case 'roll': {
        if (!args) return true;
        try {
          const { rollDice } = await import('../../dice/roll');
          await rollDice(args);
        } catch {
          // Dice engine not available or invalid notation — show inline feedback
          this.showEphemeralNotice(`Could not roll: ${args}`);
        }
        return true;
      }

      default:
        return false;
    }
  }

  /**
   * Shows a brief ephemeral notice in the messages area.
   */
  private showEphemeralNotice(text: string): void {
    const { doc } = this.deps;
    const messagesEl = this.deps.getMessagesEl();
    const noticeEl = doc.createElement('div');
    noticeEl.className = 'claudian-ephemeral-notice';
    noticeEl.textContent = text;
    messagesEl.appendChild(noticeEl);

    setTimeout(() => {
      noticeEl.style.opacity = '0';
      setTimeout(() => noticeEl.remove(), 400);
    }, 3000);
  }

  // ============================================
  // Inline Element Management
  // ============================================

  /**
   * Mount an inline element in the input container, hiding the normal input.
   */
  private mountInlineEl(el: HTMLElement): void {
    this.dismissInlineEl();

    const inputEl = this.deps.getInputEl();
    inputEl.style.display = 'none';

    const inputContainerEl = this.deps.getInputContainerEl();
    inputContainerEl.appendChild(el);

    this.activeInlineEl = el;
  }

  /**
   * Remove the active inline element and restore normal input.
   */
  private dismissInlineEl(): void {
    if (this.activeInlineEl) {
      this.activeInlineEl.remove();
      this.activeInlineEl = null;
    }

    const inputEl = this.deps.getInputEl();
    inputEl.style.display = '';
  }

  // ============================================
  // Cleanup
  // ============================================

  dispose(): void {
    if (this.unsubscribeMessage) {
      this.unsubscribeMessage();
      this.unsubscribeMessage = null;
    }
    this.dismissInlineEl();
  }
}
