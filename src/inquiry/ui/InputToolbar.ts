/**
 * InputToolbar -- Model selector, thinking/effort toggle, context meter,
 * external context selector, MCP server selector.
 *
 * Ported from Obsidian. Changes:
 * - `setIcon` from `../shared/icons` instead of `obsidian`
 * - Obsidian `createDiv`, `createSpan`, `createEl` -> `doc.createElement` + manual wiring
 * - `addClass`/`removeClass`/`toggleClass` -> `classList.*`
 * - `empty()` -> manual while(firstChild) removeChild
 * - `setText` -> `.textContent =`
 * - Settings reads/writes via SidecarClient instead of direct plugin settings
 * - ExternalContextSelector uses text input (no Electron dialog in Logseq iframe)
 * - McpServerSelector fetches server list from sidecar
 * - Removed `Notice` (no Obsidian Notice API)
 */

import type { SidecarClient } from '../SidecarClient';
import type { McpListResultMessage, ServerMessage, UsageInfo } from '../protocol';
import { setIcon } from '../shared/icons';

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
    this.buttonEl.setAttribute('role', 'button');
    this.buttonEl.setAttribute('aria-label', 'Select model');
    this.buttonEl.setAttribute('tabindex', '0');
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
    currentEl.setAttribute('role', 'button');
    currentEl.setAttribute('aria-label', `Effort level: ${currentInfo?.label || 'High'}`);
    currentEl.setAttribute('tabindex', '0');
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

// ── SVG Icons ──

const MCP_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>';

const CHECK_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';

// ── MCP Server Type ──

interface McpServerInfo {
  name: string;
  enabled: boolean;
  contextSaving: boolean;
  description?: string;
}

// ── ExternalContextSelector ──

export class ExternalContextSelector {
  private doc: Document;
  private container: HTMLElement;
  private iconEl: HTMLElement | null = null;
  private badgeEl: HTMLElement | null = null;
  private dropdownEl: HTMLElement | null = null;
  private externalContextPaths: string[] = [];
  private onChangeCallback: ((paths: string[]) => void) | null = null;

  constructor(doc: Document, parentEl: HTMLElement) {
    this.doc = doc;
    this.container = doc.createElement('div');
    this.container.className = 'claudian-external-context-selector';
    parentEl.appendChild(this.container);
    this.render();
  }

  setOnChange(callback: (paths: string[]) => void): void {
    this.onChangeCallback = callback;
  }

  getExternalContexts(): string[] {
    return [...this.externalContextPaths];
  }

  setExternalContexts(paths: string[]): void {
    this.externalContextPaths = [...paths];
    this.updateDisplay();
    this.renderDropdown();
  }

  clearExternalContexts(): void {
    this.externalContextPaths = [];
    this.updateDisplay();
    this.renderDropdown();
  }

  addExternalContext(pathInput: string): { success: boolean; error?: string } {
    const trimmed = pathInput?.trim();
    if (!trimmed) {
      return { success: false, error: 'No path provided' };
    }

    // Strip surrounding quotes
    let cleanPath = trimmed;
    if ((cleanPath.startsWith('"') && cleanPath.endsWith('"')) ||
        (cleanPath.startsWith("'") && cleanPath.endsWith("'"))) {
      cleanPath = cleanPath.slice(1, -1);
    }

    // Check duplicate
    if (this.externalContextPaths.includes(cleanPath)) {
      return { success: false, error: 'This path is already added' };
    }

    this.externalContextPaths = [...this.externalContextPaths, cleanPath];
    this.onChangeCallback?.(this.externalContextPaths);
    this.updateDisplay();
    this.renderDropdown();
    return { success: true };
  }

