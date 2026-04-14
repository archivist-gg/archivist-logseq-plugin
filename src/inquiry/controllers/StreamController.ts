/**
 * StreamController — Handles incoming WebSocket server messages during streaming.
 *
 * Ported from Obsidian's StreamController.
 * Receives `ServerMessage` from WebSocket (via `client.onMessage()`) instead of
 * `StreamChunk` from `ClaudianService`.
 * Maps server message types: `stream.text` -> text, `stream.tool_use` -> tool call, etc.
 * Removes `plugin: InquiryModule` dep, uses `client: SidecarClient` and `doc: Document`.
 */

import type { SidecarClient } from '../SidecarClient';
import type {
  ServerMessage,
  StreamToolResultMessage,
  StreamToolUseMessage,
} from '../protocol';
import type { ChatState } from '../state/ChatState';
import type {
  ChatMessage,
  ToolCallInfo,
} from '../state/types';
import { setIcon } from '../shared/icons';

// Flavor texts shown while waiting for a response
const FLAVOR_TEXTS: Array<{ text: string; icon: string }> = [
  { text: 'Thinking...', icon: 'brain' },
  { text: 'Pondering...', icon: 'brain' },
  { text: 'Mulling it over...', icon: 'brain' },
  { text: 'Contemplating...', icon: 'brain' },
  { text: 'Processing...', icon: 'loader' },
  { text: 'Working on it...', icon: 'loader' },
];

function formatDurationMmSs(seconds: number): string {
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return mm > 0 ? `${mm}m ${ss}s` : `${ss}s`;
}

export interface StreamControllerDeps {
  client: SidecarClient;
  doc: Document;
  state: ChatState;
  getMessagesEl: () => HTMLElement;
  /** Optional callback to update queue indicator in parent UI. */
  updateQueueIndicator?: () => void;
}

/**
 * Adapts between MessageRenderer interface and direct DOM updates.
 * This is a minimal interface — the full MessageRenderer will be wired in the panel.
 */
export interface StreamRendererBridge {
  renderContent(el: HTMLElement, markdown: string, options?: { skipDndReplacement?: boolean }): Promise<void> | void;
  addTextCopyButton?(el: HTMLElement, text: string): void;
}

export class StreamController {
  private deps: StreamControllerDeps;
  private rendererBridge: StreamRendererBridge | null = null;

  constructor(deps: StreamControllerDeps) {
    this.deps = deps;
  }

  setRendererBridge(bridge: StreamRendererBridge): void {
    this.rendererBridge = bridge;
  }

  // ============================================
  // Server Message Routing
  // ============================================

  /**
   * Route an incoming server message to the appropriate handler.
   * Called from the panel's onMessage listener.
   */
  async handleServerMessage(msg: ServerMessage, assistantMsg: ChatMessage): Promise<void> {
    const { state } = this.deps;

    switch (msg.type) {
      case 'stream.thinking':
        if (state.currentTextEl) {
          this.finalizeCurrentTextBlock(assistantMsg);
        }
        await this.appendThinking(msg.text);
        break;

      case 'stream.text':
        if (state.currentThinkingState) {
          this.finalizeCurrentThinkingBlock(assistantMsg);
        }
        assistantMsg.content += msg.text;
        await this.appendText(msg.text);
        break;

      case 'stream.tool_use':
        if (state.currentThinkingState) {
          this.finalizeCurrentThinkingBlock(assistantMsg);
        }
        this.finalizeCurrentTextBlock(assistantMsg);
        this.handleToolUse(msg, assistantMsg);
        break;

      case 'stream.tool_result':
        this.handleToolResult(msg, assistantMsg);
        break;

      case 'stream.blocked':
        await this.appendText(`\n\n**Blocked:** ${msg.content}`);
        break;

      case 'stream.error':
        await this.appendText(`\n\n**Error:** ${msg.message}`);
        break;

      case 'stream.done':
        // Flush any remaining state
        break;

      case 'stream.compact_boundary':
        if (state.currentThinkingState) {
          this.finalizeCurrentThinkingBlock(assistantMsg);
        }
        this.finalizeCurrentTextBlock(assistantMsg);
        assistantMsg.contentBlocks = assistantMsg.contentBlocks || [];
        assistantMsg.contentBlocks.push({ type: 'compact_boundary' });
        this.renderCompactBoundary();
        break;

      case 'stream.sdk_assistant_uuid':
        assistantMsg.sdkAssistantUuid = msg.uuid;
        break;

      case 'stream.sdk_user_uuid':
      case 'stream.sdk_user_sent':
        // Handled by InputController
        break;

      case 'stream.usage': {
        if (!state.ignoreUsageUpdates) {
          state.usage = msg.usage;
        }
        break;
      }

      case 'stream.context_window': {
        if (state.usage && msg.contextWindow > 0) {
          const contextWindow = msg.contextWindow;
          const percentage = Math.min(
            100,
            Math.max(0, Math.round((state.usage.contextTokens / contextWindow) * 100))
          );
          state.usage = { ...state.usage, contextWindow, percentage };
        }
        break;
      }

      case 'stream.subagent':
        // TODO: Wire subagent rendering when SubagentManager is ported
        break;

      // Non-stream messages are not handled here
      default:
        break;
    }

    this.scrollToBottom();
  }

