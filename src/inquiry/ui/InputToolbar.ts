/**
 * InputToolbar -- Model selector, thinking/effort toggle, context meter.
 *
 * Ported from Obsidian. Changes:
 * - `setIcon` from `../shared/icons` instead of `obsidian`
 * - Obsidian `createDiv`, `createSpan`, `createEl` -> `doc.createElement` + manual wiring
 * - `addClass`/`removeClass`/`toggleClass` -> `classList.*`
 * - `empty()` -> manual while(firstChild) removeChild
 * - `setText` -> `.textContent =`
 * - Settings reads/writes via SidecarClient instead of direct plugin settings
 * - Removed ExternalContextSelector (handled by sidecar)
 * - Removed McpServerSelector (handled by sidecar)
 * - Removed electron remote dialog (not in Logseq iframe)
 * - Removed `Notice` (no Obsidian Notice API)
 */

import type { UsageInfo } from '../protocol';

// ── Model / Effort types (inlined, no core/types dep) ──

export type ClaudeModel = string;
export type EffortLevel = 'low' | 'medium' | 'high';

export interface ModelOption {
  value: ClaudeModel;
  label: string;
  description?: string;
}

export interface EffortOption {
  value: EffortLevel;
  label: string;
}

const DEFAULT_MODELS: ModelOption[] = [
  { value: 'haiku', label: 'Haiku', description: 'Fast and efficient' },
  { value: 'sonnet', label: 'Sonnet', description: 'Balanced performance' },
  { value: 'opus', label: 'Opus', description: 'Most capable' },
  { value: 'opus[1m]', label: 'Opus (1M)', description: 'Most capable (1M context)' },
];

const EFFORT_LEVELS: EffortOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Med' },
  { value: 'high', label: 'High' },
];

function isAdaptiveThinkingModel(model: string): boolean {
  const shortNames = ['haiku', 'sonnet', 'sonnet[1m]', 'opus', 'opus[1m]'];
  return shortNames.includes(model) || /claude-(haiku|sonnet|opus)-/.test(model);
}

// ── Toolbar Settings / Callbacks ──

export interface ToolbarSettings {
  model: ClaudeModel;
  effortLevel: EffortLevel;
}

export interface ToolbarCallbacks {
  onModelChange: (model: ClaudeModel) => Promise<void>;
  onEffortLevelChange: (effort: EffortLevel) => Promise<void>;
  getSettings: () => ToolbarSettings;
}

// ── ModelSelector ──

export class ModelSelector {
  private doc: Document;
  private container: HTMLElement;
  private buttonEl: HTMLElement | null = null;
  private dropdownEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;
  private isReady = false;

  constructor(doc: Document, parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.doc = doc;
    this.callbacks = callbacks;
    this.container = doc.createElement('div');
    this.container.className = 'claudian-model-selector';
    parentEl.appendChild(this.container);
    this.render();
  }

  private getAvailableModels(): ModelOption[] {
    return [...DEFAULT_MODELS];
  }

  private render(): void {
    this.empty(this.container);

    this.buttonEl = this.doc.createElement('div');
    this.buttonEl.className = 'claudian-model-btn';
    this.container.appendChild(this.buttonEl);
    this.setReady(this.isReady);
    this.updateDisplay();

    this.dropdownEl = this.doc.createElement('div');
    this.dropdownEl.className = 'claudian-model-dropdown';
    this.container.appendChild(this.dropdownEl);
    this.renderOptions();
  }

  updateDisplay(): void {
    if (!this.buttonEl) return;
    const currentModel = this.callbacks.getSettings().model;
    const models = this.getAvailableModels();
    const modelInfo = models.find(m => m.value === currentModel);

    const displayModel = modelInfo || models[0];

    this.empty(this.buttonEl);

    const labelEl = this.doc.createElement('span');
    labelEl.className = 'claudian-model-label';
    labelEl.textContent = displayModel?.label || 'Unknown';
    this.buttonEl.appendChild(labelEl);
  }

  setReady(ready: boolean): void {
    this.isReady = ready;
    if (this.buttonEl) {
      this.buttonEl.classList.toggle('ready', ready);
    }
  }

