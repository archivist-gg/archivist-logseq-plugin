import { setIcon } from '../shared/icons';
import type { ToolCallInfo, TodoItem } from '../state/types';
import { setupCollapsible } from './collapsible';
import { renderTodoItems } from './TodoListRenderer';
import { renderDndEntityBlock, type CopyAndSaveCallback } from './DndEntityRenderer';
import { parseDndCodeFence } from './dndCodeFence';
import * as yaml from 'js-yaml';

import {
  TOOL_AGENT_OUTPUT,
  TOOL_ASK_USER_QUESTION,
  TOOL_BASH,
  TOOL_EDIT,
  TOOL_ENTER_PLAN_MODE,
  TOOL_EXIT_PLAN_MODE,
  TOOL_GLOB,
  TOOL_GREP,
  TOOL_LS,
  TOOL_READ,
  TOOL_SKILL,
  TOOL_SUBAGENT,
  TOOL_SUBAGENT_LEGACY,
  TOOL_TODO_WRITE,
  TOOL_TOOL_SEARCH,
  TOOL_WEB_FETCH,
  TOOL_WEB_SEARCH,
  TOOL_WRITE,
  isSubagentToolName,
  isWriteEditTool,
} from '../core/tools/toolNames';

import { getToolIcon } from '../core/tools/toolIcons';

// Re-export constants and predicates for other renderers
export { TOOL_AGENT_OUTPUT, TOOL_ASK_USER_QUESTION, TOOL_TODO_WRITE };
export { TOOL_SUBAGENT, TOOL_SUBAGENT_LEGACY };
export { isSubagentToolName, isWriteEditTool, getToolIcon };

// ── D&D entity tool detection ────────────────────────────

const DND_ENTITY_TOOLS = new Set([
  'mcp__archivist__generate_monster',
  'mcp__archivist__generate_spell',
  'mcp__archivist__generate_item',
]);

function getDndEntityType(toolName: string): string | null {
  if (toolName.includes('generate_monster')) return 'monster';
  if (toolName.includes('generate_spell')) return 'spell';
  if (toolName.includes('generate_item')) return 'item';
  return null;
}

/**
 * Detects if a tool name is a D&D generation tool and returns the entity type.
 * Exported for use by StreamController to create skeleton placeholders.
 */
export function getDndGenerationEntityType(toolName: string): string | null {
  return getDndEntityType(toolName);
}

/**
 * Renders a skeleton placeholder block for a D&D entity being generated.
 */
