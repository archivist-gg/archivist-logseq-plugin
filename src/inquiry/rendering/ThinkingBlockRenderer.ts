import { collapseElement, setupCollapsible } from './collapsible';

export type RenderContentFn = (el: HTMLElement, markdown: string) => Promise<void>;

export interface ThinkingBlockState {
  wrapperEl: HTMLElement;
  contentEl: HTMLElement;
  labelEl: HTMLElement;
  content: string;
  startTime: number;
  timerInterval: ReturnType<typeof setInterval> | null;
  isExpanded: boolean;
}

export function createThinkingBlock(
  doc: Document,
  parentEl: HTMLElement,
  renderContent: RenderContentFn
): ThinkingBlockState {
  const wrapperEl = doc.createElement('div');
  wrapperEl.className = 'claudian-thinking-block';
  parentEl.appendChild(wrapperEl);

  // Header (clickable to expand/collapse)
  const header = doc.createElement('div');
  header.className = 'claudian-thinking-header';
  header.setAttribute('tabindex', '0');
  header.setAttribute('role', 'button');
  header.setAttribute('aria-expanded', 'false');
  header.setAttribute('aria-label', 'Extended thinking - click to expand');
  wrapperEl.appendChild(header);

  // Label with timer
  const labelEl = doc.createElement('span');
  labelEl.className = 'claudian-thinking-label';
  const startTime = Date.now();
  labelEl.textContent = 'Thinking 0s...';
  header.appendChild(labelEl);

  // Start timer interval to update label every second
  const timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    labelEl.textContent = `Thinking ${elapsed}s...`;
  }, 1000);

  // Collapsible content (collapsed by default)
  const contentEl = doc.createElement('div');
  contentEl.className = 'claudian-thinking-content';
  wrapperEl.appendChild(contentEl);

  // Create state object first so toggle can reference it
  const state: ThinkingBlockState = {
    wrapperEl,
    contentEl,
    labelEl,
    content: '',
    startTime,
    timerInterval,
    isExpanded: false,
  };

  // Setup collapsible behavior (handles click, keyboard, ARIA, CSS)
  setupCollapsible(wrapperEl, header, contentEl, state);

  return state;
}

export async function appendThinkingContent(
  state: ThinkingBlockState,
  content: string,
  renderContent: RenderContentFn
) {
  state.content += content;
  await renderContent(state.contentEl, state.content);
}

export function finalizeThinkingBlock(state: ThinkingBlockState): number {
  // Stop the timer
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }

  // Calculate final duration
  const durationSeconds = Math.floor((Date.now() - state.startTime) / 1000);

  // Update label to show final duration (without "...")
  state.labelEl.textContent = `Thought for ${durationSeconds}s`;

  // Collapse when done and sync state
  const header = state.wrapperEl.querySelector('.claudian-thinking-header');
  if (header) {
    collapseElement(state.wrapperEl, header as HTMLElement, state.contentEl, state);
  }

  return durationSeconds;
}

export function cleanupThinkingBlock(state: ThinkingBlockState | null) {
  if (state?.timerInterval) {
    clearInterval(state.timerInterval);
  }
}

export function renderStoredThinkingBlock(
  doc: Document,
  parentEl: HTMLElement,
  content: string,
  durationSeconds: number | undefined,
  renderContent: RenderContentFn
): HTMLElement {
  const wrapperEl = doc.createElement('div');
  wrapperEl.className = 'claudian-thinking-block';
  parentEl.appendChild(wrapperEl);

  // Header (clickable to expand/collapse)
  const header = doc.createElement('div');
  header.className = 'claudian-thinking-header';
  header.setAttribute('tabindex', '0');
  header.setAttribute('role', 'button');
  header.setAttribute('aria-label', 'Extended thinking - click to expand');
  wrapperEl.appendChild(header);

  // Label with duration
  const labelEl = doc.createElement('span');
  labelEl.className = 'claudian-thinking-label';
  const labelText = durationSeconds !== undefined ? `Thought for ${durationSeconds}s` : 'Thought';
  labelEl.textContent = labelText;
  header.appendChild(labelEl);

  // Collapsible content
  const contentEl = doc.createElement('div');
  contentEl.className = 'claudian-thinking-content';
  wrapperEl.appendChild(contentEl);
  renderContent(contentEl, content);

  // Setup collapsible behavior (handles click, keyboard, ARIA, CSS)
  const state = { isExpanded: false };
  setupCollapsible(wrapperEl, header, contentEl, state);

  return wrapperEl;
}
