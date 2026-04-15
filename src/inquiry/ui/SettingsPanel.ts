/**
 * SettingsPanel -- Custom DOM settings panel (REWRITE).
 *
 * Replaces Obsidian's PluginSettingTab with a plain DOM panel.
 * Sections: Customization, Safety, Environment, Advanced.
 * Reads/writes via `client.sendSettingsGet()` / `client.sendSettingsUpdate()`.
 *
 * All DOM construction is manual (doc.createElement) with no Obsidian deps.
 */

import type { SidecarClient } from '../SidecarClient';
import type { ServerMessage } from '../protocol';
import { setIcon } from '../shared/icons';

// ── Types ──

interface SettingsData {
  model?: string;
  effortLevel?: string;
  permissionMode?: string;
  environmentVariables?: string;
  blockedCommands?: string[];
  locale?: string;
  mcpServers?: Record<string, unknown>;
  enableOpus1M?: boolean;
  enableSonnet1M?: boolean;
  customSystemPrompt?: string;
  userName?: string;
  enableBlocklist?: boolean;
  allowExternalAccess?: boolean;
  enableBangBash?: boolean;
  enableAutoScroll?: boolean;
  maxTabs?: number;
  tabBarPosition?: string;
  hiddenSlashCommands?: string[];
  systemPrompt?: string;
  allowedExportPaths?: string[];
  excludedTags?: string[];
  mediaFolder?: string;
  persistentExternalContextPaths?: string[];
  envSnippets?: string[];
  customContextLimits?: Record<string, number>;
  keyboardNavigation?: {
    scrollUpKey?: string;
    scrollDownKey?: string;
    focusInputKey?: string;
  };
}

// ── SettingsPanel ──

export class SettingsPanel {
  private doc: Document;
  private client: SidecarClient;
  private containerEl: HTMLElement;
  private panelEl: HTMLElement | null = null;
  private settings: SettingsData = {};
  private isVisible = false;
  private unsubscribeMessage: (() => void) | null = null;
  private getActiveTabId: () => string;

  constructor(
    doc: Document,
    client: SidecarClient,
    containerEl: HTMLElement,
    getActiveTabId?: () => string
  ) {
    this.doc = doc;
    this.client = client;
    this.containerEl = containerEl;
    this.getActiveTabId = getActiveTabId ?? (() => 'default');
  }

  // ── Lifecycle ──

  show(): void {
    if (this.isVisible) return;
    this.isVisible = true;

    // Subscribe to settings responses
    this.unsubscribeMessage = this.client.onMessage((msg: ServerMessage) => {
      if (msg.type === 'settings.current') {
        const claudian = msg.claudian as Record<string, unknown>;
        if (claudian) {
          this.settings = { ...claudian } as SettingsData;
          this.render();
        }
      }
    });

    // Request current settings
    this.client.sendSettingsGet(this.getActiveTabId());

    // Build initial UI
    this.render();
  }

  hide(): void {
    if (!this.isVisible) return;
    this.isVisible = false;

    if (this.unsubscribeMessage) {
      this.unsubscribeMessage();
      this.unsubscribeMessage = null;
    }

    if (this.panelEl) {
      this.panelEl.remove();
      this.panelEl = null;
    }
  }