export function renderBlockSkeleton(
  doc: Document,
  parentEl: HTMLElement,
  entityType: string,
): { el: HTMLElement; updateFromPartial: (data: Record<string, unknown>) => void } {
  const wrapper = doc.createElement('div');
  wrapper.className = 'archivist-stat-block';
  parentEl.appendChild(wrapper);

  const skeleton = doc.createElement('div');
  skeleton.className = 'archivist-block-skeleton';
  wrapper.appendChild(skeleton);

  const typeLabel = entityType.charAt(0).toUpperCase() + entityType.slice(1);
  const headerEl = doc.createElement('div');
  headerEl.className = 'archivist-skeleton-header';
  headerEl.textContent = `Generating ${typeLabel}...`;
  skeleton.appendChild(headerEl);

  for (let i = 0; i < 3; i++) {
    const bar = doc.createElement('div');
    bar.className = i === 2 ? 'archivist-skeleton-bar archivist-skeleton-bar-short' : 'archivist-skeleton-bar';
    skeleton.appendChild(bar);
  }

  const updateFromPartial = (data: Record<string, unknown>) => {
    const existingPartial = skeleton.querySelector('.archivist-skeleton-partial') as HTMLElement | null;
    const partialEl = existingPartial || doc.createElement('div');
    if (!existingPartial) {
      partialEl.className = 'archivist-skeleton-partial';
      skeleton.querySelectorAll('.archivist-skeleton-bar').forEach(bar => bar.remove());
      skeleton.appendChild(partialEl);
    }
    while (partialEl.firstChild) partialEl.removeChild(partialEl.firstChild);

    if (data.name) {
      headerEl.textContent = String(data.name);
    }
    if (data.type || data.size) {
      const typeEl = doc.createElement('div');
      typeEl.className = 'archivist-skeleton-type';
      typeEl.textContent = [data.size, data.type].filter(Boolean).join(' ');
      partialEl.appendChild(typeEl);
    }
    if (data.ac) {
      const acEl = doc.createElement('div');
      acEl.className = 'archivist-skeleton-prop';
      acEl.textContent = `AC: ${typeof data.ac === 'object' ? JSON.stringify(data.ac) : data.ac}`;
      partialEl.appendChild(acEl);
    }
    if (data.hp) {
      const hpEl = doc.createElement('div');
      hpEl.className = 'archivist-skeleton-prop';
      hpEl.textContent = `HP: ${typeof data.hp === 'object' ? JSON.stringify(data.hp) : data.hp}`;
      partialEl.appendChild(hpEl);
    }
    if (data.abilities) {
      const abEl = doc.createElement('div');
      abEl.className = 'archivist-skeleton-prop';
      abEl.textContent = 'Abilities loaded...';
      partialEl.appendChild(abEl);
    }
    if (data.level !== undefined) {
      const lvEl = doc.createElement('div');
      lvEl.className = 'archivist-skeleton-prop';
      lvEl.textContent = `Level ${data.level} ${data.school || ''}`;
      partialEl.appendChild(lvEl);
    }
    if (data.rarity) {
      const rarEl = doc.createElement('div');
      rarEl.className = 'archivist-skeleton-prop';
      rarEl.textContent = `Rarity: ${data.rarity}`;
      partialEl.appendChild(rarEl);
    }
  };

  return { el: wrapper, updateFromPartial };
}

export function setToolIcon(el: HTMLElement, name: string): void {
  setIcon(el, getToolIcon(name));
}

export function getToolName(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case TOOL_TODO_WRITE: {
      const todos = input.todos as Array<{ status: string }> | undefined;
      if (todos && Array.isArray(todos) && todos.length > 0) {
        const completed = todos.filter(t => t.status === 'completed').length;
        return `Tasks ${completed}/${todos.length}`;
      }
      return 'Tasks';
    }
    case TOOL_ENTER_PLAN_MODE:
      return 'Entering plan mode';
    case TOOL_EXIT_PLAN_MODE:
      return 'Plan complete';
    default: {
      if (name.startsWith('mcp__archivist__')) {
        const cleanName = name.replace('mcp__archivist__', '');
        switch (cleanName) {
          case 'generate_monster': return 'Generating Monster';
          case 'generate_spell': return 'Generating Spell';
          case 'generate_item': return 'Generating Item';
          case 'generate_encounter': return 'Generating Encounter';
          case 'generate_npc': return 'Generating NPC';
          case 'search_srd': return 'Searching SRD';
          case 'get_srd_entity': return 'Loading SRD Entity';
          default: return cleanName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        }
      }
      return name;
    }
  }
}

export function getToolSummary(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case TOOL_READ:
    case TOOL_WRITE:
    case TOOL_EDIT: {
      const filePath = (input.file_path as string) || '';
      return fileNameOnly(filePath);
    }
    case TOOL_BASH: {
      const cmd = (input.command as string) || '';
      return truncateText(cmd, 60);
    }
    case TOOL_GLOB:
    case TOOL_GREP:
      return (input.pattern as string) || '';
    case TOOL_WEB_SEARCH:
      return truncateText((input.query as string) || '', 60);
    case TOOL_WEB_FETCH:
      return truncateText((input.url as string) || '', 60);
    case TOOL_LS:
      return fileNameOnly((input.path as string) || '.');
    case TOOL_SKILL:
      return (input.skill as string) || '';
    case TOOL_TOOL_SEARCH:
      return truncateText(parseToolSearchQuery(input.query as string | undefined), 60);
    case TOOL_TODO_WRITE:
      return '';
    default: {
      if (name.startsWith('mcp__archivist__')) {
        const monsterName = (input as any)?.monster?.name || (input as any)?.spell?.name || (input as any)?.item?.name || '';
        return monsterName;
      }
      return '';
    }
  }
}

