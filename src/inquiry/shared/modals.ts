/**
 * Overlay modal utility -- replaces Obsidian's Modal class.
 *
 * Creates a DOM overlay covering the inquiry panel with a centered
 * modal container. Pure DOM, no framework dependencies.
 */

import { setIcon } from './icons';

export interface ModalOptions {
  title: string;
  content: (containerEl: HTMLElement) => void;
  onClose?: () => void;
}

export interface ModalHandle {
  close: () => void;
}

/**
 * Show an overlay modal within the given document.
 *
 * Creates an overlay div covering the panel, a modal container with
 * a title bar and close button, and calls `content()` to populate the body.
 * Returns a close handle.
 */
export function showModal(doc: Document, options: ModalOptions): ModalHandle {
  const { title, content, onClose } = options;

  // ── Overlay ──
  const overlayEl = doc.createElement('div');
  overlayEl.className = 'claudian-modal-overlay';
  overlayEl.style.cssText = [
    'position: fixed',
    'inset: 0',
    'z-index: 9999',
    'display: flex',
    'align-items: center',
    'justify-content: center',
    'background: rgba(0, 0, 0, 0.5)',
  ].join(';');

  // Close on overlay click (but not modal body)
  overlayEl.addEventListener('click', (e: Event) => {
    if (e.target === overlayEl) {
      close();
    }
  });

  // ── Modal container ──
  const modalEl = doc.createElement('div');
  modalEl.className = 'claudian-modal';
  modalEl.style.cssText = [
    'background: var(--ls-primary-background-color, #fff)',
    'border-radius: 8px',
    'box-shadow: 0 8px 32px rgba(0, 0, 0, 0.24)',
    'min-width: 320px',
    'max-width: 560px',
    'max-height: 80vh',
    'display: flex',
    'flex-direction: column',
    'overflow: hidden',
  ].join(';');
  overlayEl.appendChild(modalEl);

  // ── Title bar ──
  const titleBarEl = doc.createElement('div');
  titleBarEl.className = 'claudian-modal-title-bar';
  titleBarEl.style.cssText = [
    'display: flex',
    'align-items: center',
    'justify-content: space-between',
    'padding: 12px 16px',
    'border-bottom: 1px solid var(--ls-border-color, #e0e0e0)',
  ].join(';');
  modalEl.appendChild(titleBarEl);

  const titleEl = doc.createElement('div');
  titleEl.className = 'claudian-modal-title';
  titleEl.textContent = title;
  titleEl.style.cssText = 'font-weight: 600; font-size: 14px;';
  titleBarEl.appendChild(titleEl);

  const closeBtnEl = doc.createElement('button');
  closeBtnEl.className = 'claudian-modal-close';
  closeBtnEl.style.cssText = [
    'background: none',
    'border: none',
    'cursor: pointer',
    'padding: 4px',
    'display: flex',
    'align-items: center',
    'color: var(--ls-secondary-text-color, #666)',
  ].join(';');
  setIcon(closeBtnEl, 'x');
  closeBtnEl.addEventListener('click', () => close());
  titleBarEl.appendChild(closeBtnEl);

  // ── Body ──
  const bodyEl = doc.createElement('div');
  bodyEl.className = 'claudian-modal-body';
  bodyEl.style.cssText = 'padding: 16px; overflow-y: auto;';
  modalEl.appendChild(bodyEl);

  // Populate body
  content(bodyEl);

  // ── Keyboard ──
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  doc.addEventListener('keydown', onKeyDown, true);

  // ── Append to DOM ──
  doc.body.appendChild(overlayEl);

  // ── Close handle ──
  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    doc.removeEventListener('keydown', onKeyDown, true);
    overlayEl.remove();
    onClose?.();
  }

  return { close };
}
