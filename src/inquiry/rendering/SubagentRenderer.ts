import { setIcon } from '../shared/icons';
import type { SubagentInfo, ToolCallInfo } from '../state/types';
import { setupCollapsible } from './collapsible';
import {
  getToolIcon,
  getToolLabel,
  getToolName,
  getToolSummary,
  renderExpandedContent,
  setToolIcon,
} from './ToolCallRenderer';

// ── Tool constant (Agent/Task) ──────────────────────────

const TOOL_TASK = 'Agent';

// ── Internal types ──────────────────────────────────────

interface SubagentToolView {
  wrapperEl: HTMLElement;
  nameEl: HTMLElement;
  summaryEl: HTMLElement;
  statusEl: HTMLElement;
  contentEl: HTMLElement;
}

interface SubagentSection {
  wrapperEl: HTMLElement;
  bodyEl: HTMLElement;
}

export interface SubagentState {
  wrapperEl: HTMLElement;
  contentEl: HTMLElement;
  headerEl: HTMLElement;
  labelEl: HTMLElement;
  countEl: HTMLElement;
  statusEl: HTMLElement;
  promptSectionEl: HTMLElement;
  promptBodyEl: HTMLElement;
  toolsContainerEl: HTMLElement;
  resultSectionEl: HTMLElement | null;
  resultBodyEl: HTMLElement | null;
  toolElements: Map<string, SubagentToolView>;
  info: SubagentInfo;
}

const SUBAGENT_TOOL_STATUS_ICONS: Partial<Record<ToolCallInfo['status'], string>> = {
  completed: 'check',
  error: 'x',
  blocked: 'shield-off',
};

// ── Helpers ─────────────────────────────────────────────

function extractTaskDescription(input: Record<string, unknown>): string {
  return (input.description as string) || 'Subagent task';
}

function extractTaskPrompt(input: Record<string, unknown>): string {
  return (input.prompt as string) || '';
}

function truncateDescription(description: string, maxLength = 40): string {
  if (description.length <= maxLength) return description;
  return description.substring(0, maxLength) + '...';
}

function getDoc(el: HTMLElement): Document {
  return el.ownerDocument;
}

function createSection(parentEl: HTMLElement, title: string, bodyClass?: string): SubagentSection {
  const doc = getDoc(parentEl);

  const wrapperEl = doc.createElement('div');
  wrapperEl.className = 'claudian-subagent-section';
  parentEl.appendChild(wrapperEl);

  const headerEl = doc.createElement('div');
  headerEl.className = 'claudian-subagent-section-header';
  headerEl.setAttribute('tabindex', '0');
  headerEl.setAttribute('role', 'button');
  wrapperEl.appendChild(headerEl);

  const titleEl = doc.createElement('div');
  titleEl.className = 'claudian-subagent-section-title';
  titleEl.textContent = title;
  headerEl.appendChild(titleEl);

  const bodyEl = doc.createElement('div');
  bodyEl.className = 'claudian-subagent-section-body';
  if (bodyClass) bodyEl.classList.add(bodyClass);
  wrapperEl.appendChild(bodyEl);

  const state = { isExpanded: false };
  setupCollapsible(wrapperEl, headerEl, bodyEl, state, { baseAriaLabel: title });

  return { wrapperEl, bodyEl };
}

function setPromptText(doc: Document, promptBodyEl: HTMLElement, prompt: string): void {
  while (promptBodyEl.firstChild) promptBodyEl.removeChild(promptBodyEl.firstChild);
  const textEl = doc.createElement('div');
  textEl.className = 'claudian-subagent-prompt-text';
  textEl.textContent = prompt || 'No prompt provided';
  promptBodyEl.appendChild(textEl);
}

function updateSyncHeaderAria(state: SubagentState): void {
  const toolCount = state.info.toolCalls.length;
  state.headerEl.setAttribute(
    'aria-label',
    `Subagent task: ${truncateDescription(state.info.description)} - ${toolCount} tool uses - Status: ${state.info.status} - click to expand`,
  );
  state.statusEl.setAttribute('aria-label', `Status: ${state.info.status}`);
}

function renderSubagentToolContent(doc: Document, contentEl: HTMLElement, toolCall: ToolCallInfo): void {
  while (contentEl.firstChild) contentEl.removeChild(contentEl.firstChild);
  if (!toolCall.result) {
    const emptyEl = doc.createElement('div');
    emptyEl.className = 'claudian-subagent-tool-empty';
    emptyEl.textContent = toolCall.status === 'running' ? 'Running...' : 'No output recorded';
    contentEl.appendChild(emptyEl);
    return;
  }
  renderExpandedContent(doc, contentEl, toolCall.name, toolCall.result);
}