/** Combined name+summary for ARIA labels. */
export function getToolLabel(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case TOOL_READ:
      return `Read: ${shortenPath(input.file_path as string) || 'file'}`;
    case TOOL_WRITE:
      return `Write: ${shortenPath(input.file_path as string) || 'file'}`;
    case TOOL_EDIT:
      return `Edit: ${shortenPath(input.file_path as string) || 'file'}`;
    case TOOL_BASH: {
      const cmd = (input.command as string) || 'command';
      return `Bash: ${cmd.length > 40 ? cmd.substring(0, 40) + '...' : cmd}`;
    }
    case TOOL_GLOB:
      return `Glob: ${input.pattern || 'files'}`;
    case TOOL_GREP:
      return `Grep: ${input.pattern || 'pattern'}`;
    case TOOL_WEB_SEARCH: {
      const query = (input.query as string) || 'search';
      return `WebSearch: ${query.length > 40 ? query.substring(0, 40) + '...' : query}`;
    }
    case TOOL_WEB_FETCH: {
      const url = (input.url as string) || 'url';
      return `WebFetch: ${url.length > 40 ? url.substring(0, 40) + '...' : url}`;
    }
    case TOOL_LS:
      return `LS: ${shortenPath(input.path as string) || '.'}`;
    case TOOL_TODO_WRITE: {
      const todos = input.todos as Array<{ status: string }> | undefined;
      if (todos && Array.isArray(todos)) {
        const completed = todos.filter(t => t.status === 'completed').length;
        return `Tasks (${completed}/${todos.length})`;
      }
      return 'Tasks';
    }
    case TOOL_SKILL: {
      const skillName = (input.skill as string) || 'skill';
      return `Skill: ${skillName}`;
    }
    case TOOL_TOOL_SEARCH: {
      const tools = parseToolSearchQuery(input.query as string | undefined);
      return `ToolSearch: ${tools || 'tools'}`;
    }
    case TOOL_ENTER_PLAN_MODE:
      return 'Entering plan mode';
    case TOOL_EXIT_PLAN_MODE:
      return 'Plan complete';
    default:
      return name;
  }
}

export function fileNameOnly(filePath: string): string {
  if (!filePath) return '';
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.split('/').pop() ?? normalized;
}

