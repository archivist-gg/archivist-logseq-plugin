/**
 * MentionDropdown -- @-mention dropdown for file mentions.
 *
 * Pure DOM dropdown. Fetches file list, filters as user types,
 * inserts selection. No Obsidian TFile/Vault dependencies.
 *
 * Item sources:
 * 1. Logseq pages — via `logseq.Editor.getAllPages()` (or `top?.logseq`)
 * 2. Agents / MCP servers — fetched from sidecar via `SidecarClient`
 * 3. Static items — provided by the caller via `getItems`
 */

import { setIcon } from './icons';

// ── Types ─────────────────────────────────────────────────

export type MentionItemType = 'page' | 'agent' | 'mcp' | 'file';

export interface MentionItem {
  path: string;
  name: string;
  /** Optional icon hint: 'file-text', 'folder', 'bot', 'globe', etc. */
  icon?: string;
  /** Item type for grouping / display. Defaults to 'file'. */
  type?: MentionItemType;
}

export interface MentionDropdownOptions {
  /** Document reference for DOM creation */
  doc: Document;
  /** Parent element to position the dropdown relative to */
  anchorEl: HTMLElement;
  /** Initial query string (text after @) */
  initialQuery?: string;
  /** Provide the list of mentionable items (pages, agents, MCP servers, files) */
  getItems: () => MentionItem[] | Promise<MentionItem[]>;
  /** Called when user selects an item */
  onSelect: (item: MentionItem) => void;
  /** Called when dropdown is dismissed without selection */
  onDismiss: () => void;
}

// ── Constants ─────────────────────────────────────────────

const MAX_VISIBLE = 8;
const MIN_QUERY_LENGTH = 0;

// ── Logseq page fetcher ──────────────────────────────────

/**
 * Fetches all Logseq pages as MentionItems.
 * Uses `top?.logseq?.Editor?.getAllPages()` which is the standard
 * Logseq plugin API access from the iframe sandbox.
 */
export async function fetchLogseqPages(): Promise<MentionItem[]> {
  try {
    // Access Logseq API — plugin iframe has access via `logseq` global
    // or `top?.logseq` depending on context
    const api = (typeof logseq !== 'undefined' ? logseq : null)
      ?? (globalThis as any).top?.logseq;
    if (!api?.Editor?.getAllPages) return [];

    const pages = await api.Editor.getAllPages();
    if (!Array.isArray(pages)) return [];

    return pages
      .filter((p: any) => p && p.name && !p['journal?'])
      .map((p: any) => ({
        path: p.originalName ?? p.name,
        name: p.originalName ?? p.name,
        icon: 'file-text',
        type: 'page' as MentionItemType,
      }));
  } catch {
    return [];
  }
}

// ── Class ─────────────────────────────────────────────────

export class MentionDropdown {
  private doc: Document;
  private containerEl: HTMLElement;
  private listEl: HTMLElement;
  private items: MentionItem[] = [];
  private filteredItems: MentionItem[] = [];
  private selectedIndex = 0;
  private query = '';
  private options: MentionDropdownOptions;
  private destroyed = false;

