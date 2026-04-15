import type { SidecarClient } from '../SidecarClient';
import type { ChatMessage, ImageAttachment, SubagentInfo, ToolCallInfo } from '../state/types';
import { renderMarkdownToEl } from './markdown';
import { replaceDndCodeFences, type CopyAndSaveCallback } from './DndEntityRenderer';
import {
  isSubagentToolName,
  isWriteEditTool,
  TOOL_AGENT_OUTPUT,
  renderDndEntityAfterToolCall,
  renderStoredToolCall,
} from './ToolCallRenderer';
import { renderStoredWriteEdit } from './WriteEditRenderer';
import { renderStoredSubagent, renderStoredAsyncSubagent } from './SubagentRenderer';
import { renderStoredThinkingBlock } from './ThinkingBlockRenderer';

export type RenderContentFn = (el: HTMLElement, markdown: string) => Promise<void>;

/**
 * Format duration as mm:ss.
 */
function formatDurationMmSs(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const paddedSeconds = seconds < 10 ? `0${seconds}` : `${seconds}`;
  return minutes > 0 ? `${minutes}:${paddedSeconds}` : `${seconds}s`;
}

/**
 * Sets trusted static SVG content on an element.
 * These are hardcoded icon SVGs from Lucide, not user input.
 */
function setTrustedSvg(el: HTMLElement, svg: string): void {
  // eslint-disable-next-line no-unsanitized/property
  el.innerHTML = svg;
}

/** Clears an element's child content (safe wrapper). */
function clearEl(el: HTMLElement): void {
  // eslint-disable-next-line no-unsanitized/property
  el.innerHTML = '';
}

export class MessageRenderer {
  private doc: Document;
  private client: SidecarClient;
  private messagesEl: HTMLElement;
  private onPageClick?: (pageName: string) => void;
  private rewindCallback?: (messageId: string) => Promise<void>;
  private forkCallback?: (messageId: string) => Promise<void>;
  private dndCopyAndSaveCallback?: CopyAndSaveCallback;
  private liveMessageEls = new Map<string, HTMLElement>();

  private static readonly COPY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;

  private static readonly REWIND_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`;

  private static readonly FORK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9"/><path d="M12 12v3"/></svg>`;

  constructor(
    doc: Document,
    client: SidecarClient,
    messagesEl: HTMLElement,
    onPageClick?: (pageName: string) => void,
    rewindCallback?: (messageId: string) => Promise<void>,
    forkCallback?: (messageId: string) => Promise<void>,
  ) {
    this.doc = doc;
    this.client = client;
    this.messagesEl = messagesEl;
    this.onPageClick = onPageClick;
    this.rewindCallback = rewindCallback;
    this.forkCallback = forkCallback;
  }

  /** Sets the messages container element. */
  setMessagesEl(el: HTMLElement): void {
    this.messagesEl = el;
  }

  /** Sets the callback for D&D entity Copy & Save buttons. */
  setDndCopyAndSaveCallback(cb: CopyAndSaveCallback): void {
    this.dndCopyAndSaveCallback = cb;
  }

  /** Returns the current D&D Copy & Save callback (for use by external renderers). */
  getDndCopyAndSaveCallback(): CopyAndSaveCallback | undefined {
    return this.dndCopyAndSaveCallback;
  }

  // ============================================
  // Streaming Message Rendering
  // ============================================

  /**
   * Adds a new message to the chat during streaming.
   * Returns the message element for content updates.
   */
  addMessage(msg: ChatMessage): HTMLElement {
    // Render images above message bubble for user messages
    if (msg.role === 'user' && msg.images && msg.images.length > 0) {
      this.renderMessageImages(this.messagesEl, msg.images);
    }

    // Skip empty bubble for image-only messages
    if (msg.role === 'user') {
      const textToShow = msg.displayContent ?? msg.content;
      if (!textToShow) {
        this.scrollToBottom();
        const lastChild = this.messagesEl.lastElementChild as HTMLElement;
        return lastChild ?? this.messagesEl;
      }
    }

    const msgEl = this.doc.createElement('div');
    msgEl.className = `claudian-message claudian-message-${msg.role}`;
    msgEl.dataset.messageId = msg.id;
    msgEl.dataset.role = msg.role;
    this.messagesEl.appendChild(msgEl);

    const contentEl = this.doc.createElement('div');
    contentEl.className = 'claudian-message-content';
    contentEl.setAttribute('dir', 'auto');
    msgEl.appendChild(contentEl);

    if (msg.role === 'user') {
      const textToShow = msg.displayContent ?? msg.content;
      if (textToShow) {
        const textEl = this.doc.createElement('div');
        textEl.className = 'claudian-text-block';
        contentEl.appendChild(textEl);
        void this.renderContent(textEl, textToShow);
        this.addUserCopyButton(msgEl, textToShow);
      }
      if (this.rewindCallback || this.forkCallback) {
        this.liveMessageEls.set(msg.id, msgEl);
      }
    }

    this.scrollToBottom();
    return msgEl;
  }