function shortenPath(filePath: string | undefined): string {
  if (!filePath) return '';
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (parts.length <= 3) return normalized;
  return '.../' + parts.slice(-2).join('/');
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

function parseToolSearchQuery(query: string | undefined): string {
  if (!query) return '';
  const selectPrefix = 'select:';
  const body = query.startsWith(selectPrefix) ? query.slice(selectPrefix.length) : query;
  return body.split(',').map(s => s.trim()).filter(Boolean).join(', ');
}

// ── Expanded content renderers ───────────────────────────

interface WebSearchLink {
  title: string;
  url: string;
}

function parseWebSearchResult(result: string): { links: WebSearchLink[]; summary: string } | null {
  const linksMatch = result.match(/Links:\s*(\[[\s\S]*?\])(?:\n|$)/);
  if (!linksMatch) return null;

  try {
    const parsed = JSON.parse(linksMatch[1]) as WebSearchLink[];
    if (!Array.isArray(parsed) || parsed.length === 0) return null;

    const linksEndIndex = result.indexOf(linksMatch[0]) + linksMatch[0].length;
    const summary = result.slice(linksEndIndex).trim();
    return { links: parsed.filter(l => l.title && l.url), summary };
  } catch {
    return null;
  }
}

function renderWebSearchExpanded(doc: Document, container: HTMLElement, result: string): void {
  const parsed = parseWebSearchResult(result);
  if (!parsed || parsed.links.length === 0) {
    renderLinesExpanded(doc, container, result, 20);
    return;
  }

  const linksEl = doc.createElement('div');
  linksEl.className = 'claudian-tool-lines';
  container.appendChild(linksEl);

  for (const link of parsed.links) {
    const linkEl = doc.createElement('a');
    linkEl.className = 'claudian-tool-link';
    linkEl.setAttribute('href', link.url);
    linkEl.setAttribute('target', '_blank');
    linkEl.setAttribute('rel', 'noopener noreferrer');
    linksEl.appendChild(linkEl);

    const iconEl = doc.createElement('span');
    iconEl.className = 'claudian-tool-link-icon';
    setIcon(iconEl, 'external-link');
    linkEl.appendChild(iconEl);

    const titleEl = doc.createElement('span');
    titleEl.className = 'claudian-tool-link-title';
    titleEl.textContent = link.title;
    linkEl.appendChild(titleEl);
  }

  if (parsed.summary) {
    const summaryEl = doc.createElement('div');
    summaryEl.className = 'claudian-tool-web-summary';
    summaryEl.textContent = parsed.summary.length > 800 ? parsed.summary.slice(0, 800) + '...' : parsed.summary;
    container.appendChild(summaryEl);
  }
}

function renderFileSearchExpanded(doc: Document, container: HTMLElement, result: string): void {
  const lines = result.split(/\r?\n/).filter(line => line.trim());
  if (lines.length === 0) {
    const emptyEl = doc.createElement('div');
    emptyEl.className = 'claudian-tool-empty';
    emptyEl.textContent = 'No matches found';
    container.appendChild(emptyEl);
    return;
  }
  renderLinesExpanded(doc, container, result, 15, true);
}

function renderLinesExpanded(
  doc: Document,
  container: HTMLElement,
  result: string,
  maxLines: number,
  hoverable = false
): void {
  const lines = result.split(/\r?\n/);
  const truncated = lines.length > maxLines;
  const displayLines = truncated ? lines.slice(0, maxLines) : lines;

  const linesEl = doc.createElement('div');
  linesEl.className = 'claudian-tool-lines';
  container.appendChild(linesEl);

  for (const line of displayLines) {
    const stripped = line.replace(/^\s*\d+→/, '');
    const lineEl = doc.createElement('div');
    lineEl.className = 'claudian-tool-line';
    if (hoverable) lineEl.classList.add('hoverable');
    lineEl.textContent = stripped || ' ';
    linesEl.appendChild(lineEl);
  }

  if (truncated) {
    const truncEl = doc.createElement('div');
    truncEl.className = 'claudian-tool-truncated';
    truncEl.textContent = `... ${lines.length - maxLines} more lines`;
    linesEl.appendChild(truncEl);
  }
}

function renderToolSearchExpanded(doc: Document, container: HTMLElement, result: string): void {
  let toolNames: string[] = [];
  try {
    const parsed = JSON.parse(result) as Array<{ type: string; tool_name: string }>;
    if (Array.isArray(parsed)) {
      toolNames = parsed
        .filter(item => item.type === 'tool_reference' && item.tool_name)
        .map(item => item.tool_name);
    }
  } catch {
    // Fall back to showing raw result
  }

  if (toolNames.length === 0) {
    renderLinesExpanded(doc, container, result, 20);
    return;
  }

  for (const name of toolNames) {
    const lineEl = doc.createElement('div');
    lineEl.className = 'claudian-tool-search-item';
    container.appendChild(lineEl);

    const iconEl = doc.createElement('span');
    iconEl.className = 'claudian-tool-search-icon';
    setToolIcon(iconEl, name);
    lineEl.appendChild(iconEl);

    const nameSpan = doc.createElement('span');
    nameSpan.textContent = name;
    lineEl.appendChild(nameSpan);
  }
}

function renderWebFetchExpanded(doc: Document, container: HTMLElement, result: string): void {
  const maxChars = 500;
  const linesEl = doc.createElement('div');
  linesEl.className = 'claudian-tool-lines';
  container.appendChild(linesEl);

  const lineEl = doc.createElement('div');
  lineEl.className = 'claudian-tool-line';
  lineEl.style.whiteSpace = 'pre-wrap';
  lineEl.style.wordBreak = 'break-word';
  linesEl.appendChild(lineEl);

  if (result.length > maxChars) {
    lineEl.textContent = result.slice(0, maxChars);
    const truncEl = doc.createElement('div');
    truncEl.className = 'claudian-tool-truncated';
    truncEl.textContent = `... ${result.length - maxChars} more characters`;
    linesEl.appendChild(truncEl);
  } else {
    lineEl.textContent = result;
  }
}

export function renderExpandedContent(
  doc: Document,
  container: HTMLElement,
  toolName: string,
  result: string | undefined,
  _dndCopyAndSaveCallback?: CopyAndSaveCallback
): void {
  if (!result) {
    const emptyEl = doc.createElement('div');
    emptyEl.className = 'claudian-tool-empty';
    emptyEl.textContent = 'No result';
    container.appendChild(emptyEl);
    return;
  }

  switch (toolName) {
    case TOOL_BASH:
      renderLinesExpanded(doc, container, result, 20);
      break;
    case TOOL_READ:
      renderLinesExpanded(doc, container, result, 15);
      break;
    case TOOL_GLOB:
    case TOOL_GREP:
    case TOOL_LS:
      renderFileSearchExpanded(doc, container, result);
      break;
    case TOOL_WEB_SEARCH:
      renderWebSearchExpanded(doc, container, result);
      break;
    case TOOL_WEB_FETCH:
      renderWebFetchExpanded(doc, container, result);
      break;
    case TOOL_TOOL_SEARCH:
      renderToolSearchExpanded(doc, container, result);
      break;
    default:
      renderLinesExpanded(doc, container, result, 20);
      break;
  }
}

// ── Todo helpers ─────────────────────────────────────────

function getTodos(input: Record<string, unknown>): TodoItem[] | undefined {
  const todos = input.todos;
  if (!todos || !Array.isArray(todos)) return undefined;
  return todos as TodoItem[];
}

function getCurrentTask(input: Record<string, unknown>): TodoItem | undefined {
  const todos = getTodos(input);
  if (!todos) return undefined;
  return todos.find(t => t.status === 'in_progress');
}

function areAllTodosCompleted(input: Record<string, unknown>): boolean {
  const todos = getTodos(input);
  if (!todos || todos.length === 0) return false;
  return todos.every(t => t.status === 'completed');
}

function resetStatusElement(statusEl: HTMLElement, statusClass: string, ariaLabel: string): void {
  statusEl.className = 'claudian-tool-status';
  while (statusEl.firstChild) statusEl.removeChild(statusEl.firstChild);
  statusEl.classList.add(statusClass);
  statusEl.setAttribute('aria-label', ariaLabel);
}

const STATUS_ICONS: Record<string, string> = {
  completed: 'check',
  error: 'x',
  blocked: 'shield-off',
};

function setTodoWriteStatus(statusEl: HTMLElement, input: Record<string, unknown>): void {
  const isComplete = areAllTodosCompleted(input);
  const status = isComplete ? 'completed' : 'running';
  const ariaLabel = isComplete ? 'Status: completed' : 'Status: in progress';
  resetStatusElement(statusEl, `status-${status}`, ariaLabel);
  if (isComplete) setIcon(statusEl, 'check');
}

function setToolStatus(statusEl: HTMLElement, status: ToolCallInfo['status']): void {
  resetStatusElement(statusEl, `status-${status}`, `Status: ${status}`);
  const icon = STATUS_ICONS[status];
  if (icon) setIcon(statusEl, icon);
}

export function renderTodoWriteResult(
  doc: Document,
  container: HTMLElement,
  input: Record<string, unknown>
): void {
  while (container.firstChild) container.removeChild(container.firstChild);
  container.classList.add('claudian-todo-panel-content');
  container.classList.add('claudian-todo-list-container');

  const todos = input.todos as TodoItem[] | undefined;
  if (!todos || !Array.isArray(todos)) {
    const item = doc.createElement('span');
    item.className = 'claudian-tool-result-item';
    item.textContent = 'Tasks updated';
    container.appendChild(item);
    return;
  }

  renderTodoItems(doc, container, todos);
}

export function isBlockedToolResult(content: string, isError?: boolean): boolean {
  const lower = content.toLowerCase();
  if (lower.includes('blocked by blocklist')) return true;
  if (lower.includes('outside the vault')) return true;
  if (lower.includes('access denied')) return true;
  if (lower.includes('user denied')) return true;
  if (lower.includes('approval')) return true;
  if (isError && lower.includes('deny')) return true;
  return false;
}

// ── Tool element structure ───────────────────────────────

interface ToolElementStructure {
  toolEl: HTMLElement;
  header: HTMLElement;
  iconEl: HTMLElement;
  nameEl: HTMLElement;
  summaryEl: HTMLElement;
  statusEl: HTMLElement;
  content: HTMLElement;
  currentTaskEl: HTMLElement | null;
}

function createToolElementStructure(
  doc: Document,
  parentEl: HTMLElement,
  toolCall: ToolCallInfo
): ToolElementStructure {
  const toolEl = doc.createElement('div');
  toolEl.className = 'claudian-tool-call';
  parentEl.appendChild(toolEl);

  const header = doc.createElement('div');
  header.className = 'claudian-tool-header';
  header.setAttribute('tabindex', '0');
  header.setAttribute('role', 'button');
  toolEl.appendChild(header);

  const iconEl = doc.createElement('span');
  iconEl.className = 'claudian-tool-icon';
  iconEl.setAttribute('aria-hidden', 'true');
  setToolIcon(iconEl, toolCall.name);
  header.appendChild(iconEl);

  const nameEl = doc.createElement('span');
  nameEl.className = 'claudian-tool-name';
  nameEl.textContent = getToolName(toolCall.name, toolCall.input);
  header.appendChild(nameEl);

  const summaryEl = doc.createElement('span');
  summaryEl.className = 'claudian-tool-summary';
  summaryEl.textContent = getToolSummary(toolCall.name, toolCall.input);
  header.appendChild(summaryEl);

  const currentTaskEl = toolCall.name === TOOL_TODO_WRITE
    ? createCurrentTaskPreview(doc, header, toolCall.input)
    : null;

  const statusEl = doc.createElement('span');
  statusEl.className = 'claudian-tool-status';
  header.appendChild(statusEl);

  const content = doc.createElement('div');
  content.className = 'claudian-tool-content';
  toolEl.appendChild(content);

  return { toolEl, header, iconEl, nameEl, summaryEl, statusEl, content, currentTaskEl };
}

function formatAnswer(raw: unknown): string {
  if (Array.isArray(raw)) return raw.join(', ');
  if (typeof raw === 'string') return raw;
  return '';
}

function renderAskUserQuestionResult(doc: Document, container: HTMLElement, toolCall: ToolCallInfo): boolean {
  while (container.firstChild) container.removeChild(container.firstChild);
  const questions = toolCall.input.questions as Array<{ question: string }> | undefined;
  const answers = toolCall.result ? tryParseAnswers(toolCall.result) : undefined;
  if (!questions || !Array.isArray(questions) || !answers) return false;

  const reviewEl = doc.createElement('div');
  reviewEl.className = 'claudian-ask-review';
  container.appendChild(reviewEl);

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const answer = formatAnswer(answers[q.question]);
    const pairEl = doc.createElement('div');
    pairEl.className = 'claudian-ask-review-pair';
    reviewEl.appendChild(pairEl);

    const numEl = doc.createElement('div');
    numEl.className = 'claudian-ask-review-num';
    numEl.textContent = `${i + 1}.`;
    pairEl.appendChild(numEl);

    const bodyEl = doc.createElement('div');
    bodyEl.className = 'claudian-ask-review-body';
    pairEl.appendChild(bodyEl);

    const qText = doc.createElement('div');
    qText.className = 'claudian-ask-review-q-text';
    qText.textContent = q.question;
    bodyEl.appendChild(qText);

    const aText = doc.createElement('div');
    aText.className = answer ? 'claudian-ask-review-a-text' : 'claudian-ask-review-empty';
    aText.textContent = answer || 'Not answered';
    bodyEl.appendChild(aText);
  }

  return true;
}