  private render(): void {
    this.empty(this.container);

    const iconWrapper = this.doc.createElement('div');
    iconWrapper.className = 'claudian-external-context-icon-wrapper';
    iconWrapper.setAttribute('role', 'button');
    iconWrapper.setAttribute('aria-label', 'External contexts');
    iconWrapper.setAttribute('tabindex', '0');
    this.container.appendChild(iconWrapper);

    this.iconEl = this.doc.createElement('div');
    this.iconEl.className = 'claudian-external-context-icon';
    setIcon(this.iconEl, 'folder');
    iconWrapper.appendChild(this.iconEl);

    this.badgeEl = this.doc.createElement('div');
    this.badgeEl.className = 'claudian-external-context-badge';
    iconWrapper.appendChild(this.badgeEl);

    this.updateDisplay();

    // Click to show text input for path entry
    iconWrapper.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showPathInput();
    });

    this.dropdownEl = this.doc.createElement('div');
    this.dropdownEl.className = 'claudian-external-context-dropdown';
    this.container.appendChild(this.dropdownEl);
    this.renderDropdown();
  }

  private showPathInput(): void {
    if (!this.dropdownEl) return;

    // Toggle dropdown visibility
    const isVisible = this.dropdownEl.style.display !== 'none';
    if (isVisible) {
      this.dropdownEl.style.display = 'none';
      return;
    }

    this.dropdownEl.style.display = '';
    this.renderDropdown();

    // Focus the input if present
    const input = this.dropdownEl.querySelector('.claudian-external-context-input') as HTMLInputElement;
    if (input) input.focus();
  }

  private renderDropdown(): void {
    if (!this.dropdownEl) return;
    this.empty(this.dropdownEl);

    // Header
    const headerEl = this.doc.createElement('div');
    headerEl.className = 'claudian-external-context-header';
    headerEl.textContent = 'External Contexts';
    this.dropdownEl.appendChild(headerEl);

    // Path input row
    const inputRow = this.doc.createElement('div');
    inputRow.className = 'claudian-external-context-input-row';
    inputRow.style.cssText = 'display: flex; gap: 4px; padding: 4px 8px;';

    const pathInput = this.doc.createElement('input');
    pathInput.type = 'text';
    pathInput.className = 'claudian-external-context-input';
    pathInput.placeholder = '/absolute/path/to/dir';
    pathInput.style.cssText = 'flex: 1; font-size: 12px; padding: 4px 6px; border: 1px solid var(--ls-border-color, #ddd); border-radius: 4px; background: var(--ls-secondary-background-color, #f5f5f5);';
    inputRow.appendChild(pathInput);

    const addBtn = this.doc.createElement('button');
    addBtn.textContent = 'Add';
    addBtn.style.cssText = 'font-size: 11px; padding: 4px 8px; cursor: pointer; border: 1px solid var(--ls-border-color, #ddd); border-radius: 4px; background: var(--ls-tertiary-background-color, #eee);';
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const result = this.addExternalContext(pathInput.value);
      if (result.success) {
        pathInput.value = '';
      }
    });
    inputRow.appendChild(addBtn);

    // Enter key submits
    pathInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const result = this.addExternalContext(pathInput.value);
        if (result.success) {
          pathInput.value = '';
        }
      }
      e.stopPropagation(); // Prevent input events from bubbling to chat input
    });

    this.dropdownEl.appendChild(inputRow);

    // Path list
    const listEl = this.doc.createElement('div');
    listEl.className = 'claudian-external-context-list';

    if (this.externalContextPaths.length === 0) {
      const emptyEl = this.doc.createElement('div');
      emptyEl.className = 'claudian-external-context-empty';
      emptyEl.textContent = 'Enter a path above to add';
      emptyEl.style.cssText = 'padding: 8px 12px; color: var(--ls-secondary-text-color, #999); font-size: 12px;';
      listEl.appendChild(emptyEl);
    } else {
      for (const pathStr of this.externalContextPaths) {
        const itemEl = this.doc.createElement('div');
        itemEl.className = 'claudian-external-context-item';
        itemEl.style.cssText = 'display: flex; align-items: center; gap: 6px; padding: 4px 8px;';

        const pathTextEl = this.doc.createElement('span');
        pathTextEl.className = 'claudian-external-context-text';
        pathTextEl.textContent = pathStr;
        pathTextEl.setAttribute('title', pathStr);
        pathTextEl.style.cssText = 'flex: 1; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
        itemEl.appendChild(pathTextEl);

        const removeBtn = this.doc.createElement('span');
        removeBtn.className = 'claudian-external-context-remove';
        removeBtn.style.cssText = 'cursor: pointer; opacity: 0.5; display: flex; width: 14px; height: 14px;';
        setIcon(removeBtn, 'x');
        removeBtn.setAttribute('title', 'Remove path');
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.removePath(pathStr);
        });
        itemEl.appendChild(removeBtn);

        listEl.appendChild(itemEl);
      }
    }

    this.dropdownEl.appendChild(listEl);
  }

  private removePath(pathStr: string): void {
    this.externalContextPaths = this.externalContextPaths.filter(p => p !== pathStr);
    this.onChangeCallback?.(this.externalContextPaths);
    this.updateDisplay();
    this.renderDropdown();
  }

  updateDisplay(): void {
    if (!this.iconEl || !this.badgeEl) return;

    const count = this.externalContextPaths.length;

    if (count > 0) {
      this.iconEl.classList.add('active');
      this.iconEl.setAttribute('title', `${count} external context${count > 1 ? 's' : ''}`);

      if (count > 1) {
        this.badgeEl.textContent = String(count);
        this.badgeEl.classList.add('visible');
      } else {
        this.badgeEl.classList.remove('visible');
      }
    } else {
      this.iconEl.classList.remove('active');
      this.iconEl.setAttribute('title', 'Add external contexts');
      this.badgeEl.classList.remove('visible');
    }
  }

  private empty(el: HTMLElement): void {
    while (el.firstChild) el.removeChild(el.firstChild);
  }
}