  // ============================================
  // Stored Message Rendering (Batch/Replay)
  // ============================================

  /**
   * Renders all messages for conversation load/switch.
   */
  renderMessages(
    messages: ChatMessage[],
    getGreeting: () => string,
  ): HTMLElement {
    while (this.messagesEl.firstChild) this.messagesEl.removeChild(this.messagesEl.firstChild);
    this.liveMessageEls.clear();

    // Create welcome element
    const welcomeEl = this.doc.createElement('div');
    welcomeEl.className = 'claudian-welcome';
    this.messagesEl.appendChild(welcomeEl);

    const greetingEl = this.doc.createElement('div');
    greetingEl.className = 'claudian-welcome-greeting';
    greetingEl.textContent = getGreeting();
    welcomeEl.appendChild(greetingEl);

    const subtitleEl = this.doc.createElement('div');
    subtitleEl.className = 'claudian-welcome-subtitle';
    subtitleEl.textContent = 'What knowledge do you seek?';
    welcomeEl.appendChild(subtitleEl);

    for (let i = 0; i < messages.length; i++) {
      this.renderStoredMessage(messages[i], messages, i);
    }

    this.scrollToBottom();
    return welcomeEl;
  }

  renderStoredMessage(msg: ChatMessage, allMessages?: ChatMessage[], index?: number): void {
    // Render interrupt messages with special styling
    if (msg.isInterrupt) {
      this.renderInterruptMessage();
      return;
    }

    // Skip rebuilt context messages
    if (msg.isRebuiltContext) return;

    // Render images above bubble for user messages
    if (msg.role === 'user' && msg.images && msg.images.length > 0) {
      this.renderMessageImages(this.messagesEl, msg.images);
    }

    // Skip empty bubble for image-only messages
    if (msg.role === 'user') {
      const textToShow = msg.displayContent ?? msg.content;
      if (!textToShow) return;
    }

    const msgEl = this.doc.createElement('div');
    msgEl.className = `claudian-message claudian-message-${msg.role}`;
    msgEl.dataset.messageId = msg.id;
    msgEl.dataset.role = msg.role;
    this.messagesEl.appendChild(msgEl);

    const contentEl = this.doc.createElement('div');
    contentEl.className = 'claudian-message-content';
    contentEl.setAttribute('dir', 'auto');
    msgEl.appendChild(contentEl);

    if (msg.role === 'user') {
      const textToShow = msg.displayContent ?? msg.content;
      if (textToShow) {
        const textEl = this.doc.createElement('div');
        textEl.className = 'claudian-text-block';
        contentEl.appendChild(textEl);
        void this.renderContent(textEl, textToShow);
        this.addUserCopyButton(msgEl, textToShow);
      }
      if (msg.sdkUserUuid && this.isRewindEligible(allMessages, index)) {
        if (this.rewindCallback) {
          this.addRewindButton(msgEl, msg.id);
        }
        if (this.forkCallback) {
          this.addForkButton(msgEl, msg.id);
        }
      }
    } else if (msg.role === 'assistant') {
      this.renderAssistantContent(msg, contentEl);
    }
  }

  /**
   * Renders an interrupt indicator.
   */
  private renderInterruptMessage(): void {
    const msgEl = this.doc.createElement('div');
    msgEl.className = 'claudian-message claudian-message-assistant';
    this.messagesEl.appendChild(msgEl);

    const contentEl = this.doc.createElement('div');
    contentEl.className = 'claudian-message-content';
    contentEl.setAttribute('dir', 'auto');
    msgEl.appendChild(contentEl);

    const textEl = this.doc.createElement('div');
    textEl.className = 'claudian-text-block';
    contentEl.appendChild(textEl);

    // Build interrupt message from DOM nodes (no innerHTML)
    const interruptSpan = this.doc.createElement('span');
    interruptSpan.className = 'claudian-interrupted';
    interruptSpan.textContent = 'Interrupted';
    textEl.appendChild(interruptSpan);

    const hintSpan = this.doc.createElement('span');
    hintSpan.className = 'claudian-interrupted-hint';
    hintSpan.textContent = ' \u00B7 What should Claudian do instead?';
    textEl.appendChild(hintSpan);
  }

