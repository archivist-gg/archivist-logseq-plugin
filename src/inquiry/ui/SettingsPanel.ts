/**
 * SettingsPanel -- Custom DOM settings panel (REWRITE).
 *
 * Replaces Obsidian's PluginSettingTab with a plain DOM panel.
 * Sections: model, thinking/effort, permissions, env vars, MCP, blocked commands, locale.
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

  constructor(doc: Document, client: SidecarClient, containerEl: HTMLElement) {
    this.doc = doc;
    this.client = client;
    this.containerEl = containerEl;
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
    this.client.sendSettingsGet();

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

    this.renderModelSection(content);
    this.renderEffortSection(content);
    this.renderPermissionsSection(content);
    this.renderEnvVarsSection(content);
    this.renderSystemPromptSection(content);
    this.renderLocaleSection(content);

    this.containerEl.appendChild(this.panelEl);
  }

  // ── Sections ──

  private renderModelSection(parent: HTMLElement): void {
    const section = this.createSection(parent, 'Model');

    const select = this.doc.createElement('select');
    select.className = 'claudian-settings-select';

    const models = [
      { value: 'claude-sonnet-4-20250514', label: 'Sonnet 4' },
      { value: 'claude-opus-4-20250514', label: 'Opus 4' },
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
      this.client.sendSettingsUpdate({ model: select.value });
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
        this.client.sendSettingsUpdate({ effortLevel: level.value });
      });

      label.appendChild(radio);
      const span = this.doc.createElement('span');
      span.textContent = level.label;
      label.appendChild(span);
      group.appendChild(label);
    }

    section.appendChild(group);
  }

  private renderPermissionsSection(parent: HTMLElement): void {
    const section = this.createSection(parent, 'Permissions');

    const modes = [
      { value: 'default', label: 'Default', desc: 'Ask before tool use' },
      { value: 'plan', label: 'Plan', desc: 'Plan changes before executing' },
      { value: 'yolo', label: 'Auto-approve', desc: 'Execute without asking' },
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
      this.client.sendSettingsUpdate({ permissionMode: select.value });
    });

    section.appendChild(select);
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
      this.client.sendSettingsUpdate({ environmentVariables: textarea.value });
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
    textarea.value = this.settings.customSystemPrompt ?? '';
    textarea.placeholder = 'You are an expert at...';

    textarea.addEventListener('change', () => {
      this.settings.customSystemPrompt = textarea.value;
      this.client.sendSettingsUpdate({ customSystemPrompt: textarea.value });
    });

    section.appendChild(textarea);
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
      this.client.sendSettingsUpdate({ locale: select.value });
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
}