  // ============================================
  // Tool Use Handling
  // ============================================

  private handleToolUse(msg: StreamToolUseMessage, assistantMsg: ChatMessage): void {
    const { state, doc } = this.deps;

    // Check if this is an update to an existing tool call
    const existingToolCall = assistantMsg.toolCalls?.find(tc => tc.id === msg.id);
    if (existingToolCall) {
      const newInput = msg.input || {};
      if (Object.keys(newInput).length > 0) {
        existingToolCall.input = { ...existingToolCall.input, ...newInput };

        // If already rendered, update the header name
        const toolEl = state.toolCallElements.get(msg.id);
        if (toolEl) {
          const nameEl = toolEl.querySelector('.claudian-tool-name') as HTMLElement | null;
          if (nameEl) {
            nameEl.textContent = msg.name;
          }
        }
      }
      return;
    }

    // Create new tool call
    const toolCall: ToolCallInfo = {
      id: msg.id,
      name: msg.name,
      input: msg.input,
      status: 'running',
      isExpanded: false,
    };
    assistantMsg.toolCalls = assistantMsg.toolCalls || [];
    assistantMsg.toolCalls.push(toolCall);

    // Add to contentBlocks for ordering
    assistantMsg.contentBlocks = assistantMsg.contentBlocks || [];
    assistantMsg.contentBlocks.push({ type: 'tool_use', toolId: msg.id });

    // Render the tool call element
    if (state.currentContentEl) {
      const toolEl = this.renderToolCall(doc, state.currentContentEl, toolCall);
      state.toolCallElements.set(msg.id, toolEl);
      this.showThinkingIndicator();
    }
  }

  private handleToolResult(msg: StreamToolResultMessage, assistantMsg: ChatMessage): void {
    const { state } = this.deps;

    const existingToolCall = assistantMsg.toolCalls?.find(tc => tc.id === msg.id);
    if (existingToolCall) {
      if (msg.isError) {
        existingToolCall.status = 'error';
      } else {
        existingToolCall.status = 'completed';
      }
      existingToolCall.result = msg.content;

      // Update the rendered element
      const toolEl = state.toolCallElements.get(msg.id);
      if (toolEl) {
        const statusEl = toolEl.querySelector('.claudian-tool-status') as HTMLElement | null;
        if (statusEl) {
          statusEl.textContent = existingToolCall.status;
          toolEl.classList.remove('claudian-tool--running');
          toolEl.classList.add(
            existingToolCall.status === 'completed'
              ? 'claudian-tool--completed'
              : 'claudian-tool--error'
          );
        }
        // Update icon
        const iconEl = toolEl.querySelector('.claudian-tool-icon') as HTMLElement | null;
        if (iconEl) {
          if (existingToolCall.status === 'completed') {
            setIcon(iconEl, 'check');
          } else {
            setIcon(iconEl, 'x');
          }
        }
      }
    }

    this.showThinkingIndicator();
  }

  /**
   * Renders a tool call element in the DOM.
   */
  private renderToolCall(
    doc: Document,
    parentEl: HTMLElement,
    toolCall: ToolCallInfo
  ): HTMLElement {
    const toolEl = doc.createElement('div');
    toolEl.className = 'claudian-tool claudian-tool--running';

    const headerEl = doc.createElement('div');
    headerEl.className = 'claudian-tool-header';

    const iconEl = doc.createElement('span');
    iconEl.className = 'claudian-tool-icon';
    setIcon(iconEl, 'terminal');
    headerEl.appendChild(iconEl);

    const nameEl = doc.createElement('span');
    nameEl.className = 'claudian-tool-name';
    nameEl.textContent = toolCall.name;
    headerEl.appendChild(nameEl);

    const statusEl = doc.createElement('span');
    statusEl.className = 'claudian-tool-status';
    statusEl.textContent = 'running';
    headerEl.appendChild(statusEl);

    toolEl.appendChild(headerEl);
    parentEl.appendChild(toolEl);

    return toolEl;
  }