  toggle(): void {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  destroy(): void {
    this.hide();
  }

  // ── Send helper ──

  private sendUpdate(patch: Record<string, unknown>): void {
    this.client.sendSettingsUpdate(this.getActiveTabId(), patch);
  }

  // ── Render ──

  private render(): void {
    const doc = this.doc;

    if (this.panelEl) {
      this.panelEl.remove();
    }

    this.panelEl = doc.createElement('div');
    this.panelEl.className = 'claudian-settings-panel';

    // Header
    const header = doc.createElement('div');
    header.className = 'claudian-settings-header';
    this.panelEl.appendChild(header);

    const titleEl = doc.createElement('span');
    titleEl.className = 'claudian-settings-title';
    titleEl.textContent = 'Settings';
    header.appendChild(titleEl);

    const closeBtn = doc.createElement('button');
    closeBtn.className = 'claudian-settings-close';
    setIcon(closeBtn, 'x');
    closeBtn.addEventListener('click', () => this.hide());
    header.appendChild(closeBtn);

    // Sections
    const content = doc.createElement('div');
    content.className = 'claudian-settings-content';
    this.panelEl.appendChild(content);

    // -- Model & Effort --
    this.renderModelSection(content);
    this.renderEffortSection(content);

    // -- Customization --
    this.renderSectionHeading(content, 'Customization');
    this.renderUserNameSection(content);
    this.renderSystemPromptSection(content);
    this.renderLocaleSection(content);
    this.renderAutoScrollSection(content);
    this.renderExcludedTagsSection(content);
    this.renderMediaFolderSection(content);
    this.renderKeyboardNavigationSection(content);
    this.renderTabBarPositionSection(content);
    this.renderHiddenSlashCommandsSection(content);

    // -- Safety --
    this.renderSectionHeading(content, 'Safety');
    this.renderPermissionsSection(content);
    this.renderBlocklistSection(content);
    this.renderExternalAccessSection(content);
    this.renderExportPathsSection(content);

    // -- Environment --
    this.renderSectionHeading(content, 'Environment');
    this.renderEnvVarsSection(content);
    this.renderEnvSnippetsSection(content);
    this.renderPersistentContextSection(content);
    this.renderCustomContextLimitsSection(content);

    // -- Advanced --
    this.renderSectionHeading(content, 'Advanced');
    this.renderBangBashSection(content);
    this.renderOpus1MSection(content);
    this.renderSonnet1MSection(content);
    this.renderMaxTabsSection(content);

    this.containerEl.appendChild(this.panelEl);
  }

  // ── Section Heading ──

  private renderSectionHeading(parent: HTMLElement, title: string): void {
    const heading = this.doc.createElement('div');
    heading.className = 'claudian-settings-group-heading';
    heading.textContent = title;
    parent.appendChild(heading);
  }

  // ── Sections ──

  private renderModelSection(parent: HTMLElement): void {
    const section = this.createSection(parent, 'Model');

    const select = this.doc.createElement('select');
    select.className = 'claudian-settings-select';

    const models = [
      { value: 'haiku', label: 'Haiku' },
      { value: 'sonnet', label: 'Sonnet' },
      { value: 'opus', label: 'Opus' },
      { value: 'opus[1m]', label: 'Opus (1M)' },
    ];

    for (const model of models) {
      const option = this.doc.createElement('option');
      option.value = model.value;
      option.textContent = model.label;
      if (this.settings.model === model.value) {
        option.selected = true;
      }
      select.appendChild(option);
    }

    select.addEventListener('change', () => {
      this.settings.model = select.value;
      this.sendUpdate({ model: select.value });
    });

    section.appendChild(select);
  }

  private renderEffortSection(parent: HTMLElement): void {
    const section = this.createSection(parent, 'Thinking Effort');

    const levels = [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
    ];

    const group = this.doc.createElement('div');
    group.className = 'claudian-settings-radio-group';

    for (const level of levels) {
      const label = this.doc.createElement('label');
      label.className = 'claudian-settings-radio-label';

      const radio = this.doc.createElement('input');
      radio.type = 'radio';
      radio.name = 'effort-level';
      radio.value = level.value;
      radio.checked = this.settings.effortLevel === level.value;
      radio.addEventListener('change', () => {
        this.settings.effortLevel = level.value;
        this.sendUpdate({ effortLevel: level.value });
      });

      label.appendChild(radio);
      const span = this.doc.createElement('span');
      span.textContent = level.label;
      label.appendChild(span);
      group.appendChild(label);
    }

    section.appendChild(group);
  }

  private renderUserNameSection(parent: HTMLElement): void {
    const section = this.createSection(parent, 'User Name');

    const desc = this.doc.createElement('div');
    desc.className = 'claudian-settings-desc';
    desc.textContent = 'Display name used in conversations.';
    section.appendChild(desc);

    const input = this.doc.createElement('input');
    input.type = 'text';
    input.className = 'claudian-settings-input';
    input.value = this.settings.userName ?? '';
    input.placeholder = 'Your name';

    input.addEventListener('change', () => {
      this.settings.userName = input.value;
      this.sendUpdate({ userName: input.value });
    });

    section.appendChild(input);
  }

  private renderPermissionsSection(parent: HTMLElement): void {
    const section = this.createSection(parent, 'Permission Mode');

    const modes = [
      { value: 'unleashed', label: 'Unleashed', desc: 'Execute without asking' },
      { value: 'guarded', label: 'Guarded', desc: 'Ask before tool use' },
    ];

    const select = this.doc.createElement('select');
    select.className = 'claudian-settings-select';

    for (const mode of modes) {
      const option = this.doc.createElement('option');
      option.value = mode.value;
      option.textContent = `${mode.label} - ${mode.desc}`;
      if (this.settings.permissionMode === mode.value) {
        option.selected = true;
      }
      select.appendChild(option);
    }

    select.addEventListener('change', () => {
      this.settings.permissionMode = select.value;
      this.sendUpdate({ permissionMode: select.value });
    });

    section.appendChild(select);
  }

  private renderBlocklistSection(parent: HTMLElement): void {
    const section = this.createSection(parent, 'Enable Blocklist');

    const desc = this.doc.createElement('div');
    desc.className = 'claudian-settings-desc';
    desc.textContent = 'Block dangerous commands from being executed.';
    section.appendChild(desc);

    const toggle = this.createToggle(
      section,
      this.settings.enableBlocklist ?? true,
      (value) => {
        this.settings.enableBlocklist = value;
        this.sendUpdate({ enableBlocklist: value });
      }
    );
    section.appendChild(toggle);
  }

  private renderExternalAccessSection(parent: HTMLElement): void {
    const section = this.createSection(parent, 'Allow External Access');

    const desc = this.doc.createElement('div');
    desc.className = 'claudian-settings-desc';
    desc.textContent = 'Allow Claude to access files outside the vault.';
    section.appendChild(desc);

    const toggle = this.createToggle(
      section,
      this.settings.allowExternalAccess ?? false,
      (value) => {
        this.settings.allowExternalAccess = value;
        this.sendUpdate({ allowExternalAccess: value });
      }
    );
    section.appendChild(toggle);
  }

  private renderExportPathsSection(parent: HTMLElement): void {
    const section = this.createSection(parent, 'Allowed Export Paths');

    const desc = this.doc.createElement('div');
    desc.className = 'claudian-settings-desc';
    desc.textContent = 'Paths Claude can write to outside the vault. One per line.';
    section.appendChild(desc);

    const textarea = this.doc.createElement('textarea');
    textarea.className = 'claudian-settings-textarea';
    textarea.rows = 3;
    textarea.value = (this.settings.allowedExportPaths ?? []).join('\n');
    textarea.placeholder = '~/Desktop\n~/Downloads\n/tmp';

    textarea.addEventListener('change', () => {
      const paths = textarea.value
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      this.settings.allowedExportPaths = paths;
      this.sendUpdate({ allowedExportPaths: paths });
    });

    section.appendChild(textarea);
  }

  private renderEnvVarsSection(parent: HTMLElement): void {
    const section = this.createSection(parent, 'Environment Variables');

    const desc = this.doc.createElement('div');
    desc.className = 'claudian-settings-desc';
    desc.textContent = 'One per line: KEY=VALUE';
    section.appendChild(desc);

    const textarea = this.doc.createElement('textarea');
    textarea.className = 'claudian-settings-textarea';
    textarea.rows = 4;
    textarea.value = this.settings.environmentVariables ?? '';
    textarea.placeholder = 'ANTHROPIC_API_KEY=sk-ant-...\nCUSTOM_VAR=value';

    textarea.addEventListener('change', () => {
      this.settings.environmentVariables = textarea.value;
      this.sendUpdate({ environmentVariables: textarea.value });
    });

    section.appendChild(textarea);
  }

  private renderEnvSnippetsSection(parent: HTMLElement): void {
    const section = this.createSection(parent, 'Environment Snippets');

    const desc = this.doc.createElement('div');
    desc.className = 'claudian-settings-desc';
    desc.textContent = 'Reusable environment variable snippets. One snippet per line.';
    section.appendChild(desc);

    const textarea = this.doc.createElement('textarea');
    textarea.className = 'claudian-settings-textarea';
    textarea.rows = 3;
    textarea.value = (this.settings.envSnippets ?? []).join('\n');
    textarea.placeholder = 'SNIPPET_NAME=value';

    textarea.addEventListener('change', () => {
      const snippets = textarea.value
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      this.settings.envSnippets = snippets;
      this.sendUpdate({ envSnippets: snippets });
    });

    section.appendChild(textarea);
  }

  private renderPersistentContextSection(parent: HTMLElement): void {
    const section = this.createSection(parent, 'Persistent External Context');

    const desc = this.doc.createElement('div');
    desc.className = 'claudian-settings-desc';
    desc.textContent = 'External file paths always included in context. One per line.';
    section.appendChild(desc);

    const textarea = this.doc.createElement('textarea');
    textarea.className = 'claudian-settings-textarea';
    textarea.rows = 3;
    textarea.value = (this.settings.persistentExternalContextPaths ?? []).join('\n');
    textarea.placeholder = '/path/to/context.md';

    textarea.addEventListener('change', () => {
      const paths = textarea.value
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      this.settings.persistentExternalContextPaths = paths;
      this.sendUpdate({ persistentExternalContextPaths: paths });
    });

    section.appendChild(textarea);
  }

  private renderCustomContextLimitsSection(parent: HTMLElement): void {
    const section = this.createSection(parent, 'Custom Context Limits');

    const desc = this.doc.createElement('div');
    desc.className = 'claudian-settings-desc';
    desc.textContent = 'Override context window limits for custom models. One per line: model_id=200k';
    section.appendChild(desc);

    // Serialize limits as "model=value" lines
    const limits = this.settings.customContextLimits ?? {};
    const text = Object.entries(limits)
      .map(([key, val]) => `${key}=${val}`)
      .join('\n');

    const textarea = this.doc.createElement('textarea');
    textarea.className = 'claudian-settings-textarea';
    textarea.rows = 3;
    textarea.value = text;
    textarea.placeholder = 'custom-model-id=200000';

    textarea.addEventListener('change', () => {
      const parsed: Record<string, number> = {};
      for (const line of textarea.value.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx < 1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const valStr = trimmed.slice(eqIdx + 1).trim();
        // Support "200k" shorthand
        let val: number;
        if (valStr.toLowerCase().endsWith('k')) {
          val = parseInt(valStr.slice(0, -1), 10) * 1000;
        } else {
          val = parseInt(valStr, 10);
        }
        if (!isNaN(val) && key) {
          parsed[key] = val;
        }
      }
      this.settings.customContextLimits = parsed;
      this.sendUpdate({ customContextLimits: parsed });
    });

    section.appendChild(textarea);
  }

  private renderSystemPromptSection(parent: HTMLElement): void {
    const section = this.createSection(parent, 'Custom System Prompt');

    const desc = this.doc.createElement('div');
    desc.className = 'claudian-settings-desc';
    desc.textContent = 'Additional instructions appended to the system prompt.';
    section.appendChild(desc);

    const textarea = this.doc.createElement('textarea');
    textarea.className = 'claudian-settings-textarea';
    textarea.rows = 4;
    textarea.value = this.settings.customSystemPrompt ?? this.settings.systemPrompt ?? '';
    textarea.placeholder = 'You are an expert at...';

    textarea.addEventListener('change', () => {
      this.settings.customSystemPrompt = textarea.value;
      this.settings.systemPrompt = textarea.value;
      this.sendUpdate({ systemPrompt: textarea.value });
    });

    section.appendChild(textarea);
  }

  private renderAutoScrollSection(parent: HTMLElement): void {
    const section = this.createSection(parent, 'Auto-Scroll');

    const desc = this.doc.createElement('div');
    desc.className = 'claudian-settings-desc';
    desc.textContent = 'Automatically scroll to new messages during streaming.';
    section.appendChild(desc);

    const toggle = this.createToggle(
      section,
      this.settings.enableAutoScroll ?? true,
      (value) => {
        this.settings.enableAutoScroll = value;
        this.sendUpdate({ enableAutoScroll: value });
      }
    );
    section.appendChild(toggle);
  }

  private renderExcludedTagsSection(parent: HTMLElement): void {
    const section = this.createSection(parent, 'Excluded Tags');

    const desc = this.doc.createElement('div');
    desc.className = 'claudian-settings-desc';
    desc.textContent = 'Pages with these tags will be excluded from AI context. One per line.';
    section.appendChild(desc);

    const textarea = this.doc.createElement('textarea');
    textarea.className = 'claudian-settings-textarea';
    textarea.rows = 3;
    textarea.value = (this.settings.excludedTags ?? []).join('\n');
    textarea.placeholder = 'system\nprivate\ndraft';

    textarea.addEventListener('change', () => {
      const tags = textarea.value
        .split(/\r?\n/)
        .map((s) => s.trim().replace(/^#/, ''))
        .filter((s) => s.length > 0);
      this.settings.excludedTags = tags;
      this.sendUpdate({ excludedTags: tags });
    });

    section.appendChild(textarea);
  }

  private renderMediaFolderSection(parent: HTMLElement): void {
    const section = this.createSection(parent, 'Media Folder');

    const desc = this.doc.createElement('div');
    desc.className = 'claudian-settings-desc';
    desc.textContent = 'Folder path for media attachments.';
    section.appendChild(desc);

    const input = this.doc.createElement('input');
    input.type = 'text';
    input.className = 'claudian-settings-input';
    input.value = this.settings.mediaFolder ?? '';
    input.placeholder = 'attachments';

    input.addEventListener('change', () => {
      this.settings.mediaFolder = input.value.trim();
      this.sendUpdate({ mediaFolder: input.value.trim() });
    });

    section.appendChild(input);
  }

  private renderKeyboardNavigationSection(parent: HTMLElement): void {
    const section = this.createSection(parent, 'Keyboard Navigation');

    const desc = this.doc.createElement('div');
    desc.className = 'claudian-settings-desc';
    desc.textContent = 'Vim-style key mappings. One per line: map <key> <action>';
    section.appendChild(desc);

    const nav = this.settings.keyboardNavigation ?? {};
    const lines: string[] = [];
    if (nav.scrollUpKey) lines.push(`map ${nav.scrollUpKey} scrollUp`);
    if (nav.scrollDownKey) lines.push(`map ${nav.scrollDownKey} scrollDown`);
    if (nav.focusInputKey) lines.push(`map ${nav.focusInputKey} focusInput`);

    const textarea = this.doc.createElement('textarea');
    textarea.className = 'claudian-settings-textarea';
    textarea.rows = 3;
    textarea.value = lines.join('\n');
    textarea.placeholder = 'map w scrollUp\nmap s scrollDown\nmap i focusInput';

    textarea.addEventListener('change', () => {
      const parsed: Record<string, string> = {};
      for (const line of textarea.value.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const match = trimmed.match(/^map\s+(\S+)\s+(\S+)$/);
        if (match) {
          const [, key, action] = match;
          if (action === 'scrollUp') parsed.scrollUpKey = key;
          else if (action === 'scrollDown') parsed.scrollDownKey = key;
          else if (action === 'focusInput') parsed.focusInputKey = key;
        }
      }
      this.settings.keyboardNavigation = parsed as SettingsData['keyboardNavigation'];
      this.sendUpdate({ keyboardNavigation: parsed });
    });

    section.appendChild(textarea);
  }

  private renderTabBarPositionSection(parent: HTMLElement): void {
    const section = this.createSection(parent, 'Tab Bar Position');

    const positions = [
      { value: 'input', label: 'Above Input' },
      { value: 'header', label: 'Header' },
    ];

    const select = this.doc.createElement('select');
    select.className = 'claudian-settings-select';

    for (const pos of positions) {
      const option = this.doc.createElement('option');
      option.value = pos.value;
      option.textContent = pos.label;
      if ((this.settings.tabBarPosition ?? 'input') === pos.value) {
        option.selected = true;
      }
      select.appendChild(option);
    }

    select.addEventListener('change', () => {
      this.settings.tabBarPosition = select.value;
      this.sendUpdate({ tabBarPosition: select.value });
    });

    section.appendChild(select);
  }

  private renderHiddenSlashCommandsSection(parent: HTMLElement): void {
    const section = this.createSection(parent, 'Hidden Slash Commands');

    const desc = this.doc.createElement('div');
    desc.className = 'claudian-settings-desc';
    desc.textContent = 'Slash commands to hide from the autocomplete menu. One per line, without the leading /.';
    section.appendChild(desc);

    const textarea = this.doc.createElement('textarea');
    textarea.className = 'claudian-settings-textarea';
    textarea.rows = 3;
    textarea.value = (this.settings.hiddenSlashCommands ?? []).join('\n');
    textarea.placeholder = 'memory\nbug\nreview';

    textarea.addEventListener('change', () => {
      const commands = textarea.value
        .split(/\r?\n/)
        .map((s) => s.trim().replace(/^\//, ''))
        .filter((s) => s.length > 0);
      this.settings.hiddenSlashCommands = commands;
      this.sendUpdate({ hiddenSlashCommands: commands });
    });

    section.appendChild(textarea);
  }

  private renderBangBashSection(parent: HTMLElement): void {
    const section = this.createSection(parent, 'Bang-Bash Mode');

    const desc = this.doc.createElement('div');
    desc.className = 'claudian-settings-desc';
    desc.textContent = 'Enable ! prefix for direct bash command execution.';
    section.appendChild(desc);

    const toggle = this.createToggle(
      section,
      this.settings.enableBangBash ?? false,
      (value) => {
        this.settings.enableBangBash = value;
        this.sendUpdate({ enableBangBash: value });
      }
    );
    section.appendChild(toggle);
  }

  private renderOpus1MSection(parent: HTMLElement): void {
    const section = this.createSection(parent, 'Enable Opus 1M');

    const desc = this.doc.createElement('div');
    desc.className = 'claudian-settings-desc';
    desc.textContent = 'Show the Opus (1M context) model variant in the model selector.';
    section.appendChild(desc);

    const toggle = this.createToggle(
      section,
      this.settings.enableOpus1M ?? false,
      (value) => {
        this.settings.enableOpus1M = value;
        this.sendUpdate({ enableOpus1M: value });
      }
    );
    section.appendChild(toggle);
  }

  private renderSonnet1MSection(parent: HTMLElement): void {
    const section = this.createSection(parent, 'Enable Sonnet 1M');

    const desc = this.doc.createElement('div');
    desc.className = 'claudian-settings-desc';
    desc.textContent = 'Show the Sonnet (1M context) model variant in the model selector.';
    section.appendChild(desc);

    const toggle = this.createToggle(
      section,
      this.settings.enableSonnet1M ?? false,
      (value) => {
        this.settings.enableSonnet1M = value;
        this.sendUpdate({ enableSonnet1M: value });
      }
    );
    section.appendChild(toggle);
  }

  private renderMaxTabsSection(parent: HTMLElement): void {
    const section = this.createSection(parent, 'Max Tabs');

    const desc = this.doc.createElement('div');
    desc.className = 'claudian-settings-desc';
    desc.textContent = 'Maximum number of open conversation tabs (3-10).';
    section.appendChild(desc);

    const wrapper = this.doc.createElement('div');
    wrapper.className = 'claudian-settings-range-wrapper';

    const input = this.doc.createElement('input');
    input.type = 'range';
    input.className = 'claudian-settings-range';
    input.min = '3';
    input.max = '10';
    input.step = '1';
    input.value = String(this.settings.maxTabs ?? 3);

    const valueLabel = this.doc.createElement('span');
    valueLabel.className = 'claudian-settings-range-value';
    valueLabel.textContent = String(this.settings.maxTabs ?? 3);

    input.addEventListener('input', () => {
      valueLabel.textContent = input.value;
    });

    input.addEventListener('change', () => {
      const val = parseInt(input.value, 10);
      this.settings.maxTabs = val;
      this.sendUpdate({ maxTabs: val });
    });

    wrapper.appendChild(input);
    wrapper.appendChild(valueLabel);
    section.appendChild(wrapper);
  }

  private renderLocaleSection(parent: HTMLElement): void {
    const section = this.createSection(parent, 'Language');

    const locales = [
      { value: 'en', label: 'English' },
      { value: 'es', label: 'Spanish' },
      { value: 'fr', label: 'French' },
      { value: 'de', label: 'German' },
      { value: 'ja', label: 'Japanese' },
      { value: 'ko', label: 'Korean' },
      { value: 'zh', label: 'Chinese' },
    ];

    const select = this.doc.createElement('select');
    select.className = 'claudian-settings-select';

    for (const locale of locales) {
      const option = this.doc.createElement('option');
      option.value = locale.value;
      option.textContent = locale.label;
      if (this.settings.locale === locale.value) {
        option.selected = true;
      }
      select.appendChild(option);
    }

    select.addEventListener('change', () => {
      this.settings.locale = select.value;
      this.sendUpdate({ locale: select.value });
    });

    section.appendChild(select);
  }

  // ── Helpers ──

  private createSection(parent: HTMLElement, title: string): HTMLElement {
    const section = this.doc.createElement('div');
    section.className = 'claudian-settings-section';

    const heading = this.doc.createElement('div');
    heading.className = 'claudian-settings-section-heading';
    heading.textContent = title;
    section.appendChild(heading);

    parent.appendChild(section);
    return section;
  }

  private createToggle(
    _parent: HTMLElement,
    initialValue: boolean,
    onChange: (value: boolean) => void
  ): HTMLElement {
    const wrapper = this.doc.createElement('label');
    wrapper.className = 'claudian-settings-toggle';

    const checkbox = this.doc.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = initialValue;

    const slider = this.doc.createElement('span');
    slider.className = 'claudian-settings-toggle-slider';

    checkbox.addEventListener('change', () => {
      onChange(checkbox.checked);
    });

    wrapper.appendChild(checkbox);
    wrapper.appendChild(slider);
    return wrapper;
  }
}
