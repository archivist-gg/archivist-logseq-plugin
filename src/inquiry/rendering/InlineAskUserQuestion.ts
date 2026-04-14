import type { SidecarClient } from '../SidecarClient';

export interface AskUserQuestionOption {
  label: string;
  description: string;
}

export interface AskUserQuestionItem {
  question: string;
  header: string;
  options: AskUserQuestionOption[];
  multiSelect: boolean;
}

export interface InlineAskQuestionConfig {
  title?: string;
  headerEl?: HTMLElement;
  showCustomInput?: boolean;
  immediateSelect?: boolean;
}

const HINTS_TEXT = 'Enter to select \u00B7 Tab/Arrow keys to navigate \u00B7 Esc to cancel';
const HINTS_TEXT_IMMEDIATE = 'Enter to select \u00B7 Arrow keys to navigate \u00B7 Esc to cancel';

export class InlineAskUserQuestion {
  private doc: Document;
  private containerEl: HTMLElement;
  private toolCallId: string;
  private input: Record<string, unknown>;
  private client: SidecarClient;
  private resolved = false;
  private signal?: AbortSignal;
  private config: Required<Omit<InlineAskQuestionConfig, 'headerEl'>> & { headerEl?: HTMLElement };

  private questions: AskUserQuestionItem[] = [];
  private answers = new Map<number, Set<string>>();
  private customInputs = new Map<number, string>();

  private activeTabIndex = 0;
  private focusedItemIndex = 0;
  private isInputFocused = false;

  private rootEl!: HTMLElement;
  private tabBar!: HTMLElement;
  private contentArea!: HTMLElement;
  private tabElements: HTMLElement[] = [];
  private currentItems: HTMLElement[] = [];
  private boundKeyDown: (e: KeyboardEvent) => void;
  private abortHandler: (() => void) | null = null;

  constructor(
    doc: Document,
    containerEl: HTMLElement,
    toolCallId: string,
    input: Record<string, unknown>,
    client: SidecarClient,
    signal?: AbortSignal,
    config?: InlineAskQuestionConfig,
  ) {
    this.doc = doc;
    this.containerEl = containerEl;
    this.toolCallId = toolCallId;
    this.input = input;
    this.client = client;
    this.signal = signal;
    this.config = {
      title: config?.title ?? 'Claude has a question',
      headerEl: config?.headerEl,
      showCustomInput: config?.showCustomInput ?? true,
      immediateSelect: config?.immediateSelect ?? false,
    };
    this.boundKeyDown = this.handleKeyDown.bind(this);
  }