  // ============================================
  // Text Block Management
  // ============================================

  async appendText(text: string): Promise<void> {
    const { state, doc } = this.deps;
    if (!state.currentContentEl) return;

    this.hideThinkingIndicator();

    if (!state.currentTextEl) {
      state.currentTextEl = doc.createElement('div');
      state.currentTextEl.className = 'claudian-text-block';
      state.currentContentEl.appendChild(state.currentTextEl);
      state.currentTextContent = '';
    }

    state.currentTextContent += text;
    if (this.rendererBridge) {
      await this.rendererBridge.renderContent(state.currentTextEl, state.currentTextContent, {
        skipDndReplacement: true,
      });
    } else {
      state.currentTextEl.textContent = state.currentTextContent;
    }
  }

  finalizeCurrentTextBlock(msg?: ChatMessage): void {
    const { state } = this.deps;
    if (msg && state.currentTextContent) {
      msg.contentBlocks = msg.contentBlocks || [];
      msg.contentBlocks.push({ type: 'text', content: state.currentTextContent });
      // Copy button
      if (state.currentTextEl && this.rendererBridge?.addTextCopyButton) {
        this.rendererBridge.addTextCopyButton(state.currentTextEl, state.currentTextContent);
      }
    }
    // Final render without skipDndReplacement
    if (state.currentTextEl && state.currentTextContent && this.rendererBridge) {
      void this.rendererBridge.renderContent(state.currentTextEl, state.currentTextContent);
    }
    state.currentTextEl = null;
    state.currentTextContent = '';
  }

  // ============================================
  // Thinking Block Management
  // ============================================

  async appendThinking(content: string): Promise<void> {
    const { state, doc } = this.deps;
    if (!state.currentContentEl) return;

    this.hideThinkingIndicator();

    if (!state.currentThinkingState) {
      // Create thinking block
      const wrapperEl = doc.createElement('div');
      wrapperEl.className = 'claudian-thinking-block';

      const labelEl = doc.createElement('div');
      labelEl.className = 'claudian-thinking-label';
      labelEl.textContent = 'Thinking...';
      wrapperEl.appendChild(labelEl);

      const contentEl = doc.createElement('div');
      contentEl.className = 'claudian-thinking-content';
      wrapperEl.appendChild(contentEl);

      state.currentContentEl.appendChild(wrapperEl);

      state.currentThinkingState = {
        wrapperEl,
        contentEl,
        labelEl,
        content: '',
        startTime: Date.now(),
        timerInterval: null,
        isExpanded: false,
      };
    }

    state.currentThinkingState.content += content;
    if (this.rendererBridge) {
      await this.rendererBridge.renderContent(
        state.currentThinkingState.contentEl,
        state.currentThinkingState.content
      );
    } else {
      state.currentThinkingState.contentEl.textContent = state.currentThinkingState.content;
    }
  }

  finalizeCurrentThinkingBlock(msg?: ChatMessage): void {
    const { state } = this.deps;
    if (!state.currentThinkingState) return;

    const durationSeconds = Math.floor(
      (Date.now() - state.currentThinkingState.startTime) / 1000
    );

    // Update label with duration
    state.currentThinkingState.labelEl.textContent =
      `Thought for ${formatDurationMmSs(durationSeconds)}`;

    if (state.currentThinkingState.timerInterval) {
      clearInterval(state.currentThinkingState.timerInterval);
    }

    if (msg && state.currentThinkingState.content) {
      msg.contentBlocks = msg.contentBlocks || [];
      msg.contentBlocks.push({
        type: 'thinking',
        content: state.currentThinkingState.content,
        durationSeconds,
      });
    }

    state.currentThinkingState = null;
  }

  // ============================================
  // Thinking Indicator (Flavor Text)
  // ============================================

  /** Debounce delay before showing thinking indicator (ms). */
  private static readonly THINKING_INDICATOR_DELAY = 400;