/** Try to parse answers from a tool result string. */
function tryParseAnswers(result: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(result);
    if (typeof parsed === 'object' && parsed !== null) return parsed;
  } catch { /* ignore */ }
  return undefined;
}

function renderAskUserQuestionFallback(doc: Document, container: HTMLElement, toolCall: ToolCallInfo, initialText?: string): void {
  contentFallback(doc, container, initialText || toolCall.result || 'Waiting for answer...');
}

function contentFallback(doc: Document, container: HTMLElement, text: string): void {
  const resultRow = doc.createElement('div');
  resultRow.className = 'claudian-tool-result-row';
  container.appendChild(resultRow);

  const resultText = doc.createElement('span');
  resultText.className = 'claudian-tool-result-text';
  resultText.textContent = text;
  resultRow.appendChild(resultText);
}

function createCurrentTaskPreview(
  doc: Document,
  header: HTMLElement,
  input: Record<string, unknown>
): HTMLElement {
  const currentTaskEl = doc.createElement('span');
  currentTaskEl.className = 'claudian-tool-current';
  header.appendChild(currentTaskEl);

  const currentTask = getCurrentTask(input);
  if (currentTask) {
    currentTaskEl.textContent = currentTask.activeForm;
  }
  return currentTaskEl;
}

function createTodoToggleHandler(
  currentTaskEl: HTMLElement | null,
  statusEl: HTMLElement | null,
  onExpandChange?: (expanded: boolean) => void
): (expanded: boolean) => void {
  return (expanded: boolean) => {
    if (onExpandChange) onExpandChange(expanded);
    if (currentTaskEl) {
      currentTaskEl.style.display = expanded ? 'none' : '';
    }
    if (statusEl) {
      statusEl.style.display = expanded ? 'none' : '';
    }
  };
}