  render(): void {
    this.rootEl = this.doc.createElement('div');
    this.rootEl.className = 'claudian-ask-question-inline';
    this.containerEl.appendChild(this.rootEl);

    const titleEl = this.doc.createElement('div');
    titleEl.className = 'claudian-ask-inline-title';
    titleEl.textContent = this.config.title;
    this.rootEl.appendChild(titleEl);

    if (this.config.headerEl) {
      this.rootEl.appendChild(this.config.headerEl);
    }

    this.questions = this.parseQuestions();

    if (this.questions.length === 0) {
      this.handleResolve(null);
      return;
    }

    if (this.config.immediateSelect && this.questions.length !== 1) {
      this.config.immediateSelect = false;
    }

    for (let i = 0; i < this.questions.length; i++) {
      this.answers.set(i, new Set());
      this.customInputs.set(i, '');
    }

    if (!this.config.immediateSelect) {
      this.tabBar = this.doc.createElement('div');
      this.tabBar.className = 'claudian-ask-tab-bar';
      this.rootEl.appendChild(this.tabBar);
      this.renderTabBar();
    }

    this.contentArea = this.doc.createElement('div');
    this.contentArea.className = 'claudian-ask-content';
    this.rootEl.appendChild(this.contentArea);
    this.renderTabContent();

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

  private parseQuestions(): AskUserQuestionItem[] {
    const raw = this.input.questions;
    if (!Array.isArray(raw)) return [];

    return raw
      .filter(
        (q): q is { question: string; header?: string; options: unknown[]; multiSelect?: boolean } =>
          typeof q === 'object' &&
          q !== null &&
          typeof q.question === 'string' &&
          Array.isArray(q.options) &&
          q.options.length > 0,
      )
      .map((q, idx) => ({
        question: q.question,
        header: typeof q.header === 'string' ? q.header.slice(0, 12) : `Q${idx + 1}`,
        options: this.deduplicateOptions(q.options.map((o: unknown) => this.coerceOption(o))),
        multiSelect: q.multiSelect === true,
      }));
  }

  private coerceOption(opt: unknown): AskUserQuestionOption {
    if (typeof opt === 'object' && opt !== null) {
      const obj = opt as Record<string, unknown>;
      const label = this.extractLabel(obj);
      const description = typeof obj.description === 'string' ? obj.description : '';
      return { label, description };
    }
    return { label: typeof opt === 'string' ? opt : String(opt), description: '' };
  }

  private deduplicateOptions(options: AskUserQuestionOption[]): AskUserQuestionOption[] {
    const seen = new Set<string>();
    return options.filter((o) => {
      if (seen.has(o.label)) return false;
      seen.add(o.label);
      return true;
    });
  }

  private extractLabel(obj: Record<string, unknown>): string {
    if (typeof obj.label === 'string') return obj.label;
    if (typeof obj.value === 'string') return obj.value;
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.name === 'string') return obj.name;
    return String(obj);
  }

  private renderTabBar(): void {
    while (this.tabBar.firstChild) this.tabBar.removeChild(this.tabBar.firstChild);
    this.tabElements = [];

    for (let idx = 0; idx < this.questions.length; idx++) {
      const answered = this.isQuestionAnswered(idx);
      const tab = this.doc.createElement('span');
      tab.className = 'claudian-ask-tab';
      this.tabBar.appendChild(tab);

      const labelSpan = this.doc.createElement('span');
      labelSpan.className = 'claudian-ask-tab-label';
      labelSpan.textContent = this.questions[idx].header;
      tab.appendChild(labelSpan);

      const tickSpan = this.doc.createElement('span');
      tickSpan.className = 'claudian-ask-tab-tick';
      tickSpan.textContent = answered ? ' \u2713' : '';
      tab.appendChild(tickSpan);

      tab.setAttribute('title', this.questions[idx].question);
      if (idx === this.activeTabIndex) tab.classList.add('is-active');
      if (answered) tab.classList.add('is-answered');
      tab.addEventListener('click', () => this.switchTab(idx));
      this.tabElements.push(tab);
    }

    const allAnswered = this.questions.every((_, i) => this.isQuestionAnswered(i));
    const submitTab = this.doc.createElement('span');
    submitTab.className = 'claudian-ask-tab';
    this.tabBar.appendChild(submitTab);

    const submitCheck = this.doc.createElement('span');
    submitCheck.className = 'claudian-ask-tab-submit-check';
    submitCheck.textContent = allAnswered ? '\u2713 ' : '';
    submitTab.appendChild(submitCheck);

    const submitLabel = this.doc.createElement('span');
    submitLabel.className = 'claudian-ask-tab-label';
    submitLabel.textContent = 'Submit';
    submitTab.appendChild(submitLabel);

    if (this.activeTabIndex === this.questions.length) submitTab.classList.add('is-active');
    submitTab.addEventListener('click', () => this.switchTab(this.questions.length));
    this.tabElements.push(submitTab);
  }

  private isQuestionAnswered(idx: number): boolean {
    return this.answers.get(idx)!.size > 0 || this.customInputs.get(idx)!.trim().length > 0;
  }