// ── McpServerSelector ──

export class McpServerSelector {
  private doc: Document;
  private client: SidecarClient;
  private container: HTMLElement;
  private iconEl: HTMLElement | null = null;
  private badgeEl: HTMLElement | null = null;
  private dropdownEl: HTMLElement | null = null;
  private servers: McpServerInfo[] = [];
  private enabledServers: Set<string> = new Set();
  private onChangeCallback: ((enabled: Set<string>) => void) | null = null;
  private unsubscribeMessage: (() => void) | null = null;

  constructor(doc: Document, parentEl: HTMLElement, client: SidecarClient) {
    this.doc = doc;
    this.client = client;
    this.container = doc.createElement('div');
    this.container.className = 'claudian-mcp-selector';
    parentEl.appendChild(this.container);
    this.render();

    // Subscribe to MCP list results from sidecar
    this.unsubscribeMessage = client.onMessage((msg: ServerMessage) => {
      if (msg.type === 'mcp.list_result') {
        const listMsg = msg as McpListResultMessage;
        this.servers = listMsg.servers.map(s => ({
          name: s.name,
          enabled: s.enabled,
          contextSaving: s.contextSaving,
          description: s.description,
        }));
        this.pruneEnabledServers();
        this.updateDisplay();
        this.renderDropdown();
      }
    });

    // Re-render on hover (CSS handles visibility)
    this.container.addEventListener('mouseenter', () => {
      this.renderDropdown();
    });
  }

  setOnChange(callback: (enabled: Set<string>) => void): void {
    this.onChangeCallback = callback;
  }

  getEnabledServers(): Set<string> {
    return new Set(this.enabledServers);
  }

  addMentionedServers(names: Set<string>): void {
    let changed = false;
    for (const name of names) {
      if (!this.enabledServers.has(name)) {
        this.enabledServers.add(name);
        changed = true;
      }
    }
    if (changed) {
      this.updateDisplay();
      this.renderDropdown();
    }
  }

  clearEnabled(): void {
    this.enabledServers.clear();
    this.updateDisplay();
    this.renderDropdown();
  }