function setSubagentToolStatus(view: SubagentToolView, status: ToolCallInfo['status']): void {
  view.statusEl.className = 'claudian-subagent-tool-status';
  view.statusEl.classList.add(`status-${status}`);
  while (view.statusEl.firstChild) view.statusEl.removeChild(view.statusEl.firstChild);
  view.statusEl.setAttribute('aria-label', `Status: ${status}`);
  const statusIcon = SUBAGENT_TOOL_STATUS_ICONS[status];
  if (statusIcon) setIcon(view.statusEl, statusIcon);
}

function updateSubagentToolView(doc: Document, view: SubagentToolView, toolCall: ToolCallInfo): void {
  view.wrapperEl.className = `claudian-subagent-tool-item claudian-subagent-tool-${toolCall.status}`;
  view.nameEl.textContent = getToolName(toolCall.name, toolCall.input);
  view.summaryEl.textContent = getToolSummary(toolCall.name, toolCall.input);
  setSubagentToolStatus(view, toolCall.status);
  renderSubagentToolContent(doc, view.contentEl, toolCall);
}

function createSubagentToolView(doc: Document, parentEl: HTMLElement, toolCall: ToolCallInfo): SubagentToolView {
  const wrapperEl = doc.createElement('div');
  wrapperEl.className = `claudian-subagent-tool-item claudian-subagent-tool-${toolCall.status}`;
  wrapperEl.dataset.toolId = toolCall.id;
  parentEl.appendChild(wrapperEl);

  const headerEl = doc.createElement('div');
  headerEl.className = 'claudian-subagent-tool-header';
  headerEl.setAttribute('tabindex', '0');
  headerEl.setAttribute('role', 'button');
  wrapperEl.appendChild(headerEl);

  const iconEl = doc.createElement('div');
  iconEl.className = 'claudian-subagent-tool-icon';
  iconEl.setAttribute('aria-hidden', 'true');
  setToolIcon(iconEl, toolCall.name);
  headerEl.appendChild(iconEl);

  const nameEl = doc.createElement('div');
  nameEl.className = 'claudian-subagent-tool-name';
  headerEl.appendChild(nameEl);

  const summaryEl = doc.createElement('div');
  summaryEl.className = 'claudian-subagent-tool-summary';
  headerEl.appendChild(summaryEl);

  const statusEl = doc.createElement('div');
  statusEl.className = 'claudian-subagent-tool-status';
  headerEl.appendChild(statusEl);

  const contentEl = doc.createElement('div');
  contentEl.className = 'claudian-subagent-tool-content';
  wrapperEl.appendChild(contentEl);

  const collapseState = { isExpanded: toolCall.isExpanded ?? false };
  setupCollapsible(wrapperEl, headerEl, contentEl, collapseState, {
    initiallyExpanded: toolCall.isExpanded ?? false,
    onToggle: (expanded) => {
      toolCall.isExpanded = expanded;
    },
    baseAriaLabel: getToolLabel(toolCall.name, toolCall.input),
  });

  const view: SubagentToolView = { wrapperEl, nameEl, summaryEl, statusEl, contentEl };
  updateSubagentToolView(doc, view, toolCall);

  return view;
}

function ensureResultSection(state: SubagentState): SubagentSection {
  if (state.resultSectionEl && state.resultBodyEl) {
    return { wrapperEl: state.resultSectionEl, bodyEl: state.resultBodyEl };
  }
  const section = createSection(state.contentEl, 'Result', 'claudian-subagent-result-body');
  section.wrapperEl.classList.add('claudian-subagent-section-result');
  state.resultSectionEl = section.wrapperEl;
  state.resultBodyEl = section.bodyEl;
  return section;
}

function setResultText(state: SubagentState, text: string): void {
  const doc = getDoc(state.contentEl);
  const section = ensureResultSection(state);
  while (section.bodyEl.firstChild) section.bodyEl.removeChild(section.bodyEl.firstChild);
  const resultEl = doc.createElement('div');
  resultEl.className = 'claudian-subagent-result-output';
  resultEl.textContent = text;
  section.bodyEl.appendChild(resultEl);
}