  /**
   * Renders assistant message content (content blocks or fallback).
   */
  private renderAssistantContent(msg: ChatMessage, contentEl: HTMLElement): void {
    if (msg.contentBlocks && msg.contentBlocks.length > 0) {
      const renderedToolIds = new Set<string>();

      for (const block of msg.contentBlocks) {
        if (block.type === 'thinking') {
          renderStoredThinkingBlock(
            this.doc,
            contentEl,
            block.content,
            block.durationSeconds,
            (el, md) => this.renderContent(el, md),
          );
        } else if (block.type === 'text') {
          if (!block.content || !block.content.trim()) continue;
          const textEl = this.doc.createElement('div');
          textEl.className = 'claudian-text-block';
          contentEl.appendChild(textEl);
          void this.renderContent(textEl, block.content);
          this.addTextCopyButton(textEl, block.content);
        } else if (block.type === 'tool_use') {
          const toolCall = msg.toolCalls?.find(tc => tc.id === block.toolId);
          if (toolCall) {
            this.renderToolCallBlock(contentEl, toolCall);
            renderedToolIds.add(toolCall.id);
          }
        } else if (block.type === 'compact_boundary') {
          const boundaryEl = this.doc.createElement('div');
          boundaryEl.className = 'claudian-compact-boundary';
          contentEl.appendChild(boundaryEl);

          const labelEl = this.doc.createElement('span');
          labelEl.className = 'claudian-compact-boundary-label';
          labelEl.textContent = 'Conversation compacted';
          boundaryEl.appendChild(labelEl);
        } else if (block.type === 'subagent') {
          const taskToolCall = msg.toolCalls?.find(
            tc => tc.id === block.subagentId && isSubagentToolName(tc.name),
          );
          if (!taskToolCall) continue;
          this.renderTaskSubagent(contentEl, taskToolCall, block.mode);
          renderedToolIds.add(taskToolCall.id);
        }
      }

      // Defensive fallback: render any tool calls not covered by contentBlocks
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        for (const toolCall of msg.toolCalls) {
          if (renderedToolIds.has(toolCall.id)) continue;
          this.renderToolCallBlock(contentEl, toolCall);
          renderedToolIds.add(toolCall.id);
        }
      }
    } else {
      // Fallback for old conversations without contentBlocks
      if (msg.content) {
        const textEl = this.doc.createElement('div');
        textEl.className = 'claudian-text-block';
        contentEl.appendChild(textEl);
        void this.renderContent(textEl, msg.content);
        this.addTextCopyButton(textEl, msg.content);
      }
      if (msg.toolCalls) {
        for (const toolCall of msg.toolCalls) {
          this.renderToolCallBlock(contentEl, toolCall);
        }
      }
    }