  setEnabledServers(names: string[]): void {
    this.enabledServers = new Set(names);
    this.pruneEnabledServers();
    this.updateDisplay();
    this.renderDropdown();
  }

  /** Refresh server list from sidecar. */
  refreshServers(tabId: string): void {
    this.client.sendMcpList(tabId);
  }

  destroy(): void {
    if (this.unsubscribeMessage) {
      this.unsubscribeMessage();
      this.unsubscribeMessage = null;
    }
  }

  private pruneEnabledServers(): void {
    const activeNames = new Set(
      this.servers.filter(s => s.enabled).map(s => s.name)
    );
    let changed = false;
    for (const name of this.enabledServers) {
      if (!activeNames.has(name)) {
        this.enabledServers.delete(name);
        changed = true;
      }
    }
    if (changed) {
      this.onChangeCallback?.(this.enabledServers);
    }
  }

  private render(): void {
    this.empty(this.container);

    const iconWrapper = this.doc.createElement('div');
    iconWrapper.className = 'claudian-mcp-selector-icon-wrapper';
    iconWrapper.setAttribute('role', 'button');
    iconWrapper.setAttribute('aria-label', 'MCP servers');
    iconWrapper.setAttribute('tabindex', '0');
    this.container.appendChild(iconWrapper);

    this.iconEl = this.doc.createElement('div');
    this.iconEl.className = 'claudian-mcp-selector-icon';
    // Safe: MCP_ICON_SVG is a hardcoded trusted string, not user input
    setIcon(this.iconEl, 'globe');
    iconWrapper.appendChild(this.iconEl);

    this.badgeEl = this.doc.createElement('div');
    this.badgeEl.className = 'claudian-mcp-selector-badge';
    iconWrapper.appendChild(this.badgeEl);

    this.updateDisplay();

    this.dropdownEl = this.doc.createElement('div');
    this.dropdownEl.className = 'claudian-mcp-selector-dropdown';
    this.container.appendChild(this.dropdownEl);
    this.renderDropdown();
  }

  private renderDropdown(): void {
    if (!this.dropdownEl) return;
    this.pruneEnabledServers();
    this.empty(this.dropdownEl);

    // Header
    const headerEl = this.doc.createElement('div');
    headerEl.className = 'claudian-mcp-selector-header';
    headerEl.textContent = 'MCP Servers';
    this.dropdownEl.appendChild(headerEl);

    // Server list
    const listEl = this.doc.createElement('div');
    listEl.className = 'claudian-mcp-selector-list';
    this.dropdownEl.appendChild(listEl);

    const enabledServers = this.servers.filter(s => s.enabled);

    if (enabledServers.length === 0) {
      const emptyEl = this.doc.createElement('div');
      emptyEl.className = 'claudian-mcp-selector-empty';
      emptyEl.textContent = this.servers.length === 0
        ? 'No MCP servers configured'
        : 'All MCP servers disabled';
      emptyEl.style.cssText = 'padding: 8px 12px; color: var(--ls-secondary-text-color, #999); font-size: 12px;';
      listEl.appendChild(emptyEl);
      return;
    }

    for (const server of enabledServers) {
      this.renderServerItem(listEl, server);
    }
  }

