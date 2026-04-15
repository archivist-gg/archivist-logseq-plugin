/**
 * EditorSelectionController -- Polls Logseq editor state for AI context.
 *
 * Tracks:
 * 1. The current page the user is viewing via `logseq.Editor.getCurrentPage()`
 * 2. The editing block content via `logseq.Editor.getEditingBlockContent()`
 *
 * Polls every 250ms. Provides context data for AI queries so the model
 * understands what the user is currently working on.
 *
 * This is separate from `SelectionController` (which tracks DOM text selection
 * inside the chat panel). EditorSelectionController tracks the Logseq editor
 * state outside the chat panel.
 */

const POLL_INTERVAL_MS = 250;

// ── Types ──

export interface EditorContext {
  /** Name of the currently viewed Logseq page, or null if none. */
  currentPage: string | null;
  /** Content of the block currently being edited, or null. */
  editingBlockContent: string | null;
}

export interface EditorSelectionCallbacks {
  /** Called when the current page changes. */
  onPageChanged?: (pageName: string | null) => void;
}

// ── Logseq API accessor ──

/**
 * Returns the Logseq Editor API, or null if unavailable.
 * Logseq plugins run in an iframe; the API is available via the
 * `logseq` global or `top?.logseq` depending on context.
 */
function getLogseqEditor(): any {
  try {
    const api = (typeof logseq !== 'undefined' ? logseq : null)
      ?? (globalThis as any).top?.logseq;
    return api?.Editor ?? null;
  } catch {
    return null;
  }
}

// ── Controller ──

export class EditorSelectionController {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private currentPage: string | null = null;
  private editingBlockContent: string | null = null;
  private callbacks: EditorSelectionCallbacks;
  private destroyed = false;

  constructor(callbacks?: EditorSelectionCallbacks) {
    this.callbacks = callbacks ?? {};
  }

  // ── Lifecycle ──

  start(): void {
    if (this.pollTimer || this.destroyed) return;
    this.pollTimer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
    // Run immediately on start
    void this.poll();
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  dispose(): void {
    this.stop();
    this.destroyed = true;
  }

  // ── Context Access ──

  /**
   * Returns the current editor context for use in AI queries.
   * Returns null if no meaningful context is available.
   */
  getContext(): EditorContext | null {
    if (!this.currentPage && !this.editingBlockContent) {
      return null;
    }
    return {
      currentPage: this.currentPage,
      editingBlockContent: this.editingBlockContent,
    };
  }

  /** Returns the current page name, or null. */
  getCurrentPage(): string | null {
    return this.currentPage;
  }

  /** Returns the editing block content, or null. */
  getEditingBlockContent(): string | null {
    return this.editingBlockContent;
  }

  // ── Polling ──

  private async poll(): Promise<void> {
    if (this.destroyed) return;

    const editor = getLogseqEditor();
    if (!editor) return;

    // Poll current page
    try {
      const page = await editor.getCurrentPage();
      const pageName: string | null = page?.originalName ?? page?.name ?? null;
      if (pageName !== this.currentPage) {
        const oldPage = this.currentPage;
        this.currentPage = pageName;
        if (oldPage !== pageName) {
          this.callbacks.onPageChanged?.(pageName);
        }
      }
    } catch {
      // getCurrentPage may fail if no page is focused
    }

    // Poll editing block content
    try {
      const content = await editor.getEditingBlockContent();
      this.editingBlockContent = typeof content === 'string' && content.trim()
        ? content
        : null;
    } catch {
      // getEditingBlockContent returns null/undefined when not editing
      this.editingBlockContent = null;
    }
  }
}