    // Render response duration footer
    const hasCompactBoundary = msg.contentBlocks?.some(b => b.type === 'compact_boundary');
    if (msg.durationSeconds && msg.durationSeconds > 0 && !hasCompactBoundary) {
      const flavorWord = msg.durationFlavorWord || 'Baked';
      const footerEl = this.doc.createElement('div');
      footerEl.className = 'claudian-response-footer';
      contentEl.appendChild(footerEl);

      const durationEl = this.doc.createElement('span');
      durationEl.className = 'claudian-baked-duration';
      durationEl.textContent = `* ${flavorWord} for ${formatDurationMmSs(msg.durationSeconds)}`;
      footerEl.appendChild(durationEl);
    }
  }

  /**
   * Renders a tool call with special handling for Write/Edit and Agent (subagent).
   */
  private renderToolCallBlock(contentEl: HTMLElement, toolCall: ToolCallInfo): void {
    // Skip TaskOutput - it's invisible (internal async subagent communication)
    if (toolCall.name === TOOL_AGENT_OUTPUT) return;

    if (isWriteEditTool(toolCall.name)) {
      renderStoredWriteEdit(this.doc, contentEl, toolCall);
    } else if (isSubagentToolName(toolCall.name)) {
      this.renderTaskSubagent(contentEl, toolCall);
    } else {
      renderStoredToolCall(this.doc, contentEl, toolCall, this.dndCopyAndSaveCallback);
    }

    // Render D&D entity block as a sibling AFTER the tool call collapsible
    renderDndEntityAfterToolCall(this.doc, contentEl, toolCall, this.dndCopyAndSaveCallback);
  }

  private renderTaskSubagent(
    contentEl: HTMLElement,
    toolCall: ToolCallInfo,
    modeHint?: 'sync' | 'async',
  ): void {
    const subagentInfo = this.resolveTaskSubagent(toolCall, modeHint);
    if (subagentInfo.mode === 'async') {
      renderStoredAsyncSubagent(this.doc, contentEl, subagentInfo);
      return;
    }
    renderStoredSubagent(this.doc, contentEl, subagentInfo);
  }

  private resolveTaskSubagent(toolCall: ToolCallInfo, modeHint?: 'sync' | 'async'): SubagentInfo {
    if (toolCall.subagent) {
      if (!modeHint || toolCall.subagent.mode === modeHint) {
        return toolCall.subagent;
      }
      return { ...toolCall.subagent, mode: modeHint };
    }

    const description = (toolCall.input?.description as string) || 'Subagent task';
    const prompt = (toolCall.input?.prompt as string) || '';
    const mode = modeHint ?? (toolCall.input?.run_in_background === true ? 'async' : 'sync');

    if (mode !== 'async') {
      return {
        id: toolCall.id,
        description,
        prompt,
        status: this.mapToolStatusToSubagentStatus(toolCall.status),
        toolCalls: [],
        isExpanded: false,
        result: toolCall.result,
      };
    }

    const asyncStatus = this.inferAsyncStatusFromTaskTool(toolCall);
    return {
      id: toolCall.id,
      description,
      prompt,
      mode: 'async',
      status: asyncStatus,
      asyncStatus,
      toolCalls: [],
      isExpanded: false,
      result: toolCall.result,
    };
  }

  private mapToolStatusToSubagentStatus(
    status: ToolCallInfo['status'],
  ): 'completed' | 'error' | 'running' {
    switch (status) {
      case 'completed':
        return 'completed';
      case 'error':
      case 'blocked':
        return 'error';
      default:
        return 'running';
    }
  }

  private inferAsyncStatusFromTaskTool(toolCall: ToolCallInfo): 'running' | 'completed' | 'error' {
    if (toolCall.status === 'error' || toolCall.status === 'blocked') return 'error';
    if (toolCall.status === 'running') return 'running';

    const lowerResult = (toolCall.result || '').toLowerCase();
    if (
      lowerResult.includes('not_ready') ||
      lowerResult.includes('not ready') ||
      lowerResult.includes('"status":"running"') ||
      lowerResult.includes('"status":"pending"') ||
      lowerResult.includes('"retrieval_status":"running"') ||
      lowerResult.includes('"retrieval_status":"not_ready"')
    ) {
      return 'running';
    }

    return 'completed';
  }

  // ============================================
  // Image Rendering
  // ============================================

  renderMessageImages(containerEl: HTMLElement, images: ImageAttachment[]): void {
    const imagesEl = this.doc.createElement('div');
    imagesEl.className = 'claudian-message-images';
    containerEl.appendChild(imagesEl);

    for (const image of images) {
      const imageWrapper = this.doc.createElement('div');
      imageWrapper.className = 'claudian-message-image';
      imagesEl.appendChild(imageWrapper);

      const imgEl = this.doc.createElement('img');
      imgEl.setAttribute('alt', image.name);
      imageWrapper.appendChild(imgEl);

      this.setImageSrc(imgEl, image);

      imgEl.addEventListener('click', () => {
        this.showFullImage(image);
      });
    }
  }

  showFullImage(image: ImageAttachment): void {
    const dataUri = `data:${image.mediaType};base64,${image.data}`;

    const overlay = this.doc.createElement('div');
    overlay.className = 'claudian-image-modal-overlay';
    this.doc.body.appendChild(overlay);

    const modal = this.doc.createElement('div');
    modal.className = 'claudian-image-modal';
    overlay.appendChild(modal);

    const imgEl = this.doc.createElement('img');
    imgEl.setAttribute('src', dataUri);
    imgEl.setAttribute('alt', image.name);
    modal.appendChild(imgEl);

    const closeBtn = this.doc.createElement('div');
    closeBtn.className = 'claudian-image-modal-close';
    closeBtn.textContent = '\u00D7';
    modal.appendChild(closeBtn);

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };

    const close = () => {
      this.doc.removeEventListener('keydown', handleEsc);
      overlay.remove();
    };

    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    this.doc.addEventListener('keydown', handleEsc);
  }

  setImageSrc(imgEl: HTMLImageElement, image: ImageAttachment): void {
    const dataUri = `data:${image.mediaType};base64,${image.data}`;
    imgEl.setAttribute('src', dataUri);
  }

  // ============================================
  // Content Rendering
  // ============================================

  async renderContent(el: HTMLElement, markdown: string): Promise<void> {
    while (el.firstChild) el.removeChild(el.firstChild);

    try {
      renderMarkdownToEl(this.doc, el, markdown, this.onPageClick);

      // Wrap pre elements and add code header bars
      el.querySelectorAll('pre').forEach((pre) => {
        if (pre.parentElement?.classList.contains('claudian-code-wrapper')) return;

        const wrapper = this.doc.createElement('div');
        wrapper.className = 'claudian-code-wrapper';
        pre.parentElement?.insertBefore(wrapper, pre);
        wrapper.appendChild(pre);

        const code = pre.querySelector('code[class*="language-"]');
        if (code) {
          const match = code.className.match(/language-(\w+)/);
          if (match) {
            wrapper.classList.add('has-language');
            const headerBar = this.doc.createElement('div');
            headerBar.className = 'archivist-code-header';
            wrapper.insertBefore(headerBar, pre);

            const langSpan = this.doc.createElement('span');
            langSpan.textContent = match[1];
            headerBar.appendChild(langSpan);

            const copyBtn = this.doc.createElement('span');
            copyBtn.className = 'archivist-code-copy';
            copyBtn.textContent = 'Copy';
            headerBar.appendChild(copyBtn);

            copyBtn.addEventListener('click', async () => {
              try {
                await navigator.clipboard.writeText(code.textContent || '');
                copyBtn.textContent = 'Copied!';
                setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
              } catch { /* clipboard may fail */ }
            });
          }
        }
      });

      // Replace D&D code fences with rendered stat blocks
      replaceDndCodeFences(this.doc, el, this.dndCopyAndSaveCallback);
    } catch {
      const errorEl = this.doc.createElement('div');
      errorEl.className = 'claudian-render-error';
      errorEl.textContent = 'Failed to render message content.';
      el.appendChild(errorEl);
    }
  }

  // ============================================
  // Copy Buttons
  // ============================================

  addTextCopyButton(textEl: HTMLElement, markdown: string): void {
    const copyBtn = this.doc.createElement('span');
    copyBtn.className = 'claudian-text-copy-btn';
    setTrustedSvg(copyBtn, MessageRenderer.COPY_ICON);
    textEl.appendChild(copyBtn);

    let feedbackTimeout: ReturnType<typeof setTimeout> | null = null;

    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(markdown);
      } catch {
        return;
      }
      if (feedbackTimeout) clearTimeout(feedbackTimeout);
      clearEl(copyBtn);
      copyBtn.textContent = 'copied!';
      copyBtn.classList.add('copied');
      feedbackTimeout = setTimeout(() => {
        setTrustedSvg(copyBtn, MessageRenderer.COPY_ICON);
        copyBtn.classList.remove('copied');
        feedbackTimeout = null;
      }, 1500);
    });
  }

  private addUserCopyButton(msgEl: HTMLElement, content: string): void {
    const toolbar = this.getOrCreateActionsToolbar(msgEl);

    const copyBtn = this.doc.createElement('span');
    copyBtn.className = 'claudian-user-msg-copy-btn';
    setTrustedSvg(copyBtn, MessageRenderer.COPY_ICON);
    copyBtn.setAttribute('aria-label', 'Copy message');
    toolbar.appendChild(copyBtn);

    let feedbackTimeout: ReturnType<typeof setTimeout> | null = null;

    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(content);
      } catch {
        return;
      }
      if (feedbackTimeout) clearTimeout(feedbackTimeout);
      clearEl(copyBtn);
      copyBtn.textContent = 'copied!';
      copyBtn.classList.add('copied');
      feedbackTimeout = setTimeout(() => {
        setTrustedSvg(copyBtn, MessageRenderer.COPY_ICON);
        copyBtn.classList.remove('copied');
        feedbackTimeout = null;
      }, 1500);
    });
  }

  private getOrCreateActionsToolbar(msgEl: HTMLElement): HTMLElement {
    const existing = msgEl.querySelector('.claudian-user-msg-actions') as HTMLElement | null;
    if (existing) return existing;
    const toolbar = this.doc.createElement('div');
    toolbar.className = 'claudian-user-msg-actions';
    msgEl.appendChild(toolbar);
    return toolbar;
  }

  // ============================================
  // Rewind / Fork
  // ============================================

  /**
   * Checks if a user message is eligible for rewind/fork buttons.
   * Requires a preceding assistant message with an SDK UUID and a
   * following assistant response with an SDK UUID.
   */
  private isRewindEligible(allMessages?: ChatMessage[], index?: number): boolean {
    if (!allMessages || index === undefined) return false;

    // Find previous assistant UUID
    let prevAssistantUuid: string | undefined;
    for (let i = index - 1; i >= 0; i--) {
      if (allMessages[i].role === 'assistant' && allMessages[i].sdkAssistantUuid) {
        prevAssistantUuid = allMessages[i].sdkAssistantUuid;
        break;
      }
    }

    // Find following assistant response with UUID
    let hasResponse = false;
    for (let i = index + 1; i < allMessages.length; i++) {
      if (allMessages[i].role === 'user') break;
      if (allMessages[i].role === 'assistant' && allMessages[i].sdkAssistantUuid) {
        hasResponse = true;
        break;
      }
    }

    return !!prevAssistantUuid && hasResponse;
  }

  private addRewindButton(msgEl: HTMLElement, messageId: string): void {
    const toolbar = this.getOrCreateActionsToolbar(msgEl);

    const btn = this.doc.createElement('span');
    btn.className = 'claudian-message-rewind-btn';
    setTrustedSvg(btn, MessageRenderer.REWIND_ICON);
    btn.setAttribute('aria-label', 'Rewind to this message');

    // Insert at beginning of toolbar (before copy button)
    if (toolbar.firstChild) {
      toolbar.insertBefore(btn, toolbar.firstChild);
    } else {
      toolbar.appendChild(btn);
    }

    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await this.rewindCallback?.(messageId);
      } catch (err) {
        console.error('Rewind failed:', err);
      }
    });
  }

  private addForkButton(msgEl: HTMLElement, messageId: string): void {
    const toolbar = this.getOrCreateActionsToolbar(msgEl);

    const btn = this.doc.createElement('span');
    btn.className = 'claudian-message-fork-btn';
    setTrustedSvg(btn, MessageRenderer.FORK_ICON);
    btn.setAttribute('aria-label', 'Fork from this message');

    // Insert at beginning of toolbar (before rewind/copy buttons)
    if (toolbar.firstChild) {
      toolbar.insertBefore(btn, toolbar.firstChild);
    } else {
      toolbar.appendChild(btn);
    }

    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await this.forkCallback?.(messageId);
      } catch (err) {
        console.error('Fork failed:', err);
      }
    });
  }

  /**
   * Called after streaming completes to attach rewind/fork buttons
   * to user messages that were added during streaming (before the
   * assistant response was available to determine eligibility).
   */
  refreshActionButtons(msg: ChatMessage, allMessages?: ChatMessage[], index?: number): void {
    if (!msg.sdkUserUuid) return;
    if (!this.isRewindEligible(allMessages, index)) return;
    const msgEl = this.liveMessageEls.get(msg.id);
    if (!msgEl) return;

    if (this.rewindCallback && !msgEl.querySelector('.claudian-message-rewind-btn')) {
      this.addRewindButton(msgEl, msg.id);
    }
    if (this.forkCallback && !msgEl.querySelector('.claudian-message-fork-btn')) {
      this.addForkButton(msgEl, msg.id);
    }

    // Clean up tracking if all buttons are attached
    const needsRewind = this.rewindCallback && !msgEl.querySelector('.claudian-message-rewind-btn');
    const needsFork = this.forkCallback && !msgEl.querySelector('.claudian-message-fork-btn');
    if (!needsRewind && !needsFork) {
      this.liveMessageEls.delete(msg.id);
    }
  }

  // ============================================
  // Utilities
  // ============================================

  scrollToBottom(): void {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  scrollToBottomIfNeeded(threshold = 100): void {
    const { scrollTop, scrollHeight, clientHeight } = this.messagesEl;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < threshold;
    if (isNearBottom) {
      requestAnimationFrame(() => {
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
      });
    }
  }
}