function hydrateSyncSubagentStateFromStored(doc: Document, state: SubagentState, subagent: SubagentInfo): void {
  state.info.description = subagent.description;
  state.info.prompt = subagent.prompt;
  state.info.mode = subagent.mode;
  state.info.status = subagent.status;
  state.info.result = subagent.result;

  state.labelEl.textContent = truncateDescription(subagent.description);
  setPromptText(doc, state.promptBodyEl, subagent.prompt || '');

  for (const originalToolCall of subagent.toolCalls) {
    const toolCall: ToolCallInfo = { ...originalToolCall, input: { ...originalToolCall.input } };
    addSubagentToolCall(doc, state, toolCall);
    if (toolCall.status !== 'running' || toolCall.result) {
      updateSubagentToolResult(doc, state, toolCall.id, toolCall);
    }
  }

  if (subagent.status === 'completed' || subagent.status === 'error') {
    const fallback = subagent.status === 'error' ? 'ERROR' : 'DONE';
    finalizeSubagentBlock(state, subagent.result || fallback, subagent.status === 'error');
  } else {
    state.statusEl.className = 'claudian-subagent-status status-running';
    while (state.statusEl.firstChild) state.statusEl.removeChild(state.statusEl.firstChild);
    updateSyncHeaderAria(state);
  }
}

// ── Public API ──────────────────────────────────────────

export function createSubagentBlock(
  doc: Document,
  parentEl: HTMLElement,
  taskToolId: string,
  taskInput: Record<string, unknown>,
): SubagentState {
  const description = extractTaskDescription(taskInput);
  const prompt = extractTaskPrompt(taskInput);

  const info: SubagentInfo = {
    id: taskToolId,
    description,
    prompt,
    status: 'running',
    toolCalls: [],
    isExpanded: false,
  };

  const wrapperEl = doc.createElement('div');
  wrapperEl.className = 'claudian-subagent-list';
  wrapperEl.dataset.subagentId = taskToolId;
  parentEl.appendChild(wrapperEl);

  const headerEl = doc.createElement('div');
  headerEl.className = 'claudian-subagent-header';
  headerEl.setAttribute('tabindex', '0');
  headerEl.setAttribute('role', 'button');
  wrapperEl.appendChild(headerEl);

  const iconEl = doc.createElement('div');
  iconEl.className = 'claudian-subagent-icon';
  iconEl.setAttribute('aria-hidden', 'true');
  setIcon(iconEl, getToolIcon(TOOL_TASK));
  headerEl.appendChild(iconEl);

  const labelEl = doc.createElement('div');
  labelEl.className = 'claudian-subagent-label';
  labelEl.textContent = truncateDescription(description);
  headerEl.appendChild(labelEl);

  const countEl = doc.createElement('div');
  countEl.className = 'claudian-subagent-count';
  countEl.textContent = '0 tool uses';
  headerEl.appendChild(countEl);

  const statusEl = doc.createElement('div');
  statusEl.className = 'claudian-subagent-status status-running';
  statusEl.setAttribute('aria-label', 'Status: running');
  headerEl.appendChild(statusEl);

  const contentEl = doc.createElement('div');
  contentEl.className = 'claudian-subagent-content';
  wrapperEl.appendChild(contentEl);

  const promptSection = createSection(contentEl, 'Prompt', 'claudian-subagent-prompt-body');
  promptSection.wrapperEl.classList.add('claudian-subagent-section-prompt');
  setPromptText(doc, promptSection.bodyEl, prompt);

  const toolsContainerEl = doc.createElement('div');
  toolsContainerEl.className = 'claudian-subagent-tools';
  contentEl.appendChild(toolsContainerEl);

  setupCollapsible(wrapperEl, headerEl, contentEl, info);

  const state: SubagentState = {
    wrapperEl,
    contentEl,
    headerEl,
    labelEl,
    countEl,
    statusEl,
    promptSectionEl: promptSection.wrapperEl,
    promptBodyEl: promptSection.bodyEl,
    toolsContainerEl,
    resultSectionEl: null,
    resultBodyEl: null,
    toolElements: new Map<string, SubagentToolView>(),
    info,
  };

  updateSyncHeaderAria(state);
  return state;
}

export function addSubagentToolCall(
  doc: Document,
  state: SubagentState,
  toolCall: ToolCallInfo,
): void {
  state.info.toolCalls.push(toolCall);
  state.countEl.textContent = `${state.info.toolCalls.length} tool uses`;
  const toolView = createSubagentToolView(doc, state.toolsContainerEl, toolCall);
  state.toolElements.set(toolCall.id, toolView);
  updateSyncHeaderAria(state);
}

