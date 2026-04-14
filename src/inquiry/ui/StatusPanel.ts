/**
 * StatusPanel -- Persistent bottom panel for todos and command output.
 *
 * Ported from Obsidian. Changes:
 * - `setIcon` from `../shared/icons` instead of `obsidian`
 * - `Notice` removed (no Obsidian API)
 * - `t()` i18n from local i18n module
 * - `renderTodoItems` from local rendering (takes doc arg)
 * - `empty()` -> manual while(firstChild) removeChild
 * - `addClass`/`removeClass` -> `classList.*`
 * - `setText` -> `.textContent =`
 * - `getToolIcon` / `TOOL_TODO_WRITE` inlined (no core/tools dep)
 */

import { setIcon } from '../shared/icons';
import { t } from '../i18n';
import { renderTodoItems } from '../rendering/TodoListRenderer';
import type { TodoItem } from '../state/types';

export interface PanelBashOutput {
  id: string;
  command: string;
  status: 'running' | 'completed' | 'error';
  output: string;
  exitCode?: number;
}

const MAX_BASH_OUTPUTS = 50;

/** Icon for TodoWrite tool. */
const TODO_TOOL_ICON = 'list';

export class StatusPanel {
  private doc: Document;
  private containerEl: HTMLElement | null = null;
  private panelEl: HTMLElement | null = null;

  // Bash output section
  private bashOutputContainerEl: HTMLElement | null = null;
  private bashHeaderEl: HTMLElement | null = null;
  private bashContentEl: HTMLElement | null = null;
  private isBashExpanded = true;
  private currentBashOutputs: Map<string, PanelBashOutput> = new Map();
  private bashEntryExpanded: Map<string, boolean> = new Map();

  // Todo section
  private todoContainerEl: HTMLElement | null = null;
  private todoHeaderEl: HTMLElement | null = null;
  private todoContentEl: HTMLElement | null = null;
  private isTodoExpanded = false;
  private currentTodos: TodoItem[] | null = null;

  // Event handler references for cleanup
  private todoClickHandler: (() => void) | null = null;
  private todoKeydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private bashClickHandler: (() => void) | null = null;
  private bashKeydownHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(doc: Document) {
    this.doc = doc;
  }

  /**
   * Mount the panel into the messages container.
   */
  mount(containerEl: HTMLElement): void {
    this.containerEl = containerEl;
    this.createPanel();
  }

  /**
   * Remount the panel to restore state after conversation changes.
   */
  remount(): void {
    if (!this.containerEl) return;

    this.removeEventListeners();

    if (this.panelEl) {
      this.panelEl.remove();
    }

    this.panelEl = null;
    this.bashOutputContainerEl = null;
    this.bashHeaderEl = null;
    this.bashContentEl = null;
    this.todoContainerEl = null;
    this.todoHeaderEl = null;
    this.todoContentEl = null;
    this.createPanel();

    this.renderBashOutputs();
    if (this.currentTodos && this.currentTodos.length > 0) {
      this.updateTodos(this.currentTodos);
    }
  }

