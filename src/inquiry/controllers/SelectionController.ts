/**
 * SelectionController — Polls DOM selection for context in queries.
 *
 * Ported from Obsidian's SelectionController.
 * Removes ALL CodeMirror 6 / EditorView references.
 * Uses `hostDoc.defaultView?.getSelection()` to capture selected text.
 * Polls every 250ms via setInterval.
 */

import type { StoredSelection } from '../state/types';

const SELECTION_POLL_INTERVAL = 250;
const INPUT_HANDOFF_GRACE_MS = 1500;

/** Context returned for queries. */
export interface EditorSelectionContext {
  selectedText: string;
  lineCount: number;
}

export class SelectionController {
  private hostDoc: Document;
  private indicatorEl: HTMLElement;
  private inputEl: HTMLElement;
  private focusScopeEl: HTMLElement;
  private contextRowEl: HTMLElement;
  private onVisibilityChange: (() => void) | null;
  private storedSelection: StoredSelection | null = null;
  private inputHandoffGraceUntil: number | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private readonly focusScopePointerDownHandler = () => {
    if (!this.storedSelection) return;
    this.inputHandoffGraceUntil = Date.now() + INPUT_HANDOFF_GRACE_MS;
  };

  constructor(
    hostDoc: Document,
    indicatorEl: HTMLElement,
    inputEl: HTMLElement,
    contextRowEl: HTMLElement,
    onVisibilityChange?: () => void,
    focusScopeEl?: HTMLElement
  ) {
    this.hostDoc = hostDoc;
    this.indicatorEl = indicatorEl;
    this.inputEl = inputEl;
    this.focusScopeEl = focusScopeEl ?? inputEl;
    this.contextRowEl = contextRowEl;
    this.onVisibilityChange = onVisibilityChange ?? null;
  }

  start(): void {
    if (this.pollInterval) return;
    this.inputEl.addEventListener('pointerdown', this.focusScopePointerDownHandler);
    if (this.focusScopeEl !== this.inputEl) {
      this.focusScopeEl.addEventListener('pointerdown', this.focusScopePointerDownHandler);
    }
    this.pollInterval = setInterval(() => this.poll(), SELECTION_POLL_INTERVAL);
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.inputEl.removeEventListener('pointerdown', this.focusScopePointerDownHandler);
    if (this.focusScopeEl !== this.inputEl) {
      this.focusScopeEl.removeEventListener('pointerdown', this.focusScopePointerDownHandler);
    }
    this.clear();
  }

  dispose(): void {
    this.stop();
  }

  // ============================================
  // Selection Polling
  // ============================================

  private poll(): void {
    const win = this.hostDoc.defaultView;
    if (!win) {
      this.clearIfStale();
      return;
    }

    const selection = win.getSelection();
    const selectedText = selection?.toString() ?? '';

    if (selectedText.trim()) {
      this.inputHandoffGraceUntil = null;

      const lineCount = selectedText.split(/\r?\n/).length;

      const unchanged =
        this.storedSelection &&
        this.storedSelection.selectedText === selectedText &&
        this.storedSelection.lineCount === lineCount;

      if (!unchanged) {
        this.storedSelection = {
          notePath: '',
          selectedText,
          lineCount,
        };
        this.updateIndicator();
      }
    } else {
      this.handleDeselection();
    }
  }

  private isFocusWithinChatSidebar(): boolean {
    const activeElement = this.hostDoc.activeElement as Node | null;
    return (
      activeElement !== null &&
      (activeElement === this.focusScopeEl || this.focusScopeEl.contains(activeElement))
    );
  }

  private clearIfStale(): void {
    if (!this.storedSelection) return;
    if (this.isFocusWithinChatSidebar()) {
      this.inputHandoffGraceUntil = null;
      return;
    }
    if (
      this.inputHandoffGraceUntil !== null &&
      Date.now() <= this.inputHandoffGraceUntil
    ) {
      return;
    }

    this.inputHandoffGraceUntil = null;
    this.storedSelection = null;
    this.updateIndicator();
  }

  private handleDeselection(): void {
    if (!this.storedSelection) return;
    if (this.isFocusWithinChatSidebar()) {
      this.inputHandoffGraceUntil = null;
      return;
    }

    if (
      this.inputHandoffGraceUntil !== null &&
      Date.now() <= this.inputHandoffGraceUntil
    ) {
      return;
    }

    this.inputHandoffGraceUntil = null;
    this.storedSelection = null;
    this.updateIndicator();
  }

  // ============================================
  // Indicator
  // ============================================

  private updateIndicator(): void {
    if (!this.indicatorEl) return;

    if (this.storedSelection) {
      const lineText = this.storedSelection.lineCount === 1 ? 'line' : 'lines';
      this.indicatorEl.textContent = `${this.storedSelection.lineCount} ${lineText} selected`;
      this.indicatorEl.style.display = 'block';
    } else {
      this.indicatorEl.style.display = 'none';
    }
    this.updateContextRowVisibility();
  }

  updateContextRowVisibility(): void {
    if (!this.contextRowEl) return;
    // Check if any child is visible (has display !== 'none')
    let hasVisibleChild = false;
    for (const child of Array.from(this.contextRowEl.children)) {
      if ((child as HTMLElement).style.display !== 'none') {
        hasVisibleChild = true;
        break;
      }
    }
    this.contextRowEl.style.display = hasVisibleChild ? '' : 'none';
    this.onVisibilityChange?.();
  }

  // ============================================
  // Context Access
  // ============================================

  getContext(): EditorSelectionContext | null {
    if (!this.storedSelection) return null;
    return {
      selectedText: this.storedSelection.selectedText,
      lineCount: this.storedSelection.lineCount,
    };
  }

  hasSelection(): boolean {
    return this.storedSelection !== null;
  }

  // ============================================
  // Clear
  // ============================================

  clear(): void {
    this.inputHandoffGraceUntil = null;
    this.storedSelection = null;
    this.updateIndicator();
  }
}