  private switchTab(index: number): void {
    const clamped = Math.max(0, Math.min(index, this.questions.length));
    if (clamped === this.activeTabIndex) return;
    this.activeTabIndex = clamped;
    this.focusedItemIndex = 0;
    this.isInputFocused = false;
    if (!this.config.immediateSelect) this.renderTabBar();
    this.renderTabContent();
    this.rootEl.focus();
  }

  private renderTabContent(): void {
    while (this.contentArea.firstChild) this.contentArea.removeChild(this.contentArea.firstChild);
    this.currentItems = [];

    if (this.activeTabIndex < this.questions.length) {
      this.renderQuestionTab(this.activeTabIndex);
    } else {
      this.renderSubmitTab();
    }
  }

  private renderQuestionTab(idx: number): void {
    const q = this.questions[idx];
    const isMulti = q.multiSelect;
    const selected = this.answers.get(idx)!;

    const questionText = this.doc.createElement('div');
    questionText.className = 'claudian-ask-question-text';
    questionText.textContent = q.question;
    this.contentArea.appendChild(questionText);

    const listEl = this.doc.createElement('div');
    listEl.className = 'claudian-ask-list';
    this.contentArea.appendChild(listEl);

    for (let optIdx = 0; optIdx < q.options.length; optIdx++) {
      const option = q.options[optIdx];
      const isFocused = optIdx === this.focusedItemIndex;
      const isSelected = selected.has(option.label);

      const row = this.doc.createElement('div');
      row.className = 'claudian-ask-item';
      if (isFocused) row.classList.add('is-focused');
      if (isSelected) row.classList.add('is-selected');
      listEl.appendChild(row);

      this.createSpan(row, isFocused ? '\u203A' : '\u00A0', 'claudian-ask-cursor');
      this.createSpan(row, `${optIdx + 1}. `, 'claudian-ask-item-num');

      if (isMulti) this.renderMultiSelectCheckbox(row, isSelected);

      const labelBlock = this.doc.createElement('div');
      labelBlock.className = 'claudian-ask-item-content';
      row.appendChild(labelBlock);

      const labelRow = this.doc.createElement('div');
      labelRow.className = 'claudian-ask-label-row';
      labelBlock.appendChild(labelRow);

      this.createSpan(labelRow, option.label, 'claudian-ask-item-label');

      if (!isMulti && isSelected) {
        this.createSpan(labelRow, ' \u2713', 'claudian-ask-check-mark');
      }

      if (option.description) {
        const descEl = this.doc.createElement('div');
        descEl.className = 'claudian-ask-item-desc';
        descEl.textContent = option.description;
        labelBlock.appendChild(descEl);
      }

      row.addEventListener('click', () => {
        this.focusedItemIndex = optIdx;
        this.updateFocusIndicator();
        this.selectOption(idx, option.label);
      });

      this.currentItems.push(row);
    }

    if (this.config.showCustomInput) {
      const customIdx = q.options.length;
      const customFocused = customIdx === this.focusedItemIndex;
      const customText = this.customInputs.get(idx) ?? '';

      const customRow = this.doc.createElement('div');
      customRow.className = 'claudian-ask-item claudian-ask-custom-item';
      if (customFocused) customRow.classList.add('is-focused');
      listEl.appendChild(customRow);

      this.createSpan(customRow, customFocused ? '\u203A' : '\u00A0', 'claudian-ask-cursor');
      this.createSpan(customRow, `${customIdx + 1}. `, 'claudian-ask-item-num');

      if (isMulti) this.renderMultiSelectCheckbox(customRow, customText.trim().length > 0);

      const inputEl = this.doc.createElement('input');
      inputEl.type = 'text';
      inputEl.className = 'claudian-ask-custom-text';
      inputEl.placeholder = 'Type something.';
      inputEl.value = customText;
      customRow.appendChild(inputEl);

      inputEl.addEventListener('input', () => {
        this.customInputs.set(idx, inputEl.value);
        if (!isMulti && inputEl.value.trim()) {
          selected.clear();
          this.updateOptionVisuals(idx);
        }
        this.updateTabIndicators();
      });
      inputEl.addEventListener('focus', () => { this.isInputFocused = true; });
      inputEl.addEventListener('blur', () => { this.isInputFocused = false; });

      this.currentItems.push(customRow);
    }

    const hintsEl = this.doc.createElement('div');
    hintsEl.className = 'claudian-ask-hints';
    hintsEl.textContent = this.config.immediateSelect ? HINTS_TEXT_IMMEDIATE : HINTS_TEXT;
    this.contentArea.appendChild(hintsEl);
  }

