import { setIcon } from '../shared/icons';
import type { ToolCallInfo } from '../state/types';
import type { DiffLine } from './DiffRenderer';
import { setupCollapsible } from './collapsible';
import { renderDiffContent } from './DiffRenderer';
import { fileNameOnly } from './ToolCallRenderer';

// Local DiffStats for rendering (matches Obsidian's DiffStats shape)
interface DiffStats {
  added: number;
  removed: number;
}

// Tool diff data for write/edit operations
interface ToolDiffData {
  diffLines: DiffLine[];
  stats: DiffStats;
}

export interface WriteEditState {
  wrapperEl: HTMLElement;
  contentEl: HTMLElement;
  headerEl: HTMLElement;
  nameEl: HTMLElement;
  summaryEl: HTMLElement;
  statsEl: HTMLElement;
  statusEl: HTMLElement;
  toolCall: ToolCallInfo;
  isExpanded: boolean;
  diffLines?: DiffLine[];
}

function getToolIcon(toolName: string): string {
  return toolName === 'Write' ? 'pencil' : 'file-edit';
}

function shortenPath(filePath: string, maxLength = 40): string {
  if (!filePath) return 'file';
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.length <= maxLength) return normalized;

  const parts = normalized.split('/');
  if (parts.length <= 2) {
    return '...' + normalized.slice(-maxLength + 3);
  }

  const filename = parts[parts.length - 1];
  const firstDir = parts[0];
  const available = maxLength - firstDir.length - filename.length - 5;

  if (available < 0) {
    return '...' + filename.slice(-maxLength + 3);
  }

  return `${firstDir}/.../${filename}`;
}

function renderDiffStats(doc: Document, statsEl: HTMLElement, stats: DiffStats): void {
  if (stats.added > 0) {
    const addedEl = doc.createElement('span');
    addedEl.className = 'added';
    addedEl.textContent = `+${stats.added}`;
    statsEl.appendChild(addedEl);
  }
  if (stats.removed > 0) {
    if (stats.added > 0) {
      const space = doc.createElement('span');
      space.textContent = ' ';
      statsEl.appendChild(space);
    }
    const removedEl = doc.createElement('span');
    removedEl.className = 'removed';
    removedEl.textContent = `-${stats.removed}`;
    statsEl.appendChild(removedEl);
  }
}

export function createWriteEditBlock(
  doc: Document,
  parentEl: HTMLElement,
  toolCall: ToolCallInfo
): WriteEditState {
  const filePath = (toolCall.input.file_path as string) || 'file';
  const toolName = toolCall.name;

  const wrapperEl = doc.createElement('div');
  wrapperEl.className = 'claudian-write-edit-block';
  wrapperEl.dataset.toolId = toolCall.id;
  parentEl.appendChild(wrapperEl);

  // Header (clickable to collapse/expand)
  const headerEl = doc.createElement('div');
  headerEl.className = 'claudian-write-edit-header';
  headerEl.setAttribute('tabindex', '0');
  headerEl.setAttribute('role', 'button');
  headerEl.setAttribute('aria-label', `${toolName}: ${shortenPath(filePath)} - click to expand`);
  wrapperEl.appendChild(headerEl);

  // File icon
  const iconEl = doc.createElement('div');
  iconEl.className = 'claudian-write-edit-icon';
  iconEl.setAttribute('aria-hidden', 'true');
  setIcon(iconEl, getToolIcon(toolName));
  headerEl.appendChild(iconEl);

  const nameEl = doc.createElement('div');
  nameEl.className = 'claudian-write-edit-name';
  nameEl.textContent = toolName;
  headerEl.appendChild(nameEl);

  const summaryEl = doc.createElement('div');
  summaryEl.className = 'claudian-write-edit-summary';
  summaryEl.textContent = fileNameOnly(filePath) || 'file';
  headerEl.appendChild(summaryEl);

  const statsEl = doc.createElement('div');
  statsEl.className = 'claudian-write-edit-stats';
  headerEl.appendChild(statsEl);

  const statusEl = doc.createElement('div');
  statusEl.className = 'claudian-write-edit-status status-running';
  statusEl.setAttribute('aria-label', 'Status: running');
  headerEl.appendChild(statusEl);

  // Content area (collapsed by default)
  const contentEl = doc.createElement('div');
  contentEl.className = 'claudian-write-edit-content';
  wrapperEl.appendChild(contentEl);

  // Initial loading state
  const loadingRow = doc.createElement('div');
  loadingRow.className = 'claudian-write-edit-diff-row';
  contentEl.appendChild(loadingRow);

  const loadingEl = doc.createElement('div');
  loadingEl.className = 'claudian-write-edit-loading';
  loadingEl.textContent = 'Writing...';
  loadingRow.appendChild(loadingEl);

  const state: WriteEditState = {
    wrapperEl,
    contentEl,
    headerEl,
    nameEl,
    summaryEl,
    statsEl,
    statusEl,
    toolCall,
    isExpanded: false,
  };

  setupCollapsible(wrapperEl, headerEl, contentEl, state);

  return state;
}

export function updateWriteEditWithDiff(doc: Document, state: WriteEditState, diffData: ToolDiffData): void {
  while (state.statsEl.firstChild) state.statsEl.removeChild(state.statsEl.firstChild);
  while (state.contentEl.firstChild) state.contentEl.removeChild(state.contentEl.firstChild);

  const { diffLines, stats } = diffData;
  state.diffLines = diffLines;

  renderDiffStats(doc, state.statsEl, stats);

  const row = doc.createElement('div');
  row.className = 'claudian-write-edit-diff-row';
  state.contentEl.appendChild(row);

  const diffEl = doc.createElement('div');
  diffEl.className = 'claudian-write-edit-diff';
  row.appendChild(diffEl);

  renderDiffContent(doc, diffEl, diffLines);
}