  private createPanel(): void {
    if (!this.containerEl) return;
    const doc = this.doc;

    this.panelEl = doc.createElement('div');
    this.panelEl.className = 'claudian-status-panel';

    // Bash output container - hidden by default
    this.bashOutputContainerEl = doc.createElement('div');
    this.bashOutputContainerEl.className = 'claudian-status-panel-bash';
    this.bashOutputContainerEl.style.display = 'none';

    this.bashHeaderEl = doc.createElement('div');
    this.bashHeaderEl.className = 'claudian-tool-header claudian-status-panel-bash-header';
    this.bashHeaderEl.setAttribute('tabindex', '0');
    this.bashHeaderEl.setAttribute('role', 'button');

    this.bashClickHandler = () => this.toggleBashSection();
    this.bashKeydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.toggleBashSection();
      }
    };
    this.bashHeaderEl.addEventListener('click', this.bashClickHandler);
    this.bashHeaderEl.addEventListener('keydown', this.bashKeydownHandler);

    this.bashContentEl = doc.createElement('div');
    this.bashContentEl.className = 'claudian-status-panel-bash-content';

    this.bashOutputContainerEl.appendChild(this.bashHeaderEl);
    this.bashOutputContainerEl.appendChild(this.bashContentEl);
    this.panelEl.appendChild(this.bashOutputContainerEl);

    // Todo container
    this.todoContainerEl = doc.createElement('div');
    this.todoContainerEl.className = 'claudian-status-panel-todos';
    this.todoContainerEl.style.display = 'none';
    this.panelEl.appendChild(this.todoContainerEl);

    // Todo header (collapsed view)
    this.todoHeaderEl = doc.createElement('div');
    this.todoHeaderEl.className = 'claudian-status-panel-header';
    this.todoHeaderEl.setAttribute('tabindex', '0');
    this.todoHeaderEl.setAttribute('role', 'button');

    this.todoClickHandler = () => this.toggleTodos();
    this.todoKeydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.toggleTodos();
      }
    };
    this.todoHeaderEl.addEventListener('click', this.todoClickHandler);
    this.todoHeaderEl.addEventListener('keydown', this.todoKeydownHandler);
    this.todoContainerEl.appendChild(this.todoHeaderEl);

    // Todo content (expanded list)
    this.todoContentEl = doc.createElement('div');
    this.todoContentEl.className = 'claudian-status-panel-content claudian-todo-list-container';
    this.todoContentEl.style.display = 'none';
    this.todoContainerEl.appendChild(this.todoContentEl);

    this.containerEl.appendChild(this.panelEl);
  }

  /**
   * Update the panel with new todo items.
   */
  updateTodos(todos: TodoItem[] | null): void {
    if (!this.todoContainerEl || !this.todoHeaderEl || !this.todoContentEl) return;

    this.currentTodos = todos;

    if (!todos || todos.length === 0) {
      this.todoContainerEl.style.display = 'none';
      this.empty(this.todoHeaderEl);
      this.empty(this.todoContentEl);
      return;
    }

    this.todoContainerEl.style.display = 'block';

    const completedCount = todos.filter(t => t.status === 'completed').length;
    const totalCount = todos.length;
    const currentTask = todos.find(t => t.status === 'in_progress');

    this.renderTodoHeader(completedCount, totalCount, currentTask);
    this.renderTodoContent(todos);
    this.updateTodoAriaLabel(completedCount, totalCount);
    this.scrollToBottom();
  }

  private renderTodoHeader(completedCount: number, totalCount: number, currentTask: TodoItem | undefined): void {
    if (!this.todoHeaderEl) return;
    const doc = this.doc;

    this.empty(this.todoHeaderEl);

    const icon = doc.createElement('span');
    icon.className = 'claudian-status-panel-icon';
    setIcon(icon, TODO_TOOL_ICON);
    this.todoHeaderEl.appendChild(icon);

    const label = doc.createElement('span');
    label.className = 'claudian-status-panel-label';
    label.textContent = `Tasks (${completedCount}/${totalCount})`;
    this.todoHeaderEl.appendChild(label);

    if (!this.isTodoExpanded) {
      if (completedCount === totalCount && totalCount > 0) {
        const status = doc.createElement('span');
        status.className = 'claudian-status-panel-status status-completed';
        setIcon(status, 'check');
        this.todoHeaderEl.appendChild(status);
      }

      if (currentTask) {
        const current = doc.createElement('span');
        current.className = 'claudian-status-panel-current';
        current.textContent = currentTask.activeForm;
        this.todoHeaderEl.appendChild(current);
      }
    }
  }

  private renderTodoContent(todos: TodoItem[]): void {
    if (!this.todoContentEl) return;
    renderTodoItems(this.doc, this.todoContentEl, todos);
  }

  private toggleTodos(): void {
    this.isTodoExpanded = !this.isTodoExpanded;
    this.updateTodoDisplay();
  }

  private updateTodoDisplay(): void {
    if (!this.todoContentEl || !this.todoHeaderEl) return;

    this.todoContentEl.style.display = this.isTodoExpanded ? 'block' : 'none';

    if (this.currentTodos && this.currentTodos.length > 0) {
      const completedCount = this.currentTodos.filter(t => t.status === 'completed').length;
      const totalCount = this.currentTodos.length;
      const currentTask = this.currentTodos.find(t => t.status === 'in_progress');
      this.renderTodoHeader(completedCount, totalCount, currentTask);
      this.updateTodoAriaLabel(completedCount, totalCount);
    }

    this.scrollToBottom();
  }

  private updateTodoAriaLabel(completedCount: number, totalCount: number): void {
    if (!this.todoHeaderEl) return;

    const action = this.isTodoExpanded ? 'Collapse' : 'Expand';
    this.todoHeaderEl.setAttribute(
      'aria-label',
      `${action} task list - ${completedCount} of ${totalCount} completed`
    );
    this.todoHeaderEl.setAttribute('aria-expanded', String(this.isTodoExpanded));
  }

  private scrollToBottom(): void {
    if (this.containerEl) {
      this.containerEl.scrollTop = this.containerEl.scrollHeight;
    }
  }

  // ============================================
  // Bash Output Methods
  // ============================================

  private truncateDescription(description: string, maxLength = 50): string {
    if (description.length <= maxLength) return description;
    return description.substring(0, maxLength) + '...';
  }

  addBashOutput(info: PanelBashOutput): void {
    this.currentBashOutputs.set(info.id, info);
    while (this.currentBashOutputs.size > MAX_BASH_OUTPUTS) {
      const oldest = this.currentBashOutputs.keys().next().value as string | undefined;
      if (!oldest) break;
      this.currentBashOutputs.delete(oldest);
      this.bashEntryExpanded.delete(oldest);
    }
    this.renderBashOutputs();
  }

  updateBashOutput(id: string, updates: Partial<Omit<PanelBashOutput, 'id' | 'command'>>): void {
    const existing = this.currentBashOutputs.get(id);
    if (!existing) return;
    this.currentBashOutputs.set(id, { ...existing, ...updates });
    this.renderBashOutputs();
  }

  clearBashOutputs(): void {
    this.currentBashOutputs.clear();
    this.bashEntryExpanded.clear();
    this.renderBashOutputs();
  }

  private renderBashOutputs(options: { scroll?: boolean } = {}): void {
    if (!this.bashOutputContainerEl || !this.bashHeaderEl || !this.bashContentEl) return;
    const doc = this.doc;
    const scroll = options.scroll ?? true;

    if (this.currentBashOutputs.size === 0) {
      this.bashOutputContainerEl.style.display = 'none';
      return;
    }

    this.bashOutputContainerEl.style.display = 'block';
    this.empty(this.bashHeaderEl);
    this.empty(this.bashContentEl);

    const headerIconEl = doc.createElement('span');
    headerIconEl.className = 'claudian-tool-icon';
    headerIconEl.setAttribute('aria-hidden', 'true');
    setIcon(headerIconEl, 'terminal');
    this.bashHeaderEl.appendChild(headerIconEl);

    const latest = Array.from(this.currentBashOutputs.values()).at(-1);

    const headerLabelEl = doc.createElement('span');
    headerLabelEl.className = 'claudian-tool-label';
    if (this.isBashExpanded) {
      headerLabelEl.textContent = t('chat.bangBash.commandPanel');
    } else {
      headerLabelEl.textContent = latest ? this.truncateDescription(latest.command, 60) : t('chat.bangBash.commandPanel');
    }
    this.bashHeaderEl.appendChild(headerLabelEl);

    const previewEl = doc.createElement('span');
    previewEl.className = 'claudian-tool-current';
    previewEl.style.display = this.isBashExpanded ? '' : 'none';
    this.bashHeaderEl.appendChild(previewEl);

    const summaryStatusEl = doc.createElement('span');
    summaryStatusEl.className = 'claudian-tool-status';
    if (!this.isBashExpanded && latest) {
      summaryStatusEl.classList.add(`status-${latest.status}`);
      summaryStatusEl.setAttribute('aria-label', t('chat.bangBash.statusLabel', { status: latest.status }));
      if (latest.status === 'completed') setIcon(summaryStatusEl, 'check');
      if (latest.status === 'error') setIcon(summaryStatusEl, 'x');
    } else {
      summaryStatusEl.style.display = 'none';
    }
    this.bashHeaderEl.appendChild(summaryStatusEl);

    this.bashHeaderEl.setAttribute('aria-expanded', String(this.isBashExpanded));

    const actionsEl = doc.createElement('span');
    actionsEl.className = 'claudian-status-panel-bash-actions';
    this.appendActionButton(actionsEl, 'copy', t('chat.bangBash.copyAriaLabel'), 'copy', () => {
      void this.copyLatestBashOutput();
    });
    this.appendActionButton(actionsEl, 'clear', t('chat.bangBash.clearAriaLabel'), 'trash-2', () => {
      this.clearBashOutputs();
    });
    this.bashHeaderEl.appendChild(actionsEl);

    this.bashContentEl.style.display = this.isBashExpanded ? 'block' : 'none';

    if (!this.isBashExpanded) return;

    for (const info of this.currentBashOutputs.values()) {
      this.bashContentEl.appendChild(this.renderBashEntry(info));
    }

    if (scroll) {
      this.bashContentEl.scrollTop = this.bashContentEl.scrollHeight;
      this.scrollToBottom();
    }
  }

  private renderBashEntry(info: PanelBashOutput): HTMLElement {
    const doc = this.doc;

    const entryEl = doc.createElement('div');
    entryEl.className = 'claudian-tool-call claudian-status-panel-bash-entry';

    const entryHeaderEl = doc.createElement('div');
    entryHeaderEl.className = 'claudian-tool-header';
    entryHeaderEl.setAttribute('tabindex', '0');
    entryHeaderEl.setAttribute('role', 'button');

    const entryIconEl = doc.createElement('span');
    entryIconEl.className = 'claudian-tool-icon';
    entryIconEl.setAttribute('aria-hidden', 'true');
    setIcon(entryIconEl, 'terminal');
    entryHeaderEl.appendChild(entryIconEl);

    const entryLabelEl = doc.createElement('span');
    entryLabelEl.className = 'claudian-tool-label';
    entryLabelEl.textContent = t('chat.bangBash.commandLabel', { command: this.truncateDescription(info.command, 60) });
    entryHeaderEl.appendChild(entryLabelEl);

    const entryStatusEl = doc.createElement('span');
    entryStatusEl.className = 'claudian-tool-status';
    entryStatusEl.classList.add(`status-${info.status}`);
    entryStatusEl.setAttribute('aria-label', t('chat.bangBash.statusLabel', { status: info.status }));
    if (info.status === 'completed') setIcon(entryStatusEl, 'check');
    if (info.status === 'error') setIcon(entryStatusEl, 'x');
    entryHeaderEl.appendChild(entryStatusEl);

    entryEl.appendChild(entryHeaderEl);

    const contentEl = doc.createElement('div');
    contentEl.className = 'claudian-tool-content';
    const isEntryExpanded = this.bashEntryExpanded.get(info.id) ?? true;
    contentEl.style.display = isEntryExpanded ? 'block' : 'none';
    entryHeaderEl.setAttribute('aria-expanded', String(isEntryExpanded));
    entryHeaderEl.setAttribute('aria-label', isEntryExpanded ? t('chat.bangBash.collapseOutput') : t('chat.bangBash.expandOutput'));
    entryHeaderEl.addEventListener('click', () => {
      this.bashEntryExpanded.set(info.id, !isEntryExpanded);
      this.renderBashOutputs({ scroll: false });
    });
    entryHeaderEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.bashEntryExpanded.set(info.id, !isEntryExpanded);
        this.renderBashOutputs({ scroll: false });
      }
    });

    const rowEl = doc.createElement('div');
    rowEl.className = 'claudian-tool-result-row';

    const textEl = doc.createElement('span');
    textEl.className = 'claudian-tool-result-text';
    if (info.status === 'running' && !info.output) {
      textEl.textContent = t('chat.bangBash.running');
    } else if (info.output) {
      textEl.textContent = info.output;
    }

    rowEl.appendChild(textEl);
    contentEl.appendChild(rowEl);

    entryEl.appendChild(contentEl);
    return entryEl;
  }

  private async copyLatestBashOutput(): Promise<void> {
    const latest = Array.from(this.currentBashOutputs.values()).at(-1);
    if (!latest) return;

    const output = latest.output?.trim() || (latest.status === 'running' ? t('chat.bangBash.running') : '');
    const text = output ? `$ ${latest.command}\n${output}` : `$ ${latest.command}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      console.error('[archivist] Failed to copy to clipboard');
    }
  }

  private appendActionButton(
    parent: HTMLElement,
    name: string,
    ariaLabel: string,
    icon: string,
    action: () => void
  ): void {
    const doc = this.doc;
    const el = doc.createElement('span');
    el.className = `claudian-status-panel-bash-action claudian-status-panel-bash-action-${name}`;
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', ariaLabel);
    setIcon(el, icon);
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      action();
    });
    el.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        action();
      }
    });
    parent.appendChild(el);
  }

  private toggleBashSection(): void {
    this.isBashExpanded = !this.isBashExpanded;
    this.renderBashOutputs({ scroll: false });
  }

  // ============================================
  // Cleanup
  // ============================================

  private removeEventListeners(): void {
    if (this.todoHeaderEl) {
      if (this.todoClickHandler) this.todoHeaderEl.removeEventListener('click', this.todoClickHandler);
      if (this.todoKeydownHandler) this.todoHeaderEl.removeEventListener('keydown', this.todoKeydownHandler);
    }
    this.todoClickHandler = null;
    this.todoKeydownHandler = null;

    if (this.bashHeaderEl) {
      if (this.bashClickHandler) this.bashHeaderEl.removeEventListener('click', this.bashClickHandler);
      if (this.bashKeydownHandler) this.bashHeaderEl.removeEventListener('keydown', this.bashKeydownHandler);
    }
    this.bashClickHandler = null;
    this.bashKeydownHandler = null;
  }

  destroy(): void {
    this.removeEventListeners();
    this.currentBashOutputs.clear();

    if (this.panelEl) {
      this.panelEl.remove();
      this.panelEl = null;
    }
    this.bashOutputContainerEl = null;
    this.bashHeaderEl = null;
    this.bashContentEl = null;
    this.todoContainerEl = null;
    this.todoHeaderEl = null;
    this.todoContentEl = null;
    this.containerEl = null;
    this.currentTodos = null;
  }

  private empty(el: HTMLElement): void {
    while (el.firstChild) el.removeChild(el.firstChild);
  }
}