export function updateSubagentToolResult(
  doc: Document,
  state: SubagentState,
  toolId: string,
  toolCall: ToolCallInfo,
): void {
  const idx = state.info.toolCalls.findIndex(tc => tc.id === toolId);
  if (idx !== -1) state.info.toolCalls[idx] = toolCall;
  const toolView = state.toolElements.get(toolId);
  if (!toolView) return;
  updateSubagentToolView(doc, toolView, toolCall);
}

export function finalizeSubagentBlock(
  state: SubagentState,
  result: string,
  isError: boolean,
): void {
  state.info.status = isError ? 'error' : 'completed';
  state.info.result = result;

  state.labelEl.textContent = truncateDescription(state.info.description);
  state.countEl.textContent = `${state.info.toolCalls.length} tool uses`;

  state.statusEl.className = 'claudian-subagent-status';
  state.statusEl.classList.add(`status-${state.info.status}`);
  while (state.statusEl.firstChild) state.statusEl.removeChild(state.statusEl.firstChild);

  if (state.info.status === 'completed') {
    setIcon(state.statusEl, 'check');
    state.wrapperEl.classList.remove('error');
    state.wrapperEl.classList.add('done');
  } else {
    setIcon(state.statusEl, 'x');
    state.wrapperEl.classList.remove('done');
    state.wrapperEl.classList.add('error');
  }

  const finalText = result?.trim() ? result : (isError ? 'ERROR' : 'DONE');
  setResultText(state, finalText);
  updateSyncHeaderAria(state);
}

export function renderStoredSubagent(
  doc: Document,
  parentEl: HTMLElement,
  subagent: SubagentInfo,
): HTMLElement {
  const state = createSubagentBlock(doc, parentEl, subagent.id, {
    description: subagent.description,
    prompt: subagent.prompt,
  });
  hydrateSyncSubagentStateFromStored(doc, state, subagent);
  return state.wrapperEl;
}

// ── Async subagent support ──────────────────────────────

export interface AsyncSubagentState {
  wrapperEl: HTMLElement;
  contentEl: HTMLElement;
  headerEl: HTMLElement;
  labelEl: HTMLElement;
  statusTextEl: HTMLElement;
  statusEl: HTMLElement;
  info: SubagentInfo;
}

function setAsyncWrapperStatus(wrapperEl: HTMLElement, status: string): void {
  const classes = ['pending', 'running', 'awaiting', 'completed', 'error', 'orphaned', 'async'];
  classes.forEach(cls => wrapperEl.classList.remove(cls));
  wrapperEl.classList.add('async');
  wrapperEl.classList.add(status);
}

function getAsyncDisplayStatus(asyncStatus: string | undefined): 'running' | 'completed' | 'error' | 'orphaned' {
  switch (asyncStatus) {
    case 'completed': return 'completed';
    case 'error': return 'error';
    case 'orphaned': return 'orphaned';
    default: return 'running';
  }
}

function getAsyncStatusText(asyncStatus: string | undefined): string {
  switch (asyncStatus) {
    case 'pending': return 'Initializing';
    case 'completed': return '';
    case 'error': return 'Error';
    case 'orphaned': return 'Orphaned';
    default: return 'Running in background';
  }
}

function getAsyncStatusAriaLabel(asyncStatus: string | undefined): string {
  switch (asyncStatus) {
    case 'pending': return 'Initializing';
    case 'completed': return 'Completed';
    case 'error': return 'Error';
    case 'orphaned': return 'Orphaned';
    default: return 'Running in background';
  }
}

function updateAsyncLabel(state: AsyncSubagentState): void {
  state.labelEl.textContent = truncateDescription(state.info.description);
  const statusLabel = getAsyncStatusAriaLabel(state.info.asyncStatus);
  state.headerEl.setAttribute(
    'aria-label',
    `Background task: ${truncateDescription(state.info.description)} - ${statusLabel} - click to expand`,
  );
}