export function finalizeWriteEditBlock(doc: Document, state: WriteEditState, isError: boolean): void {
  state.statusEl.className = 'claudian-write-edit-status';
  while (state.statusEl.firstChild) state.statusEl.removeChild(state.statusEl.firstChild);

  if (isError) {
    state.statusEl.classList.add('status-error');
    setIcon(state.statusEl, 'x');
    state.statusEl.setAttribute('aria-label', 'Status: error');

    if (!state.diffLines) {
      while (state.contentEl.firstChild) state.contentEl.removeChild(state.contentEl.firstChild);
      const row = doc.createElement('div');
      row.className = 'claudian-write-edit-diff-row';
      state.contentEl.appendChild(row);

      const errorEl = doc.createElement('div');
      errorEl.className = 'claudian-write-edit-error';
      errorEl.textContent = state.toolCall.result || 'Error';
      row.appendChild(errorEl);
    }
  } else if (!state.diffLines) {
    while (state.contentEl.firstChild) state.contentEl.removeChild(state.contentEl.firstChild);
    const row = doc.createElement('div');
    row.className = 'claudian-write-edit-diff-row';
    state.contentEl.appendChild(row);

    const doneEl = doc.createElement('div');
    doneEl.className = 'claudian-write-edit-done-text';
    doneEl.textContent = 'DONE';
    row.appendChild(doneEl);
  }

  if (isError) {
    state.wrapperEl.classList.add('error');
  } else {
    state.wrapperEl.classList.add('done');
  }
}

export function renderStoredWriteEdit(doc: Document, parentEl: HTMLElement, toolCall: ToolCallInfo): HTMLElement {
  const filePath = (toolCall.input.file_path as string) || 'file';
  const toolName = toolCall.name;
  const isError = toolCall.status === 'error' || toolCall.status === 'blocked';

  const wrapperEl = doc.createElement('div');
  wrapperEl.className = 'claudian-write-edit-block';
  if (isError) wrapperEl.classList.add('error');
  else if (toolCall.status === 'completed') wrapperEl.classList.add('done');
  wrapperEl.dataset.toolId = toolCall.id;
  parentEl.appendChild(wrapperEl);

  // Header
  const headerEl = doc.createElement('div');
  headerEl.className = 'claudian-write-edit-header';
  headerEl.setAttribute('tabindex', '0');
  headerEl.setAttribute('role', 'button');
  wrapperEl.appendChild(headerEl);

  const iconEl = doc.createElement('div');
  iconEl.className = 'claudian-write-edit-icon';
  iconEl.setAttribute('aria-hidden', 'true');
  setIcon(iconEl, getToolIcon(toolName));
  headerEl.appendChild(iconEl);

  const nameEl = doc.createElement('div');
  nameEl.className = 'claudian-write-edit-name';
  nameEl.textContent = toolName;
  headerEl.appendChild(nameEl);

  const summaryEl = doc.createElement('div');
  summaryEl.className = 'claudian-write-edit-summary';
  summaryEl.textContent = fileNameOnly(filePath) || 'file';
  headerEl.appendChild(summaryEl);

  const statsEl = doc.createElement('div');
  statsEl.className = 'claudian-write-edit-stats';
  headerEl.appendChild(statsEl);

  if (toolCall.diffData) {
    // Adapt from the Logseq state types to the local rendering DiffStats
    const stats: DiffStats = {
      added: (toolCall.diffData.stats as any).added ?? (toolCall.diffData.stats as any).additions ?? 0,
      removed: (toolCall.diffData.stats as any).removed ?? (toolCall.diffData.stats as any).deletions ?? 0,
    };
    renderDiffStats(doc, statsEl, stats);
  }

  const statusEl = doc.createElement('div');
  statusEl.className = 'claudian-write-edit-status';
  if (isError) {
    statusEl.classList.add('status-error');
    setIcon(statusEl, 'x');
  }
  headerEl.appendChild(statusEl);

  // Content
  const contentEl = doc.createElement('div');
  contentEl.className = 'claudian-write-edit-content';
  wrapperEl.appendChild(contentEl);

  const row = doc.createElement('div');
  row.className = 'claudian-write-edit-diff-row';
  contentEl.appendChild(row);

  if (toolCall.diffData && toolCall.diffData.diffLines.length > 0) {
    const diffEl = doc.createElement('div');
    diffEl.className = 'claudian-write-edit-diff';
    row.appendChild(diffEl);
    // Adapt diffLines from Logseq format (add/remove/context) to rendering format (insert/delete/equal)
    const adaptedLines: DiffLine[] = toolCall.diffData.diffLines.map((l: any) => ({
      type: l.type === 'add' ? 'insert' : l.type === 'remove' ? 'delete' : l.type === 'context' ? 'equal' : l.type,
      text: l.content ?? l.text ?? '',
    }));
    renderDiffContent(doc, diffEl, adaptedLines);
  } else if (isError && toolCall.result) {
    const errorEl = doc.createElement('div');
    errorEl.className = 'claudian-write-edit-error';
    errorEl.textContent = toolCall.result;
    row.appendChild(errorEl);
  } else {
    const doneEl = doc.createElement('div');
    doneEl.className = 'claudian-write-edit-done-text';
    doneEl.textContent = isError ? 'ERROR' : 'DONE';
    row.appendChild(doneEl);
  }

  const state = { isExpanded: false };
  setupCollapsible(wrapperEl, headerEl, contentEl, state);

  return wrapperEl;
}
