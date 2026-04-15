/**
 * SlashCommandDropdown -- Slash command dropdown for the chat input.
 *
 * Fetches commands from the sidecar via `client.fetchCommands()`,
 * merges with built-in commands (which have highest priority),
 * shows a filtered list, and executes/inserts the selected command.
 * Pure DOM with keyboard navigation (arrow keys, enter, escape).
 */

import type { SidecarClient } from '../SidecarClient';
import { getBuiltInCommandsForDropdown } from '../controllers/InputController';
import { setIcon } from './icons';

// ── Types ─────────────────────────────────────────────────

export interface SlashCommand {
  name: string;
  description: string;
  /** True if this is a client-side built-in command. */
  isBuiltIn?: boolean;
}

export interface SlashCommandDropdownOptions {
  doc: Document;
  anchorEl: HTMLElement;
  client: SidecarClient;
  initialQuery?: string;
  onSelect: (command: SlashCommand) => void;
  onDismiss: () => void;
}

// ── Constants ─────────────────────────────────────────────

const MAX_VISIBLE = 8;

// ── Class ─────────────────────────────────────────────────

export class SlashCommandDropdown {
  private doc: Document;
  private containerEl: HTMLElement;
  private listEl: HTMLElement;
  private commands: SlashCommand[] = [];
  private filteredCommands: SlashCommand[] = [];
  private selectedIndex = 0;
  private query = '';
  private options: SlashCommandDropdownOptions;
  private destroyed = false;

  constructor(options: SlashCommandDropdownOptions) {
    this.doc = options.doc;
    this.options = options;
    this.query = options.initialQuery ?? '';

    // ── Container ──
    this.containerEl = this.doc.createElement('div');
    this.containerEl.className = 'claudian-slash-dropdown';
    this.containerEl.style.cssText = [
      'position: absolute',
      'z-index: 10000',
      'background: var(--ls-primary-background-color, #fff)',
      'border: 1px solid var(--ls-border-color, #e0e0e0)',
      'border-radius: 6px',
      'box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12)',
      'max-height: 280px',
      'overflow-y: auto',
      'min-width: 220px',
      'max-width: 360px',
    ].join(';');

    // ── List ──
    this.listEl = this.doc.createElement('div');
    this.listEl.className = 'claudian-slash-list';
    this.listEl.setAttribute('role', 'listbox');
    this.containerEl.appendChild(this.listEl);

    // Position
    this.positionDropdown(options.anchorEl);

    // Append
    this.doc.body.appendChild(this.containerEl);

    // Load commands (built-in + sidecar)
    this.loadCommands();

    // Global click handler
    this.doc.addEventListener('mousedown', this.handleOutsideClick, true);
  }

  // ── Public API ──────────────────────────────────────────

  updateQuery(query: string): void {
    if (this.destroyed) return;
    this.query = query;
    this.filterAndRender();
  }