  private renderSubmitTab(): void {
    const reviewTitle = this.doc.createElement('div');
    reviewTitle.className = 'claudian-ask-review-title';
    reviewTitle.textContent = 'Review your answers';
    this.contentArea.appendChild(reviewTitle);

    const reviewEl = this.doc.createElement('div');
    reviewEl.className = 'claudian-ask-review';
    this.contentArea.appendChild(reviewEl);

    for (let idx = 0; idx < this.questions.length; idx++) {
      const q = this.questions[idx];
      const answerText = this.getAnswerText(idx);

      const pairEl = this.doc.createElement('div');
      pairEl.className = 'claudian-ask-review-pair';
      reviewEl.appendChild(pairEl);

      const numEl = this.doc.createElement('div');
      numEl.className = 'claudian-ask-review-num';
      numEl.textContent = `${idx + 1}.`;
      pairEl.appendChild(numEl);

      const bodyEl = this.doc.createElement('div');
      bodyEl.className = 'claudian-ask-review-body';
      pairEl.appendChild(bodyEl);

      const qText = this.doc.createElement('div');
      qText.className = 'claudian-ask-review-q-text';
      qText.textContent = q.question;
      bodyEl.appendChild(qText);

      const aText = this.doc.createElement('div');
      aText.className = answerText ? 'claudian-ask-review-a-text' : 'claudian-ask-review-empty';
      aText.textContent = answerText || 'Not answered';
      bodyEl.appendChild(aText);

      pairEl.addEventListener('click', () => this.switchTab(idx));
    }

    const promptEl = this.doc.createElement('div');
    promptEl.className = 'claudian-ask-review-prompt';
    promptEl.textContent = 'Ready to submit your answers?';
    this.contentArea.appendChild(promptEl);

    const actionsEl = this.doc.createElement('div');
    actionsEl.className = 'claudian-ask-list';
    this.contentArea.appendChild(actionsEl);

    const allAnswered = this.questions.every((_, i) => this.isQuestionAnswered(i));

    const submitRow = this.doc.createElement('div');
    submitRow.className = 'claudian-ask-item';
    if (this.focusedItemIndex === 0) submitRow.classList.add('is-focused');
    if (!allAnswered) submitRow.classList.add('is-disabled');
    actionsEl.appendChild(submitRow);

    this.createSpan(submitRow, this.focusedItemIndex === 0 ? '\u203A' : '\u00A0', 'claudian-ask-cursor');
    this.createSpan(submitRow, '1. ', 'claudian-ask-item-num');
    this.createSpan(submitRow, 'Submit answers', 'claudian-ask-item-label');

    submitRow.addEventListener('click', () => {
      this.focusedItemIndex = 0;
      this.updateFocusIndicator();
      this.handleSubmit();
    });
    this.currentItems.push(submitRow);

    const cancelRow = this.doc.createElement('div');
    cancelRow.className = 'claudian-ask-item';
    if (this.focusedItemIndex === 1) cancelRow.classList.add('is-focused');
    actionsEl.appendChild(cancelRow);

    this.createSpan(cancelRow, this.focusedItemIndex === 1 ? '\u203A' : '\u00A0', 'claudian-ask-cursor');
    this.createSpan(cancelRow, '2. ', 'claudian-ask-item-num');
    this.createSpan(cancelRow, 'Cancel', 'claudian-ask-item-label');

    cancelRow.addEventListener('click', () => {
      this.focusedItemIndex = 1;
      this.handleResolve(null);
    });
    this.currentItems.push(cancelRow);

    const hintsEl = this.doc.createElement('div');
    hintsEl.className = 'claudian-ask-hints';
    hintsEl.textContent = HINTS_TEXT;
    this.contentArea.appendChild(hintsEl);
  }

