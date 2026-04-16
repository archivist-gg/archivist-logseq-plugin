// ──────────────────────────────────────────────────────────
// ToastRenderer — Lightweight toast notification system
// Renders auto-dismissing or persistent toast notifications
// using CSS classes defined in archivist-inquiry.css (lines 276-342).
// ──────────────────────────────────────────────────────────

export type ToastLevel = 'info' | 'warning' | 'error';

/** Auto-dismiss durations by level (ms). null = persistent (click to dismiss). */
const DISMISS_MS: Record<ToastLevel, number | null> = {
  info: 5000,
  warning: 8000,
  error: null,
};

export class ToastRenderer {
  private doc: Document;
  private containerEl: HTMLElement | null = null;

  constructor(doc: Document) {
    this.doc = doc;
  }

  /**
   * Show a toast notification.
   * - info: auto-dismiss after 5s
   * - warning: auto-dismiss after 8s
   * - error: persistent, click to dismiss
   */
  show(message: string, level: ToastLevel = 'info'): void {
    this.ensureContainer();

    const toast = this.doc.createElement('div');
    toast.className = `archivist-toast archivist-toast-${level}`;
    toast.textContent = message;

    // Dismiss handler (removes with exit animation)
    const dismiss = () => {
      toast.classList.add('archivist-toast-exit');
      toast.addEventListener('animationend', () => {
        toast.remove();
        this.cleanupContainer();
      }, { once: true });
    };

    // Click-to-dismiss for all levels
    toast.addEventListener('click', dismiss);
    toast.style.cursor = 'pointer';

    // Auto-dismiss for info/warning
    const duration = DISMISS_MS[level];
    if (duration !== null) {
      setTimeout(dismiss, duration);
    }

    this.containerEl!.appendChild(toast);
  }

  /** Remove the container from the DOM. */
  destroy(): void {
    this.containerEl?.remove();
    this.containerEl = null;
  }

  // ── Private ──────────────────────────────────────────────

  private ensureContainer(): void {
    if (this.containerEl && this.doc.contains(this.containerEl)) return;

    this.containerEl = this.doc.createElement('div');
    this.containerEl.className = 'archivist-toast-container';
    this.doc.body.appendChild(this.containerEl);
  }

  /** Remove container from DOM if it has no children. */
  private cleanupContainer(): void {
    if (this.containerEl && this.containerEl.childElementCount === 0) {
      this.containerEl.remove();
      this.containerEl = null;
    }
  }
}