function renderAsyncContentLikeSync(
  doc: Document,
  contentEl: HTMLElement,
  subagent: SubagentInfo,
  displayStatus: 'running' | 'completed' | 'error' | 'orphaned',
): void {
  while (contentEl.firstChild) contentEl.removeChild(contentEl.firstChild);

  const promptSection = createSection(contentEl, 'Prompt', 'claudian-subagent-prompt-body');
  promptSection.wrapperEl.classList.add('claudian-subagent-section-prompt');
  setPromptText(doc, promptSection.bodyEl, subagent.prompt || '');

  const toolsContainerEl = doc.createElement('div');
  toolsContainerEl.className = 'claudian-subagent-tools';
  contentEl.appendChild(toolsContainerEl);

  for (const originalToolCall of subagent.toolCalls) {
    const toolCall: ToolCallInfo = { ...originalToolCall, input: { ...originalToolCall.input } };
    createSubagentToolView(doc, toolsContainerEl, toolCall);
  }

  if (displayStatus === 'running') return;

  const resultSection = createSection(contentEl, 'Result', 'claudian-subagent-result-body');
  resultSection.wrapperEl.classList.add('claudian-subagent-section-result');

  const resultEl = doc.createElement('div');
  resultEl.className = 'claudian-subagent-result-output';
  resultSection.bodyEl.appendChild(resultEl);

  if (displayStatus === 'orphaned') {
    resultEl.textContent = subagent.result || 'Conversation ended before task completed';
    return;
  }

  const fallback = displayStatus === 'error' ? 'ERROR' : 'DONE';
  resultEl.textContent = subagent.result?.trim() ? subagent.result : fallback;
}

export function createAsyncSubagentBlock(
  doc: Document,
  parentEl: HTMLElement,
  taskToolId: string,
  taskInput: Record<string, unknown>,
): AsyncSubagentState {
  const description = (taskInput.description as string) || 'Background task';
  const prompt = (taskInput.prompt as string) || '';

  const info: SubagentInfo = {
    id: taskToolId,
    description,
    prompt,
    mode: 'async',
    status: 'running',
    toolCalls: [],
    isExpanded: false,
    asyncStatus: 'pending',
  };

  const wrapperEl = doc.createElement('div');
  wrapperEl.className = 'claudian-subagent-list';
  setAsyncWrapperStatus(wrapperEl, 'pending');
  wrapperEl.dataset.asyncSubagentId = taskToolId;
  parentEl.appendChild(wrapperEl);

  const headerEl = doc.createElement('div');
  headerEl.className = 'claudian-subagent-header';
  headerEl.setAttribute('tabindex', '0');
  headerEl.setAttribute('role', 'button');
  headerEl.setAttribute('aria-expanded', 'false');
  headerEl.setAttribute('aria-label', `Background task: ${description} - Initializing - click to expand`);
  wrapperEl.appendChild(headerEl);

  const iconEl = doc.createElement('div');
  iconEl.className = 'claudian-subagent-icon';
  iconEl.setAttribute('aria-hidden', 'true');
  setIcon(iconEl, getToolIcon(TOOL_TASK));
  headerEl.appendChild(iconEl);

  const labelEl = doc.createElement('div');
  labelEl.className = 'claudian-subagent-label';
  labelEl.textContent = truncateDescription(description);
  headerEl.appendChild(labelEl);

  const statusTextEl = doc.createElement('div');
  statusTextEl.className = 'claudian-subagent-status-text';
  statusTextEl.textContent = 'Initializing';
  headerEl.appendChild(statusTextEl);

  const statusEl = doc.createElement('div');
  statusEl.className = 'claudian-subagent-status status-running';
  statusEl.setAttribute('aria-label', 'Status: running');
  headerEl.appendChild(statusEl);

  const contentEl = doc.createElement('div');
  contentEl.className = 'claudian-subagent-content';
  wrapperEl.appendChild(contentEl);

  renderAsyncContentLikeSync(doc, contentEl, info, 'running');
  setupCollapsible(wrapperEl, headerEl, contentEl, info);

  return { wrapperEl, contentEl, headerEl, labelEl, statusTextEl, statusEl, info };
}

export function updateAsyncSubagentRunning(doc: Document, state: AsyncSubagentState, agentId: string): void {
  state.info.asyncStatus = 'running';
  state.info.agentId = agentId;
  setAsyncWrapperStatus(state.wrapperEl, 'running');
  updateAsyncLabel(state);
  state.statusTextEl.textContent = 'Running in background';
  renderAsyncContentLikeSync(doc, state.contentEl, state.info, 'running');
}

