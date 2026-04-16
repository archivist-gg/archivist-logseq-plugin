/**
 * EntityAutocomplete -- [[ entity autocomplete dropdown.
 *
 * Uses the existing EntityRegistry from `../../entities/` to search
 * for matching entities. Pure DOM with keyboard navigation.
 */

import { EntityRegistry, type RegisteredEntity } from '../../entities/entity-registry';
import { setIcon } from './icons';

// ── Types ─────────────────────────────────────────────────

export interface EntityAutocompleteOptions {
  doc: Document;
  anchorEl: HTMLElement;
  registry: EntityRegistry;
  initialQuery?: string;
  onSelect: (entity: RegisteredEntity) => void;
  onDismiss: () => void;
}

// ── Constants ─────────────────────────────────────────────

const MAX_VISIBLE = 8;

const ENTITY_TYPE_ICONS: Record<string, string> = {
  monster: 'bot',
  spell: 'zap',
  item: 'wrench',
};

// ── Class ─────────────────────────────────────────────────

export class EntityAutocomplete {
  private doc: Document;
  private containerEl: HTMLElement;
  private listEl: HTMLElement;
  private allEntities: RegisteredEntity[] = [];
  private filteredEntities: RegisteredEntity[] = [];
  private selectedIndex = 0;
  private query = '';
  private options: EntityAutocompleteOptions;
  private destroyed = false;

  constructor(options: EntityAutocompleteOptions) {
    this.doc = options.doc;
    this.options = options;
    this.query = options.initialQuery ?? '';

    // ── Container ──
    this.containerEl = this.doc.createElement('div');
    this.containerEl.className = 'claudian-entity-dropdown';
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
      'max-width: 400px',
    ].join(';');

    // ── List ──
    this.listEl = this.doc.createElement('div');
    this.listEl.className = 'claudian-entity-list';
    this.listEl.setAttribute('role', 'listbox');
    this.containerEl.appendChild(this.listEl);

    // Position
    this.positionDropdown(options.anchorEl);

    // Append
    this.doc.body.appendChild(this.containerEl);

    // Load entities from registry
    this.loadEntities();

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

  private loadEntities(): void {
    this.allEntities = this.options.registry.getAll();
    this.filterAndRender();
  }

  private filterAndRender(): void {
    const query = this.query.toLowerCase();

    if (!query) {
      this.filteredEntities = this.allEntities.slice(0, MAX_VISIBLE);
    } else {
      this.filteredEntities = this.allEntities.filter((entity) =>
        entity.name.toLowerCase().includes(query) ||
        entity.slug.toLowerCase().includes(query),
      );
    }

    if (this.selectedIndex >= this.filteredEntities.length) {
      this.selectedIndex = Math.max(0, this.filteredEntities.length - 1);
    }

    this.renderList();
  }

  private renderList(): void {
    while (this.listEl.firstChild) {
      this.listEl.removeChild(this.listEl.firstChild);
    }

    if (this.filteredEntities.length === 0) {
      const emptyEl = this.doc.createElement('div');
      emptyEl.className = 'claudian-entity-empty';
      emptyEl.textContent = 'No entities found';
      emptyEl.style.cssText = 'padding: 8px 12px; color: var(--ls-secondary-text-color, #999); font-size: 12px;';
      this.listEl.appendChild(emptyEl);
      return;
    }

    const visible = this.filteredEntities.slice(0, MAX_VISIBLE);

    visible.forEach((entity, index) => {
      const itemEl = this.doc.createElement('div');
      itemEl.className = 'claudian-entity-item';
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
      const iconName = ENTITY_TYPE_ICONS[entity.entityType] ?? 'file-text';
      setIcon(iconEl, iconName);
      itemEl.appendChild(iconEl);

      // Name
      const nameEl = this.doc.createElement('span');
      nameEl.className = 'claudian-entity-name';
      nameEl.textContent = entity.name;
      nameEl.style.cssText = 'flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
      itemEl.appendChild(nameEl);

      // Type badge
      const typeEl = this.doc.createElement('span');
      typeEl.className = 'claudian-entity-type';
      typeEl.textContent = entity.entityType;
      typeEl.style.cssText = [
        'font-size: 10px',
        'padding: 1px 5px',
        'border-radius: 3px',
        'background: var(--ls-secondary-background-color, #f0f0f0)',
        'color: var(--ls-secondary-text-color, #999)',
        'text-transform: uppercase',
      ].join(';');
      itemEl.appendChild(typeEl);

      // Compendium hint
      if (entity.compendium && entity.compendium !== 'Homebrew') {
        const compEl = this.doc.createElement('span');
        compEl.className = 'claudian-entity-compendium';
        compEl.textContent = entity.compendium;
        compEl.style.cssText = 'font-size: 10px; color: var(--ls-secondary-text-color, #bbb);';
        itemEl.appendChild(compEl);
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
    const count = Math.min(this.filteredEntities.length, MAX_VISIBLE);
    if (count === 0) return;
    this.selectedIndex = (this.selectedIndex + delta + count) % count;
    this.updateSelection();
    this.scrollToSelected();
  }

  private updateSelection(): void {
    const items = this.listEl.querySelectorAll('.claudian-entity-item');
    items.forEach((el, i) => {
      const htmlEl = el as HTMLElement;
      htmlEl.setAttribute('aria-selected', String(i === this.selectedIndex));
      htmlEl.style.background = i === this.selectedIndex
        ? 'var(--ls-selection-background-color, #e8f0fe)'
        : '';
    });
  }

  private scrollToSelected(): void {
    const items = this.listEl.querySelectorAll('.claudian-entity-item');
    const selectedEl = items[this.selectedIndex] as HTMLElement | undefined;
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' });
    }
  }

  private selectCurrent(): void {
    const entity = this.filteredEntities[this.selectedIndex];
    if (entity) {
      this.options.onSelect(entity);
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
