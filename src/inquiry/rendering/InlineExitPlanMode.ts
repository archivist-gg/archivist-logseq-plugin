import type { SidecarClient } from '../SidecarClient';
import type { RenderContentFn } from './ThinkingBlockRenderer';

export interface ExitPlanModeDecision {
  type: 'approve' | 'approve-new-session' | 'feedback';
  planContent?: string;
  text?: string;
}

const HINTS_TEXT = 'Arrow keys to navigate \u00B7 Enter to select \u00B7 Esc to cancel';

export class InlineExitPlanMode {
  private containerEl: HTMLElement;
  private doc: Document;
  private toolCallId: string;
  private input: Record<string, unknown>;
  private client: SidecarClient;
  private resolved = false;
  private signal?: AbortSignal;
  private renderContent?: RenderContentFn;
  private planContent: string | null = null;

  private rootEl!: HTMLElement;
  private focusedIndex = 0;
  private items: HTMLElement[] = [];
  private feedbackInput!: HTMLInputElement;
  private isInputFocused = false;
  private boundKeyDown: (e: KeyboardEvent) => void;
  private abortHandler: (() => void) | null = null;

  constructor(
    doc: Document,
    containerEl: HTMLElement,
    toolCallId: string,
    input: Record<string, unknown>,
    client: SidecarClient,
    signal?: AbortSignal,
    renderContent?: RenderContentFn,
  ) {
    this.doc = doc;
    this.containerEl = containerEl;
    this.toolCallId = toolCallId;
    this.input = input;
    this.client = client;
    this.signal = signal;
    this.renderContent = renderContent;
    this.boundKeyDown = this.handleKeyDown.bind(this);
  }

  render(): void {
    this.rootEl = this.doc.createElement('div');
    this.rootEl.className = 'claudian-plan-approval-inline';
    this.containerEl.appendChild(this.rootEl);

    const titleEl = this.doc.createElement('div');
    titleEl.className = 'claudian-plan-inline-title';
    titleEl.textContent = 'Plan complete';
    this.rootEl.appendChild(titleEl);

    this.planContent = this.readPlanContent();
    if (this.planContent) {
      const contentEl = this.doc.createElement('div');
      contentEl.className = 'claudian-plan-content-preview';
      this.rootEl.appendChild(contentEl);
      if (this.renderContent) {
        void this.renderContent(contentEl, this.planContent);
      } else {
        const textEl = this.doc.createElement('div');
        textEl.className = 'claudian-plan-content-text';
        textEl.textContent = this.planContent;
        contentEl.appendChild(textEl);
      }
    }

    const allowedPrompts = this.input.allowedPrompts as Array<{ tool: string; prompt: string }> | undefined;
    if (allowedPrompts && Array.isArray(allowedPrompts) && allowedPrompts.length > 0) {
      const permEl = this.doc.createElement('div');
      permEl.className = 'claudian-plan-permissions';
      this.rootEl.appendChild(permEl);

      const labelEl = this.doc.createElement('div');
      labelEl.className = 'claudian-plan-permissions-label';
      labelEl.textContent = 'Requested permissions:';
      permEl.appendChild(labelEl);

      const listEl = this.doc.createElement('ul');
      listEl.className = 'claudian-plan-permissions-list';
      permEl.appendChild(listEl);

      for (const perm of allowedPrompts) {
        const li = this.doc.createElement('li');
        li.textContent = perm.prompt;
        listEl.appendChild(li);
      }
    }

    const actionsEl = this.doc.createElement('div');
    actionsEl.className = 'claudian-ask-list';
    this.rootEl.appendChild(actionsEl);

    // Option 1: Approve (new session)
    const newSessionRow = this.doc.createElement('div');
    newSessionRow.className = 'claudian-ask-item is-focused';
    actionsEl.appendChild(newSessionRow);

    this.createSpan(newSessionRow, '\u203A', 'claudian-ask-cursor');
    this.createSpan(newSessionRow, '1. ', 'claudian-ask-item-num');
    this.createSpan(newSessionRow, 'Approve (new session)', 'claudian-ask-item-label');

    newSessionRow.addEventListener('click', () => {
      this.focusedIndex = 0;
      this.updateFocus();
      this.handleResolve({
        type: 'approve-new-session',
        planContent: this.extractPlanContent(),
      });
    });
    this.items.push(newSessionRow);

    // Option 2: Approve (current session)
    const approveRow = this.doc.createElement('div');
    approveRow.className = 'claudian-ask-item';
    actionsEl.appendChild(approveRow);

    this.createSpan(approveRow, '\u00A0', 'claudian-ask-cursor');
    this.createSpan(approveRow, '2. ', 'claudian-ask-item-num');
    this.createSpan(approveRow, 'Approve (current session)', 'claudian-ask-item-label');

    approveRow.addEventListener('click', () => {
      this.focusedIndex = 1;
      this.updateFocus();
      this.handleResolve({ type: 'approve' });
    });
    this.items.push(approveRow);

    // Option 3: Feedback
    const feedbackRow = this.doc.createElement('div');
    feedbackRow.className = 'claudian-ask-item claudian-ask-custom-item';
    actionsEl.appendChild(feedbackRow);

    this.createSpan(feedbackRow, '\u00A0', 'claudian-ask-cursor');
    this.createSpan(feedbackRow, '3. ', 'claudian-ask-item-num');

    this.feedbackInput = this.doc.createElement('input');
    this.feedbackInput.type = 'text';
    this.feedbackInput.className = 'claudian-ask-custom-text';
    this.feedbackInput.placeholder = 'Enter feedback to continue planning...';
    feedbackRow.appendChild(this.feedbackInput);

    this.feedbackInput.addEventListener('focus', () => { this.isInputFocused = true; });
    this.feedbackInput.addEventListener('blur', () => { this.isInputFocused = false; });
    feedbackRow.addEventListener('click', () => {
      this.focusedIndex = 2;
      this.updateFocus();
    });
    this.items.push(feedbackRow);

    // Hints
    const hintsEl = this.doc.createElement('div');
    hintsEl.className = 'claudian-ask-hints';
    hintsEl.textContent = HINTS_TEXT;
    this.rootEl.appendChild(hintsEl);

    this.rootEl.setAttribute('tabindex', '0');
    this.rootEl.addEventListener('keydown', this.boundKeyDown);

    requestAnimationFrame(() => {
      this.rootEl.focus();
      this.rootEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });

    if (this.signal) {
      this.abortHandler = () => this.handleResolve(null);
      this.signal.addEventListener('abort', this.abortHandler, { once: true });
    }
  }