  constructor(options: MentionDropdownOptions) {
    this.doc = options.doc;
    this.options = options;
    this.query = options.initialQuery ?? '';

    // ── Container ──
    this.containerEl = this.doc.createElement('div');
    this.containerEl.className = 'claudian-mention-dropdown';
    this.containerEl.style.cssText = [
      'position: absolute',
      'z-index: 10000',
      'background: var(--ls-primary-background-color, #fff)',
      'border: 1px solid var(--ls-border-color, #e0e0e0)',
      'border-radius: 6px',
      'box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12)',
      'max-height: 280px',
      'overflow-y: auto',
      'min-width: 240px',
      'max-width: 400px',
    ].join(';');

    // ── List ──
    this.listEl = this.doc.createElement('div');
    this.listEl.className = 'claudian-mention-list';
    this.listEl.setAttribute('role', 'listbox');
    this.containerEl.appendChild(this.listEl);

    // Position relative to anchor
    this.positionDropdown(options.anchorEl);

    // Append to document
    this.doc.body.appendChild(this.containerEl);

    // Load items
    this.loadItems();

    // Global listeners
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

  private async loadItems(): Promise<void> {
    try {
      const result = this.options.getItems();
      this.items = result instanceof Promise ? await result : result;
    } catch {
      this.items = [];
    }
    this.filterAndRender();
  }

  private filterAndRender(): void {
    const query = this.query.toLowerCase();

    if (query.length < MIN_QUERY_LENGTH && this.items.length > MAX_VISIBLE * 2) {
      // Show most recent / alphabetically first items when query is empty
      this.filteredItems = this.items.slice(0, MAX_VISIBLE);
    } else {
      this.filteredItems = this.items.filter((item) => {
        const nameMatch = item.name.toLowerCase().includes(query);
        const pathMatch = item.path.toLowerCase().includes(query);
        return nameMatch || pathMatch;
      });
    }

    // Clamp selection
    if (this.selectedIndex >= this.filteredItems.length) {
      this.selectedIndex = Math.max(0, this.filteredItems.length - 1);
    }

    this.renderList();
  }

  private renderList(): void {
    // Clear
    while (this.listEl.firstChild) {
      this.listEl.removeChild(this.listEl.firstChild);
    }

    if (this.filteredItems.length === 0) {
      const emptyEl = this.doc.createElement('div');
      emptyEl.className = 'claudian-mention-empty';
      emptyEl.textContent = 'No matches';
      emptyEl.style.cssText = 'padding: 8px 12px; color: var(--ls-secondary-text-color, #999); font-size: 12px;';
      this.listEl.appendChild(emptyEl);
      return;
    }

    const visibleItems = this.filteredItems.slice(0, MAX_VISIBLE);

    visibleItems.forEach((item, index) => {
      const itemEl = this.doc.createElement('div');
      itemEl.className = 'claudian-mention-item';
      itemEl.setAttribute('role', 'option');
      itemEl.setAttribute('aria-selected', String(index === this.selectedIndex));
      itemEl.style.cssText = [
        'display: flex',
        'align-items: center',
        'gap: 8px',
        'padding: 6px 12px',
        'cursor: pointer',
        'font-size: 13px',
        index === this.selectedIndex
          ? 'background: var(--ls-selection-background-color, #e8f0fe)'
          : '',
      ].filter(Boolean).join(';');

      // Icon
      const iconEl = this.doc.createElement('span');
      iconEl.style.cssText = 'display: flex; flex-shrink: 0; width: 16px; height: 16px; opacity: 0.6;';
      setIcon(iconEl, item.icon ?? 'file-text');
      itemEl.appendChild(iconEl);

      // Name
      const nameEl = this.doc.createElement('span');
      nameEl.className = 'claudian-mention-name';
      nameEl.textContent = item.name;
      nameEl.style.cssText = 'flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
      itemEl.appendChild(nameEl);

      // Type badge (for agents and MCP servers)
      const itemType = item.type ?? 'file';
      if (itemType === 'agent' || itemType === 'mcp') {
        const badgeEl = this.doc.createElement('span');
        badgeEl.className = 'claudian-mention-badge';
        badgeEl.textContent = itemType === 'agent' ? 'agent' : 'mcp';
        badgeEl.style.cssText = 'font-size: 10px; padding: 1px 4px; border-radius: 3px; background: var(--ls-tertiary-background-color, #e0e0e0); color: var(--ls-secondary-text-color, #666); flex-shrink: 0;';
        itemEl.appendChild(badgeEl);
      }

      // Path hint (if different from name)
      if (item.path !== item.name) {
        const pathEl = this.doc.createElement('span');
        pathEl.className = 'claudian-mention-path';
        pathEl.textContent = item.path;
        pathEl.style.cssText = 'font-size: 11px; color: var(--ls-secondary-text-color, #999); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 160px;';
        itemEl.appendChild(pathEl);
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
    const count = Math.min(this.filteredItems.length, MAX_VISIBLE);
    if (count === 0) return;
    this.selectedIndex = (this.selectedIndex + delta + count) % count;
    this.updateSelection();
    this.scrollToSelected();
  }

  private updateSelection(): void {
    const items = this.listEl.querySelectorAll('.claudian-mention-item');
    items.forEach((el, i) => {
      const htmlEl = el as HTMLElement;
      htmlEl.setAttribute('aria-selected', String(i === this.selectedIndex));
      htmlEl.style.background = i === this.selectedIndex
        ? 'var(--ls-selection-background-color, #e8f0fe)'
        : '';
    });
  }

  private scrollToSelected(): void {
    const items = this.listEl.querySelectorAll('.claudian-mention-item');
    const selectedEl = items[this.selectedIndex] as HTMLElement | undefined;
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' });
    }
  }

  private selectCurrent(): void {
    const item = this.filteredItems[this.selectedIndex];
    if (item) {
      this.options.onSelect(item);
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