  private getAnswerText(idx: number): string {
    const selected = this.answers.get(idx)!;
    const custom = this.customInputs.get(idx)!;
    const parts: string[] = [];
    if (selected.size > 0) parts.push([...selected].join(', '));
    if (custom.trim()) parts.push(custom.trim());
    return parts.join(', ');
  }

  private selectOption(qIdx: number, label: string): void {
    const q = this.questions[qIdx];
    const selected = this.answers.get(qIdx)!;
    const isMulti = q.multiSelect;

    if (isMulti) {
      if (selected.has(label)) selected.delete(label);
      else selected.add(label);
    } else {
      selected.clear();
      selected.add(label);
      this.customInputs.set(qIdx, '');
    }

    this.updateOptionVisuals(qIdx);

    if (this.config.immediateSelect) {
      const result: Record<string, string> = {};
      result[q.question] = label;
      this.handleResolve(result);
      return;
    }

    this.updateTabIndicators();

    if (!isMulti) {
      this.switchTab(this.activeTabIndex + 1);
    }
  }

  private renderMultiSelectCheckbox(parent: HTMLElement, checked: boolean): void {
    const span = this.doc.createElement('span');
    span.className = `claudian-ask-check${checked ? ' is-checked' : ''}`;
    span.textContent = checked ? '[\u2713] ' : '[ ] ';
    parent.appendChild(span);
  }

  private updateOptionVisuals(qIdx: number): void {
    const q = this.questions[qIdx];
    const selected = this.answers.get(qIdx)!;
    const isMulti = q.multiSelect;

    for (let i = 0; i < q.options.length; i++) {
      const item = this.currentItems[i];
      const isSelected = selected.has(q.options[i].label);

      if (isSelected) item.classList.add('is-selected');
      else item.classList.remove('is-selected');

      if (isMulti) {
        const checkSpan = item.querySelector('.claudian-ask-check') as HTMLElement | null;
        if (checkSpan) {
          checkSpan.textContent = isSelected ? '[\u2713] ' : '[ ] ';
          if (isSelected) checkSpan.classList.add('is-checked');
          else checkSpan.classList.remove('is-checked');
        }
      } else {
        const labelRow = item.querySelector('.claudian-ask-label-row') as HTMLElement | null;
        const existingMark = item.querySelector('.claudian-ask-check-mark');
        if (isSelected && !existingMark && labelRow) {
          this.createSpan(labelRow, ' \u2713', 'claudian-ask-check-mark');
        } else if (!isSelected && existingMark) {
          existingMark.remove();
        }
      }
    }
  }