  renderOptions(): void {
    if (!this.dropdownEl) return;
    this.empty(this.dropdownEl);

    const currentModel = this.callbacks.getSettings().model;
    const models = this.getAvailableModels();

    for (const model of [...models].reverse()) {
      const option = this.doc.createElement('div');
      option.className = 'claudian-model-option';
      if (model.value === currentModel) {
        option.classList.add('selected');
      }
      this.dropdownEl.appendChild(option);

      const labelSpan = this.doc.createElement('span');
      labelSpan.textContent = model.label;
      option.appendChild(labelSpan);
      if (model.description) {
        option.setAttribute('title', model.description);
      }

      option.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.callbacks.onModelChange(model.value);
        this.updateDisplay();
        this.renderOptions();
      });
    }
  }

  private empty(el: HTMLElement): void {
    while (el.firstChild) el.removeChild(el.firstChild);
  }
}

// ── ThinkingBudgetSelector (Effort Selector) ──

export class ThinkingBudgetSelector {
  private doc: Document;
  private container: HTMLElement;
  private effortEl: HTMLElement | null = null;
  private effortGearsEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;

  constructor(doc: Document, parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.doc = doc;
    this.callbacks = callbacks;
    this.container = doc.createElement('div');
    this.container.className = 'claudian-thinking-selector';
    parentEl.appendChild(this.container);
    this.render();
  }

  private render(): void {
    this.empty(this.container);

    // Effort selector (for adaptive thinking models)
    this.effortEl = this.doc.createElement('div');
    this.effortEl.className = 'claudian-thinking-effort';
    this.container.appendChild(this.effortEl);

    const effortLabel = this.doc.createElement('span');
    effortLabel.className = 'claudian-thinking-label-text';
    effortLabel.textContent = 'Effort:';
    this.effortEl.appendChild(effortLabel);

    this.effortGearsEl = this.doc.createElement('div');
    this.effortGearsEl.className = 'claudian-thinking-gears';
    this.effortEl.appendChild(this.effortGearsEl);

    this.updateDisplay();
  }

  private renderEffortGears(): void {
    if (!this.effortGearsEl) return;
    this.empty(this.effortGearsEl);

    const currentEffort = this.callbacks.getSettings().effortLevel;
    const currentInfo = EFFORT_LEVELS.find(e => e.value === currentEffort);

    const currentEl = this.doc.createElement('div');
    currentEl.className = 'claudian-thinking-current';
    currentEl.textContent = currentInfo?.label || 'High';
    this.effortGearsEl.appendChild(currentEl);

    const optionsEl = this.doc.createElement('div');
    optionsEl.className = 'claudian-thinking-options';
    this.effortGearsEl.appendChild(optionsEl);

    for (const effort of [...EFFORT_LEVELS].reverse()) {
      const gearEl = this.doc.createElement('div');
      gearEl.className = 'claudian-thinking-gear';
      gearEl.textContent = effort.label;
      optionsEl.appendChild(gearEl);

      if (effort.value === currentEffort) {
        gearEl.classList.add('selected');
      }

      gearEl.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.callbacks.onEffortLevelChange(effort.value);
        this.updateDisplay();
      });
    }
  }

  updateDisplay(): void {
    const model = this.callbacks.getSettings().model;
    const adaptive = isAdaptiveThinkingModel(model);

    if (this.effortEl) {
      this.effortEl.style.display = adaptive ? '' : 'none';
    }

    if (adaptive) {
      this.renderEffortGears();
    }
  }

  private empty(el: HTMLElement): void {
    while (el.firstChild) el.removeChild(el.firstChild);
  }
}

// ── ContextUsageMeter ──

export class ContextUsageMeter {
  private container: HTMLElement;
  private fillPath: SVGPathElement | null = null;
  private percentEl: HTMLElement | null = null;
  private circumference: number = 0;

  constructor(doc: Document, parentEl: HTMLElement) {
    this.container = doc.createElement('div');
    this.container.className = 'claudian-context-meter';
    parentEl.appendChild(this.container);
    this.render(doc);
    // Initially hidden
    this.container.style.display = 'none';
  }