function renderToolContent(
  doc: Document,
  content: HTMLElement,
  toolCall: ToolCallInfo,
  initialText?: string,
  dndCopyAndSaveCallback?: CopyAndSaveCallback
): void {
  if (toolCall.name === TOOL_TODO_WRITE) {
    content.classList.add('claudian-tool-content-todo');
    renderTodoWriteResult(doc, content, toolCall.input);
  } else if (toolCall.name === TOOL_ASK_USER_QUESTION) {
    content.classList.add('claudian-tool-content-ask');
    if (initialText) {
      renderAskUserQuestionFallback(doc, content, toolCall, 'Waiting for answer...');
    } else if (!renderAskUserQuestionResult(doc, content, toolCall)) {
      renderAskUserQuestionFallback(doc, content, toolCall);
    }
  } else if (initialText) {
    contentFallback(doc, content, initialText);
  } else {
    renderExpandedContent(doc, content, toolCall.name, toolCall.result, dndCopyAndSaveCallback);
  }
}

export function renderToolCall(
  doc: Document,
  parentEl: HTMLElement,
  toolCall: ToolCallInfo,
  toolCallElements: Map<string, HTMLElement>,
  dndCopyAndSaveCallback?: CopyAndSaveCallback
): HTMLElement {
  const { toolEl, header, statusEl, content, currentTaskEl } =
    createToolElementStructure(doc, parentEl, toolCall);

  toolEl.dataset.toolId = toolCall.id;
  toolCallElements.set(toolCall.id, toolEl);

  statusEl.classList.add(`status-${toolCall.status}`);
  statusEl.setAttribute('aria-label', `Status: ${toolCall.status}`);

  renderToolContent(doc, content, toolCall, 'Running...', dndCopyAndSaveCallback);

  const state = { isExpanded: false };
  toolCall.isExpanded = false;
  const todoStatusEl = toolCall.name === TOOL_TODO_WRITE ? statusEl : null;
  setupCollapsible(toolEl, header, content, state, {
    initiallyExpanded: false,
    onToggle: createTodoToggleHandler(currentTaskEl, todoStatusEl, (expanded) => {
      toolCall.isExpanded = expanded;
    }),
    baseAriaLabel: getToolLabel(toolCall.name, toolCall.input)
  });

  return toolEl;
}