  private updateFocusIndicator(): void {
    for (let i = 0; i < this.currentItems.length; i++) {
      const item = this.currentItems[i];
      const cursor = item.querySelector('.claudian-ask-cursor');
      if (i === this.focusedItemIndex) {
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

  private updateTabIndicators(): void {
    for (let idx = 0; idx < this.questions.length; idx++) {
      const tab = this.tabElements[idx];
      const tick = tab.querySelector('.claudian-ask-tab-tick');
      const answered = this.isQuestionAnswered(idx);
      if (answered) tab.classList.add('is-answered');
      else tab.classList.remove('is-answered');
      if (tick) tick.textContent = answered ? ' \u2713' : '';
    }
    const submitTab = this.tabElements[this.questions.length];
    if (submitTab) {
      const submitCheck = submitTab.querySelector('.claudian-ask-tab-submit-check');
      const allAnswered = this.questions.every((_, i) => this.isQuestionAnswered(i));
      if (submitCheck) submitCheck.textContent = allAnswered ? '\u2713 ' : '';
    }
  }

  private handleNavigationKey(e: KeyboardEvent, maxFocusIndex: number): boolean {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        this.focusedItemIndex = Math.min(this.focusedItemIndex + 1, maxFocusIndex);
        this.updateFocusIndicator();
        return true;
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        this.focusedItemIndex = Math.max(this.focusedItemIndex - 1, 0);
        this.updateFocusIndicator();
        return true;
      case 'ArrowLeft':
        if (this.config.immediateSelect) return false;
        e.preventDefault();
        e.stopPropagation();
        this.switchTab(this.activeTabIndex - 1);
        return true;
      case 'Tab':
        if (this.config.immediateSelect) return false;
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) this.switchTab(this.activeTabIndex - 1);
        else this.switchTab(this.activeTabIndex + 1);
        return true;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        this.handleResolve(null);
        return true;
      default:
        return false;
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (this.isInputFocused) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.isInputFocused = false;
        (this.doc.activeElement as HTMLElement)?.blur();
        this.rootEl.focus();
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        this.isInputFocused = false;
        (this.doc.activeElement as HTMLElement)?.blur();
        if (e.key === 'Tab' && e.shiftKey) this.switchTab(this.activeTabIndex - 1);
        else this.switchTab(this.activeTabIndex + 1);
        return;
      }
      return;
    }

    if (this.config.immediateSelect) {
      const q = this.questions[this.activeTabIndex];
      const maxIdx = q.options.length - 1;
      if (this.handleNavigationKey(e, maxIdx)) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        if (this.focusedItemIndex <= maxIdx) {
          this.selectOption(this.activeTabIndex, q.options[this.focusedItemIndex].label);
        }
      }
      return;
    }

    const isSubmitTab = this.activeTabIndex === this.questions.length;
    const q = this.questions[this.activeTabIndex];
    const maxFocusIndex = isSubmitTab
      ? 1
      : (this.config.showCustomInput ? q.options.length : q.options.length - 1);

    if (this.handleNavigationKey(e, maxFocusIndex)) return;

    if (isSubmitTab) {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        if (this.focusedItemIndex === 0) this.handleSubmit();
        else this.handleResolve(null);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        e.stopPropagation();
        this.switchTab(this.activeTabIndex + 1);
        break;
      case 'Enter':
        e.preventDefault();
        e.stopPropagation();
        if (this.focusedItemIndex < q.options.length) {
          this.selectOption(this.activeTabIndex, q.options[this.focusedItemIndex].label);
        } else if (this.config.showCustomInput) {
          this.isInputFocused = true;
          const input = this.contentArea.querySelector('.claudian-ask-custom-text') as HTMLInputElement;
          input?.focus();
        }
        break;
    }
  }

  private handleSubmit(): void {
    const allAnswered = this.questions.every((_, i) => this.isQuestionAnswered(i));
    if (!allAnswered) return;

    const result: Record<string, string> = {};
    for (let i = 0; i < this.questions.length; i++) {
      result[this.questions[i].question] = this.getAnswerText(i);
    }
    this.handleResolve(result);
  }

  private handleResolve(result: Record<string, string> | null): void {
    if (!this.resolved) {
      this.resolved = true;
      this.rootEl?.removeEventListener('keydown', this.boundKeyDown);
      if (this.signal && this.abortHandler) {
        this.signal.removeEventListener('abort', this.abortHandler);
        this.abortHandler = null;
      }
      this.rootEl?.remove();

      // Send result via SidecarClient WebSocket
      if (result) {
        this.client.sendAskUserAnswer(this.toolCallId, result);
      } else {
        this.client.sendAskUserDismiss(this.toolCallId);
      }
    }
  }

  private createSpan(parent: HTMLElement, text: string, className: string): HTMLElement {
    const span = this.doc.createElement('span');
    span.className = className;
    span.textContent = text;
    parent.appendChild(span);
    return span;
  }
}
