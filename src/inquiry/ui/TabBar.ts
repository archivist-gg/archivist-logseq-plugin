/**
 * TabBar -- Tab bar DOM for multi-tab chat sessions.
 *
 * Ported from Obsidian. Changes:
 * - Removed `WorkspaceLeaf` refs
 * - Tab state managed by plugin-side `ChatState` instances
 * - Drag/context menu are pure DOM (verbatim)
 * - `setIcon` from `../shared/icons` instead of `obsidian`
 * - All Obsidian DOM helpers replaced with standard DOM API
 */

import { setIcon } from '../shared/icons';

// ── Tab Data ──

export interface TabInfo {
  id: string;
  title: string;
  isActive: boolean;
  isDirty?: boolean;
}

// ── Callbacks ──

export interface TabBarCallbacks {
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onNewTab: () => void;
  onTabReorder?: (fromIndex: number, toIndex: number) => void;
}

// ── TabBar ──

export class TabBar {
  private doc: Document;
  private container: HTMLElement;
  private tabsEl: HTMLElement;
  private callbacks: TabBarCallbacks;
  private tabs: TabInfo[] = [];

  // Drag state
  private draggedTabId: string | null = null;
  private dragOverTabId: string | null = null;

  constructor(doc: Document, parentEl: HTMLElement, callbacks: TabBarCallbacks) {
    this.doc = doc;
    this.callbacks = callbacks;

    this.container = doc.createElement('div');
    this.container.className = 'claudian-tab-bar';
    parentEl.appendChild(this.container);

    this.tabsEl = doc.createElement('div');
    this.tabsEl.className = 'claudian-tab-bar-tabs';
    this.container.appendChild(this.tabsEl);

    // New tab button
    const newTabBtn = doc.createElement('button');
    newTabBtn.className = 'claudian-tab-bar-new';
    newTabBtn.setAttribute('title', 'New tab');
    setIcon(newTabBtn, 'plus');
    newTabBtn.addEventListener('click', () => callbacks.onNewTab());
    this.container.appendChild(newTabBtn);
  }

  /** Update the tab bar with new tab data. */
  update(tabs: TabInfo[]): void {
    this.tabs = tabs;
    this.render();
  }

  /** Set a single tab's title. */
  setTabTitle(tabId: string, title: string): void {
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab) {
      tab.title = title;
      const tabEl = this.tabsEl.querySelector(`[data-tab-id="${tabId}"]`) as HTMLElement | null;
      if (tabEl) {
        const titleEl = tabEl.querySelector('.claudian-tab-title') as HTMLElement | null;
        if (titleEl) {
          titleEl.textContent = title;
          titleEl.setAttribute('title', title);
        }
      }
    }
  }

  /** Get the container element. */
  getElement(): HTMLElement {
    return this.container;
  }

  // ── Render ──

  private render(): void {
    this.empty(this.tabsEl);

    // Hide tab bar if only one tab
    this.container.style.display = this.tabs.length <= 1 ? 'none' : '';

    for (const tab of this.tabs) {
      this.renderTab(tab);
    }
  }

  private renderTab(tab: TabInfo): void {
    const doc = this.doc;

    const tabEl = doc.createElement('div');
    tabEl.className = 'claudian-tab';
    tabEl.dataset.tabId = tab.id;
    if (tab.isActive) {
      tabEl.classList.add('claudian-tab--active');
    }
    if (tab.isDirty) {
      tabEl.classList.add('claudian-tab--dirty');
    }

    // Make draggable
    tabEl.setAttribute('draggable', 'true');

    // Title
    const titleEl = doc.createElement('span');
    titleEl.className = 'claudian-tab-title';
    titleEl.textContent = tab.title;
    titleEl.setAttribute('title', tab.title);
    tabEl.appendChild(titleEl);

    // Close button (show only if more than 1 tab)
    if (this.tabs.length > 1) {
      const closeBtn = doc.createElement('span');
      closeBtn.className = 'claudian-tab-close';
      setIcon(closeBtn, 'x');
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.callbacks.onTabClose(tab.id);
      });
      tabEl.appendChild(closeBtn);
    }

    // Click to select
    tabEl.addEventListener('click', () => {
      this.callbacks.onTabSelect(tab.id);
    });

    // Drag events
    tabEl.addEventListener('dragstart', (e) => {
      this.draggedTabId = tab.id;
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', tab.id);
      }
      tabEl.classList.add('claudian-tab--dragging');
    });

    tabEl.addEventListener('dragend', () => {
      this.draggedTabId = null;
      this.dragOverTabId = null;
      tabEl.classList.remove('claudian-tab--dragging');
      // Remove all drag-over classes
      const allTabs = this.tabsEl.querySelectorAll('.claudian-tab');
      allTabs.forEach(t => t.classList.remove('claudian-tab--drag-over'));
    });

    tabEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (this.draggedTabId && this.draggedTabId !== tab.id) {
        this.dragOverTabId = tab.id;
        tabEl.classList.add('claudian-tab--drag-over');
      }
    });

    tabEl.addEventListener('dragleave', () => {
      tabEl.classList.remove('claudian-tab--drag-over');
    });

    tabEl.addEventListener('drop', (e) => {
      e.preventDefault();
      tabEl.classList.remove('claudian-tab--drag-over');
      if (this.draggedTabId && this.draggedTabId !== tab.id && this.callbacks.onTabReorder) {
        const fromIndex = this.tabs.findIndex(t => t.id === this.draggedTabId);
        const toIndex = this.tabs.findIndex(t => t.id === tab.id);
        if (fromIndex >= 0 && toIndex >= 0) {
          this.callbacks.onTabReorder(fromIndex, toIndex);
        }
      }
    });

    // Context menu (right-click)
    tabEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showContextMenu(e, tab);
    });

    this.tabsEl.appendChild(tabEl);
  }

  private showContextMenu(e: MouseEvent, tab: TabInfo): void {
    const doc = this.doc;

    // Remove any existing context menu
    const existing = doc.querySelector('.claudian-tab-context-menu');
    if (existing) existing.remove();

    const menu = doc.createElement('div');
    menu.className = 'claudian-tab-context-menu';
    menu.style.position = 'fixed';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    menu.style.zIndex = '10000';

    const closeItem = doc.createElement('div');
    closeItem.className = 'claudian-tab-context-item';
    closeItem.textContent = 'Close tab';
    closeItem.addEventListener('click', () => {
      this.callbacks.onTabClose(tab.id);
      menu.remove();
    });
    menu.appendChild(closeItem);

    const closeOthersItem = doc.createElement('div');
    closeOthersItem.className = 'claudian-tab-context-item';
    closeOthersItem.textContent = 'Close other tabs';
    closeOthersItem.addEventListener('click', () => {
      for (const t of this.tabs) {
        if (t.id !== tab.id) {
          this.callbacks.onTabClose(t.id);
        }
      }
      menu.remove();
    });
    menu.appendChild(closeOthersItem);

    doc.body.appendChild(menu);

    // Close on any click outside
    const closeMenu = () => {
      menu.remove();
      doc.removeEventListener('click', closeMenu);
    };
    setTimeout(() => doc.addEventListener('click', closeMenu), 0);
  }

  destroy(): void {
    this.container.remove();
  }

  private empty(el: HTMLElement): void {
    while (el.firstChild) el.removeChild(el.firstChild);
  }
}