  showThinkingIndicator(overrideText?: string, overrideCls?: string): void {
    const { state, doc } = this.deps;

    if (!state.currentContentEl) return;

    // Clear any existing timeout
    if (state.thinkingIndicatorTimeout) {
      clearTimeout(state.thinkingIndicatorTimeout);
      state.thinkingIndicatorTimeout = null;
    }

    // Don't show flavor text while model thinking block is active
    if (state.currentThinkingState) {
      return;
    }

    // If indicator already exists, just re-append it to the bottom
    if (state.thinkingEl) {
      state.currentContentEl.appendChild(state.thinkingEl);
      this.deps.updateQueueIndicator?.();
      return;
    }

    // Schedule showing the indicator after a delay
    state.thinkingIndicatorTimeout = setTimeout(() => {
      state.thinkingIndicatorTimeout = null;
      if (!state.currentContentEl || state.thinkingEl || state.currentThinkingState) return;

      const cls = overrideCls
        ? `claudian-thinking ${overrideCls}`
        : 'claudian-thinking';
      state.thinkingEl = doc.createElement('div');
      state.thinkingEl.className = cls;

      const flavor = overrideText
        ? { text: overrideText, icon: 'message-square' }
        : FLAVOR_TEXTS[Math.floor(Math.random() * FLAVOR_TEXTS.length)];

      const iconEl = doc.createElement('span');
      iconEl.className = 'claudian-thinking-icon';
      setIcon(iconEl, flavor.icon);
      state.thinkingEl.appendChild(iconEl);

      const textSpan = doc.createElement('span');
      textSpan.textContent = flavor.text;
      state.thinkingEl.appendChild(textSpan);

      // Create timer span with initial value
      const timerSpan = doc.createElement('span');
      timerSpan.className = 'claudian-thinking-hint';
      const updateTimer = () => {
        if (!state.responseStartTime) return;
        if (!timerSpan.isConnected) {
          if (state.flavorTimerInterval) {
            clearInterval(state.flavorTimerInterval);
            state.flavorTimerInterval = null;
          }
          return;
        }
        const elapsedSeconds = Math.floor(
          (performance.now() - state.responseStartTime) / 1000
        );
        timerSpan.textContent = ` (esc to interrupt · ${formatDurationMmSs(elapsedSeconds)})`;
      };
      updateTimer();
      state.thinkingEl.appendChild(timerSpan);

      // Start interval to update timer every second
      if (state.flavorTimerInterval) {
        clearInterval(state.flavorTimerInterval);
      }
      state.flavorTimerInterval = setInterval(updateTimer, 1000);

      // Queue indicator line (initially hidden)
      state.queueIndicatorEl = doc.createElement('div');
      state.queueIndicatorEl.className = 'claudian-queue-indicator';
      state.thinkingEl.appendChild(state.queueIndicatorEl);

      state.currentContentEl!.appendChild(state.thinkingEl);
      this.deps.updateQueueIndicator?.();
    }, StreamController.THINKING_INDICATOR_DELAY);
  }

  /** Hides the thinking indicator and cancels any pending show timeout. */
  hideThinkingIndicator(): void {
    const { state } = this.deps;

    // Cancel any pending show timeout
    if (state.thinkingIndicatorTimeout) {
      clearTimeout(state.thinkingIndicatorTimeout);
      state.thinkingIndicatorTimeout = null;
    }

    // Clear timer interval (but preserve responseStartTime for duration capture)
    state.clearFlavorTimerInterval();

    if (state.thinkingEl) {
      state.thinkingEl.remove();
      state.thinkingEl = null;
    }
    state.queueIndicatorEl = null;
  }

  // ============================================
  // Compact Boundary
  // ============================================

  private renderCompactBoundary(): void {
    const { state, doc } = this.deps;
    if (!state.currentContentEl) return;
    this.hideThinkingIndicator();

    const el = doc.createElement('div');
    el.className = 'claudian-compact-boundary';
    const label = doc.createElement('span');
    label.className = 'claudian-compact-boundary-label';
    label.textContent = 'Conversation compacted';
    el.appendChild(label);
    state.currentContentEl.appendChild(el);
  }

  // ============================================
  // Utilities
  // ============================================

  /** Scrolls messages to bottom if auto-scroll is enabled. */
  private scrollToBottom(): void {
    const { state } = this.deps;
    if (!state.autoScrollEnabled) return;

    const messagesEl = this.deps.getMessagesEl();
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  resetStreamingState(): void {
    const { state } = this.deps;
    this.hideThinkingIndicator();
    state.currentContentEl = null;
    state.currentTextEl = null;
    state.currentTextContent = '';
    state.currentThinkingState = null;
    // Reset response timer (duration already captured at this point)
    state.responseStartTime = null;
  }
}