  handleKeyDown(e: KeyboardEvent): boolean {
    if (this.destroyed) return false;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.moveSelection(1);
        return true;

      case 'ArrowUp':
        e.preventDefault();
        this.moveSelection(-1);
        return true;

      case 'Enter':
      case 'Tab':
        e.preventDefault();
        this.selectCurrent();
        return true;

      case 'Escape':
        e.preventDefault();
        this.dismiss();
        return true;

      default:
        return false;
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.doc.removeEventListener('mousedown', this.handleOutsideClick, true);
    this.containerEl.remove();
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  // ── Private ─────────────────────────────────────────────

  private async loadCommands(): Promise<void> {
    // Start with built-in commands (available immediately)
    const builtIn = getBuiltInCommandsForDropdown();
    const seenNames = new Set<string>();

    // Built-in commands have highest priority
    for (const cmd of builtIn) {
      seenNames.add(cmd.name.toLowerCase());
      this.commands.push(cmd);
    }

    // Fetch sidecar commands asynchronously
    try {
      const sidecarCommands = await this.options.client.fetchCommands();
      for (const cmd of sidecarCommands) {
        const nameLower = cmd.name.toLowerCase();
        if (!seenNames.has(nameLower)) {
          seenNames.add(nameLower);
          this.commands.push(cmd);
        }
      }
    } catch {
      // Sidecar commands unavailable — built-in commands still work
    }

    this.filterAndRender();
  }

  private filterAndRender(): void {
    const query = this.query.toLowerCase();

    if (!query) {
      this.filteredCommands = this.commands.slice(0, MAX_VISIBLE);
    } else {
      this.filteredCommands = this.commands.filter((cmd) =>
        cmd.name.toLowerCase().includes(query) ||
        cmd.description.toLowerCase().includes(query),
      );
    }

    if (this.selectedIndex >= this.filteredCommands.length) {
      this.selectedIndex = Math.max(0, this.filteredCommands.length - 1);
    }

    this.renderList();
  }

  private renderList(): void {
    while (this.listEl.firstChild) {
      this.listEl.removeChild(this.listEl.firstChild);
    }

    if (this.filteredCommands.length === 0) {
      const emptyEl = this.doc.createElement('div');
      emptyEl.className = 'claudian-slash-empty';
      emptyEl.textContent = 'No commands';
      emptyEl.style.cssText = 'padding: 8px 12px; color: var(--ls-secondary-text-color, #999); font-size: 12px;';
      this.listEl.appendChild(emptyEl);
      return;
    }

    const visible = this.filteredCommands.slice(0, MAX_VISIBLE);

    visible.forEach((cmd, index) => {
      const itemEl = this.doc.createElement('div');
      itemEl.className = 'claudian-slash-item';
      itemEl.setAttribute('role', 'option');
      itemEl.setAttribute('aria-selected', String(index === this.selectedIndex));
      itemEl.style.cssText = [
        'display: flex',
        'flex-direction: column',
        'gap: 2px',
        'padding: 6px 12px',
        'cursor: pointer',
        index === this.selectedIndex
          ? 'background: var(--ls-selection-background-color, #e8f0fe)'
          : '',
      ].filter(Boolean).join(';');

      // Command name row
      const nameRow = this.doc.createElement('div');
      nameRow.style.cssText = 'display: flex; align-items: center; gap: 6px;';
      itemEl.appendChild(nameRow);

      const slashEl = this.doc.createElement('span');
      slashEl.textContent = '/';
      slashEl.style.cssText = 'color: var(--ls-link-text-color, #4a86c8); font-weight: 600; font-size: 13px;';
      nameRow.appendChild(slashEl);

      const nameEl = this.doc.createElement('span');
      nameEl.textContent = cmd.name;
      nameEl.style.cssText = 'font-size: 13px; font-weight: 500;';
      nameRow.appendChild(nameEl);

      // Built-in badge
      if (cmd.isBuiltIn) {
        const badge = this.doc.createElement('span');
        badge.textContent = 'built-in';
        badge.style.cssText = 'font-size: 9px; color: var(--ls-secondary-text-color, #999); background: var(--ls-tertiary-background-color, #f0f0f0); padding: 1px 4px; border-radius: 3px; margin-left: 4px;';
        nameRow.appendChild(badge);
      }

      // Description
      if (cmd.description) {
        const descEl = this.doc.createElement('div');
        descEl.textContent = cmd.description;
        descEl.style.cssText = 'font-size: 11px; color: var(--ls-secondary-text-color, #999); padding-left: 18px;';
        itemEl.appendChild(descEl);
      }

      // Mouse events
      itemEl.addEventListener('mouseenter', () => {
        this.selectedIndex = index;
        this.updateSelection();
      });
      itemEl.addEventListener('mousedown', (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        this.selectedIndex = index;
        this.selectCurrent();
      });

      this.listEl.appendChild(itemEl);
    });
  }

  private moveSelection(delta: number): void {
    const count = Math.min(this.filteredCommands.length, MAX_VISIBLE);
    if (count === 0) return;
    this.selectedIndex = (this.selectedIndex + delta + count) % count;
    this.updateSelection();
    this.scrollToSelected();
  }

  private updateSelection(): void {
    const items = this.listEl.querySelectorAll('.claudian-slash-item');
    items.forEach((el, i) => {
      const htmlEl = el as HTMLElement;
      htmlEl.setAttribute('aria-selected', String(i === this.selectedIndex));
      htmlEl.style.background = i === this.selectedIndex
        ? 'var(--ls-selection-background-color, #e8f0fe)'
        : '';
    });
  }

  private scrollToSelected(): void {
    const items = this.listEl.querySelectorAll('.claudian-slash-item');
    const selectedEl = items[this.selectedIndex] as HTMLElement | undefined;
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' });
    }
  }

  private selectCurrent(): void {
    const cmd = this.filteredCommands[this.selectedIndex];
    if (cmd) {
      this.options.onSelect(cmd);
    }
    this.destroy();
  }

  private dismiss(): void {
    this.options.onDismiss();
    this.destroy();
  }

  private positionDropdown(anchorEl: HTMLElement): void {
    const rect = anchorEl.getBoundingClientRect();
    this.containerEl.style.left = `${rect.left}px`;
    this.containerEl.style.top = `${rect.bottom + 4}px`;
  }

  private handleOutsideClick = (e: Event): void => {
    if (!this.containerEl.contains(e.target as Node)) {
      this.dismiss();
    }
  };
}