export function updateToolCallResult(
  doc: Document,
  toolId: string,
  toolCall: ToolCallInfo,
  toolCallElements: Map<string, HTMLElement>,
  dndCopyAndSaveCallback?: CopyAndSaveCallback
) {
  const toolEl = toolCallElements.get(toolId);
  if (!toolEl) return;

  if (toolCall.name === TOOL_TODO_WRITE) {
    const statusEl = toolEl.querySelector('.claudian-tool-status') as HTMLElement;
    if (statusEl) {
      setTodoWriteStatus(statusEl, toolCall.input);
    }
    const content = toolEl.querySelector('.claudian-tool-content') as HTMLElement;
    if (content) {
      renderTodoWriteResult(doc, content, toolCall.input);
    }
    const nameEl = toolEl.querySelector('.claudian-tool-name') as HTMLElement;
    if (nameEl) {
      nameEl.textContent = getToolName(toolCall.name, toolCall.input);
    }
    const currentTaskEl = toolEl.querySelector('.claudian-tool-current') as HTMLElement;
    if (currentTaskEl) {
      const currentTask = getCurrentTask(toolCall.input);
      currentTaskEl.textContent = currentTask ? currentTask.activeForm : '';
    }
    return;
  }

  const statusEl = toolEl.querySelector('.claudian-tool-status') as HTMLElement;
  if (statusEl) {
    setToolStatus(statusEl, toolCall.status);
  }

  if (toolCall.name === TOOL_ASK_USER_QUESTION) {
    const content = toolEl.querySelector('.claudian-tool-content') as HTMLElement;
    if (content) {
      content.classList.add('claudian-tool-content-ask');
      if (!renderAskUserQuestionResult(doc, content, toolCall)) {
        renderAskUserQuestionFallback(doc, content, toolCall);
      }
    }
    return;
  }

  const content = toolEl.querySelector('.claudian-tool-content') as HTMLElement;
  if (content) {
    while (content.firstChild) content.removeChild(content.firstChild);
    renderExpandedContent(doc, content, toolCall.name, toolCall.result, dndCopyAndSaveCallback);
  }
}