export function finalizeAsyncSubagent(doc: Document, state: AsyncSubagentState, result: string, isError: boolean): void {
  state.info.asyncStatus = isError ? 'error' : 'completed';
  state.info.status = isError ? 'error' : 'completed';
  state.info.result = result;

  setAsyncWrapperStatus(state.wrapperEl, isError ? 'error' : 'completed');
  updateAsyncLabel(state);
  state.statusTextEl.textContent = isError ? 'Error' : '';

  state.statusEl.className = 'claudian-subagent-status';
  state.statusEl.classList.add(`status-${isError ? 'error' : 'completed'}`);
  while (state.statusEl.firstChild) state.statusEl.removeChild(state.statusEl.firstChild);
  setIcon(state.statusEl, isError ? 'x' : 'check');

  if (isError) state.wrapperEl.classList.add('error');
  else state.wrapperEl.classList.add('done');

  renderAsyncContentLikeSync(doc, state.contentEl, state.info, isError ? 'error' : 'completed');
}

export function markAsyncSubagentOrphaned(doc: Document, state: AsyncSubagentState): void {
  state.info.asyncStatus = 'orphaned';
  state.info.status = 'error';
  state.info.result = 'Conversation ended before task completed';

  setAsyncWrapperStatus(state.wrapperEl, 'orphaned');
  updateAsyncLabel(state);
  state.statusTextEl.textContent = 'Orphaned';

  state.statusEl.className = 'claudian-subagent-status status-error';
  while (state.statusEl.firstChild) state.statusEl.removeChild(state.statusEl.firstChild);
  setIcon(state.statusEl, 'alert-circle');

  state.wrapperEl.classList.add('error');
  state.wrapperEl.classList.add('orphaned');

  renderAsyncContentLikeSync(doc, state.contentEl, state.info, 'orphaned');
}

export function renderStoredAsyncSubagent(
  doc: Document,
  parentEl: HTMLElement,
  subagent: SubagentInfo,
): HTMLElement {
  const wrapperEl = doc.createElement('div');
  wrapperEl.className = 'claudian-subagent-list';
  const displayStatus = getAsyncDisplayStatus(subagent.asyncStatus);
  setAsyncWrapperStatus(wrapperEl, displayStatus);

  if (displayStatus === 'completed') wrapperEl.classList.add('done');
  else if (displayStatus === 'error' || displayStatus === 'orphaned') wrapperEl.classList.add('error');
  wrapperEl.dataset.asyncSubagentId = subagent.id;
  parentEl.appendChild(wrapperEl);

  const statusText = getAsyncStatusText(subagent.asyncStatus);
  const statusAriaLabel = getAsyncStatusAriaLabel(subagent.asyncStatus);

  const headerEl = doc.createElement('div');
  headerEl.className = 'claudian-subagent-header';
  headerEl.setAttribute('tabindex', '0');
  headerEl.setAttribute('role', 'button');
  headerEl.setAttribute('aria-expanded', 'false');
  headerEl.setAttribute(
    'aria-label',
    `Background task: ${subagent.description} - ${statusAriaLabel} - click to expand`,
  );
  wrapperEl.appendChild(headerEl);

  const iconEl = doc.createElement('div');
  iconEl.className = 'claudian-subagent-icon';
  iconEl.setAttribute('aria-hidden', 'true');
  setIcon(iconEl, getToolIcon(TOOL_TASK));
  headerEl.appendChild(iconEl);

  const labelEl = doc.createElement('div');
  labelEl.className = 'claudian-subagent-label';
  labelEl.textContent = truncateDescription(subagent.description);
  headerEl.appendChild(labelEl);

  const statusTextEl = doc.createElement('div');
  statusTextEl.className = 'claudian-subagent-status-text';
  statusTextEl.textContent = statusText;
  headerEl.appendChild(statusTextEl);

  let statusIconClass: string;
  switch (displayStatus) {
    case 'error':
    case 'orphaned':
      statusIconClass = 'status-error';
      break;
    case 'completed':
      statusIconClass = 'status-completed';
      break;
    default:
      statusIconClass = 'status-running';
  }

  const statusEl = doc.createElement('div');
  statusEl.className = `claudian-subagent-status ${statusIconClass}`;
  statusEl.setAttribute('aria-label', `Status: ${statusAriaLabel}`);
  headerEl.appendChild(statusEl);

  switch (displayStatus) {
    case 'completed':
      setIcon(statusEl, 'check');
      break;
    case 'error':
      setIcon(statusEl, 'x');
      break;
    case 'orphaned':
      setIcon(statusEl, 'alert-circle');
      break;
  }

  const contentEl = doc.createElement('div');
  contentEl.className = 'claudian-subagent-content';
  wrapperEl.appendChild(contentEl);

  renderAsyncContentLikeSync(doc, contentEl, subagent, displayStatus);

  const state = { isExpanded: false };
  setupCollapsible(wrapperEl, headerEl, contentEl, state);

  return wrapperEl;
}