  private render(doc: Document): void {
    const size = 16;
    const strokeWidth = 2;
    const radius = (size - strokeWidth) / 2;
    const cx = size / 2;
    const cy = size / 2;

    // 240 degree arc: from 150 to 390 (upper-left through bottom to upper-right)
    const startAngle = 150;
    const endAngle = 390;
    const arcDegrees = endAngle - startAngle;
    const arcRadians = (arcDegrees * Math.PI) / 180;
    this.circumference = radius * arcRadians;

    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;
    const x1 = cx + radius * Math.cos(startRad);
    const y1 = cy + radius * Math.sin(startRad);
    const x2 = cx + radius * Math.cos(endRad);
    const y2 = cy + radius * Math.sin(endRad);

    const gaugeEl = doc.createElement('div');
    gaugeEl.className = 'claudian-context-meter-gauge';
    this.container.appendChild(gaugeEl);

    // Build SVG via DOM API (no innerHTML)
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = doc.createElementNS(svgNS, 'svg') as SVGSVGElement;
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);

    const arcD = `M ${x1} ${y1} A ${radius} ${radius} 0 1 1 ${x2} ${y2}`;

    const bgPath = doc.createElementNS(svgNS, 'path');
    bgPath.setAttribute('class', 'claudian-meter-bg');
    bgPath.setAttribute('d', arcD);
    bgPath.setAttribute('fill', 'none');
    bgPath.setAttribute('stroke-width', String(strokeWidth));
    bgPath.setAttribute('stroke-linecap', 'round');
    svg.appendChild(bgPath);

    const fillPathEl = doc.createElementNS(svgNS, 'path');
    fillPathEl.setAttribute('class', 'claudian-meter-fill');
    fillPathEl.setAttribute('d', arcD);
    fillPathEl.setAttribute('fill', 'none');
    fillPathEl.setAttribute('stroke-width', String(strokeWidth));
    fillPathEl.setAttribute('stroke-linecap', 'round');
    fillPathEl.setAttribute('stroke-dasharray', String(this.circumference));
    fillPathEl.setAttribute('stroke-dashoffset', String(this.circumference));
    svg.appendChild(fillPathEl);

    gaugeEl.appendChild(svg);
    this.fillPath = fillPathEl;

    this.percentEl = doc.createElement('span');
    this.percentEl.className = 'claudian-context-meter-percent';
    this.container.appendChild(this.percentEl);
  }

  update(usage: UsageInfo | null): void {
    if (!usage || usage.contextTokens <= 0) {
      this.container.style.display = 'none';
      return;
    }
    this.container.style.display = 'flex';
    const fillLength = (usage.percentage / 100) * this.circumference;
    if (this.fillPath) {
      this.fillPath.style.strokeDashoffset = String(this.circumference - fillLength);
    }

    if (this.percentEl) {
      this.percentEl.textContent = `${usage.percentage}%`;
    }

    // Toggle warning class for > 80%
    if (usage.percentage > 80) {
      this.container.classList.add('warning');
    } else {
      this.container.classList.remove('warning');
    }

    // Set tooltip with detailed usage
    let tooltip = `${this.formatTokens(usage.contextTokens)} / ${this.formatTokens(usage.contextWindow)}`;
    if (usage.percentage > 80) {
      tooltip += ' (Approaching limit, run `/compact` to continue)';
    }
    this.container.setAttribute('data-tooltip', tooltip);
  }

  private formatTokens(tokens: number): string {
    if (tokens >= 1000) {
      return `${Math.round(tokens / 1000)}k`;
    }
    return String(tokens);
  }
}

// ── Factory ──

export function createInputToolbar(
  doc: Document,
  parentEl: HTMLElement,
  callbacks: ToolbarCallbacks
): {
  modelSelector: ModelSelector;
  thinkingBudgetSelector: ThinkingBudgetSelector;
  contextUsageMeter: ContextUsageMeter;
} {
  const modelSelector = new ModelSelector(doc, parentEl, callbacks);

  const sep1 = doc.createElement('div');
  sep1.className = 'archivist-toolbar-sep';
  parentEl.appendChild(sep1);

  const thinkingBudgetSelector = new ThinkingBudgetSelector(doc, parentEl, callbacks);

  const sep2 = doc.createElement('div');
  sep2.className = 'archivist-toolbar-sep';
  parentEl.appendChild(sep2);

  const contextUsageMeter = new ContextUsageMeter(doc, parentEl);

  return { modelSelector, thinkingBudgetSelector, contextUsageMeter };
}