/**
 * Renders a D&D entity stat block as a SIBLING element after the tool call block.
 * Returns true if it rendered, false otherwise.
 */
export function renderDndEntityAfterToolCall(
  doc: Document,
  parentEl: HTMLElement,
  toolCall: ToolCallInfo,
  dndCopyAndSaveCallback?: CopyAndSaveCallback,
): boolean {
  const entityType = getDndEntityType(toolCall.name);
  if (!entityType || !toolCall.result) return false;

  try {
    const parsed = JSON.parse(toolCall.result);
    if (parsed.data) {
      const yamlStr = yaml.dump(parsed.data);
      const fenceResult = parseDndCodeFence(entityType, yamlStr);
      if (fenceResult) {
        renderDndEntityBlock(doc, parentEl, fenceResult, dndCopyAndSaveCallback);
        return true;
      }
    }
  } catch { /* fall through */ }

  return false;
}

/** For stored (non-streaming) tool calls -- collapsed by default. */
export function renderStoredToolCall(
  doc: Document,
  parentEl: HTMLElement,
  toolCall: ToolCallInfo,
  dndCopyAndSaveCallback?: CopyAndSaveCallback
): HTMLElement {
  const { toolEl, header, statusEl, content, currentTaskEl } =
    createToolElementStructure(doc, parentEl, toolCall);

  if (toolCall.name === TOOL_TODO_WRITE) {
    setTodoWriteStatus(statusEl, toolCall.input);
  } else {
    setToolStatus(statusEl, toolCall.status);
  }

  renderToolContent(doc, content, toolCall, undefined, dndCopyAndSaveCallback);

  const state = { isExpanded: false };
  const todoStatusEl = toolCall.name === TOOL_TODO_WRITE ? statusEl : null;
  setupCollapsible(toolEl, header, content, state, {
    initiallyExpanded: false,
    onToggle: createTodoToggleHandler(currentTaskEl, todoStatusEl),
    baseAriaLabel: getToolLabel(toolCall.name, toolCall.input)
  });

  return toolEl;
}