  private renderServerItem(listEl: HTMLElement, server: McpServerInfo): void {
    const itemEl = this.doc.createElement('div');
    itemEl.className = 'claudian-mcp-selector-item';
    itemEl.dataset.serverName = server.name;
    itemEl.style.cssText = 'display: flex; align-items: center; gap: 6px; padding: 4px 8px; cursor: pointer;';

    const isEnabled = this.enabledServers.has(server.name);
    if (isEnabled) {
      itemEl.classList.add('enabled');
    }

    // Checkbox
    const checkEl = this.doc.createElement('div');
    checkEl.className = 'claudian-mcp-selector-check';
    checkEl.style.cssText = 'width: 14px; height: 14px; display: flex; align-items: center; justify-content: center;';
    if (isEnabled) {
      setIcon(checkEl, 'check');
    }
    itemEl.appendChild(checkEl);

    // Info
    const infoEl = this.doc.createElement('div');
    infoEl.className = 'claudian-mcp-selector-item-info';
    infoEl.style.cssText = 'flex: 1; display: flex; align-items: center; gap: 4px;';

    const nameEl = this.doc.createElement('span');
    nameEl.className = 'claudian-mcp-selector-item-name';
    nameEl.textContent = server.name;
    nameEl.style.cssText = 'font-size: 12px;';
    infoEl.appendChild(nameEl);

    // Context-saving badge
    if (server.contextSaving) {
      const csEl = this.doc.createElement('span');
      csEl.className = 'claudian-mcp-selector-cs-badge';
      csEl.textContent = '@';
      csEl.setAttribute('title', 'Context-saving: can also enable via @' + server.name);
      csEl.style.cssText = 'font-size: 10px; padding: 0 3px; border-radius: 2px; background: var(--ls-tertiary-background-color, #e0e0e0); color: var(--ls-secondary-text-color, #666);';
      infoEl.appendChild(csEl);
    }

    itemEl.appendChild(infoEl);

    // Click to toggle
    itemEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleServer(server.name, itemEl);
    });

    listEl.appendChild(itemEl);
  }

  private toggleServer(name: string, itemEl: HTMLElement): void {
    if (this.enabledServers.has(name)) {
      this.enabledServers.delete(name);
    } else {
      this.enabledServers.add(name);
    }

    // Update item visually in-place
    const isEnabled = this.enabledServers.has(name);
    const checkEl = itemEl.querySelector('.claudian-mcp-selector-check') as HTMLElement | null;

    if (isEnabled) {
      itemEl.classList.add('enabled');
      if (checkEl) setIcon(checkEl, 'check');
    } else {
      itemEl.classList.remove('enabled');
      if (checkEl) checkEl.textContent = '';
    }

    this.updateDisplay();
    this.onChangeCallback?.(this.enabledServers);
  }

  updateDisplay(): void {
    this.pruneEnabledServers();
    if (!this.iconEl || !this.badgeEl) return;

    const count = this.enabledServers.size;
    const hasServers = this.servers.length > 0;

    // Show/hide container based on whether there are servers
    if (!hasServers) {
      this.container.style.display = 'none';
      return;
    }
    this.container.style.display = '';

    if (count > 0) {
      this.iconEl.classList.add('active');
      this.iconEl.setAttribute('title', `${count} MCP server${count > 1 ? 's' : ''} enabled`);

      if (count > 1) {
        this.badgeEl.textContent = String(count);
        this.badgeEl.classList.add('visible');
      } else {
        this.badgeEl.classList.remove('visible');
      }
    } else {
      this.iconEl.classList.remove('active');
      this.iconEl.setAttribute('title', 'MCP servers (click to enable)');
      this.badgeEl.classList.remove('visible');
    }
  }

  private empty(el: HTMLElement): void {
    while (el.firstChild) el.removeChild(el.firstChild);
  }
}

// ── Factory ──

export function createInputToolbar(
  doc: Document,
  parentEl: HTMLElement,
  callbacks: ToolbarCallbacks,
  client?: SidecarClient,
): {
  modelSelector: ModelSelector;
  thinkingBudgetSelector: ThinkingBudgetSelector;
  contextUsageMeter: ContextUsageMeter;
  externalContextSelector: ExternalContextSelector;
  mcpServerSelector: McpServerSelector | null;
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

  const externalContextSelector = new ExternalContextSelector(doc, parentEl);

  const mcpServerSelector = client
    ? new McpServerSelector(doc, parentEl, client)
    : null;

  return { modelSelector, thinkingBudgetSelector, contextUsageMeter, externalContextSelector, mcpServerSelector };
}