  destroy(): void {
    this.handleResolve(null);
  }

  private createSpan(parent: HTMLElement, text: string, className: string): HTMLElement {
    const span = this.doc.createElement('span');
    span.className = className;
    span.textContent = text;
    parent.appendChild(span);
    return span;
  }

  private readPlanContent(): string | null {
    // In Logseq, plan content comes from the input directly
    // (the sidecar sends the plan content in the tool input)
    const planContent = this.input.planContent as string | undefined;
    return planContent?.trim() || null;
  }

  private extractPlanContent(): string {
    if (this.planContent) {
      return `Implement this plan:\n\n${this.planContent}`;
    }
    return 'Implement the approved plan.';
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (this.isInputFocused) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.isInputFocused = false;
        this.feedbackInput.blur();
        this.rootEl.focus();
        return;
      }
      if (e.key === 'Enter' && this.feedbackInput.value.trim()) {
        e.preventDefault();
        e.stopPropagation();
        this.handleResolve({ type: 'feedback', text: this.feedbackInput.value.trim() });
        return;
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        this.focusedIndex = Math.min(this.focusedIndex + 1, this.items.length - 1);
        this.updateFocus();
        break;
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        this.focusedIndex = Math.max(this.focusedIndex - 1, 0);
        this.updateFocus();
        break;
      case 'Enter':
        e.preventDefault();
        e.stopPropagation();
        if (this.focusedIndex === 0) {
          this.handleResolve({
            type: 'approve-new-session',
            planContent: this.extractPlanContent(),
          });
        } else if (this.focusedIndex === 1) {
          this.handleResolve({ type: 'approve' });
        } else if (this.focusedIndex === 2) {
          this.feedbackInput.focus();
        }
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        this.handleResolve(null);
        break;
    }
  }

  private updateFocus(): void {
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      const cursor = item.querySelector('.claudian-ask-cursor');
      if (i === this.focusedIndex) {
        item.classList.add('is-focused');
        if (cursor) cursor.textContent = '\u203A';
        item.scrollIntoView({ block: 'nearest' });

        if (item.classList.contains('claudian-ask-custom-item')) {
          const input = item.querySelector('.claudian-ask-custom-text') as HTMLInputElement;
          if (input) {
            input.focus();
            this.isInputFocused = true;
          }
        }
      } else {
        item.classList.remove('is-focused');
        if (cursor) cursor.textContent = '\u00A0';

        if (item.classList.contains('claudian-ask-custom-item')) {
          const input = item.querySelector('.claudian-ask-custom-text') as HTMLInputElement;
          if (input && this.doc.activeElement === input) {
            input.blur();
            this.isInputFocused = false;
          }
        }
      }
    }
  }

  private handleResolve(decision: ExitPlanModeDecision | null): void {
    if (!this.resolved) {
      this.resolved = true;
      this.rootEl?.removeEventListener('keydown', this.boundKeyDown);
      if (this.signal && this.abortHandler) {
        this.signal.removeEventListener('abort', this.abortHandler);
        this.abortHandler = null;
      }
      this.rootEl?.remove();

      // Send decision via SidecarClient WebSocket
      if (decision) {
        switch (decision.type) {
          case 'approve':
            this.client.sendPlanApprove(this.toolCallId);
            break;
          case 'approve-new-session':
            this.client.sendPlanApproveNewSession(
              this.toolCallId,
              decision.planContent || 'Implement the approved plan.'
            );
            break;
          case 'feedback':
            this.client.sendPlanFeedback(this.toolCallId, decision.text || '');
            break;
        }
      } else {
        // Dismissed / cancelled - send deny
        this.client.sendDeny(this.toolCallId);
      }
    }
  }
}
