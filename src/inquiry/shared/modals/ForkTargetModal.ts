/**
 * Fork Target Modal — choose where to fork a conversation.
 *
 * Adapted from Obsidian's ForkTargetModal. Uses the Logseq-compatible
 * overlay modal system from `shared/modals.ts` instead of Obsidian's
 * built-in Modal class.
 */

import { showModal } from '../modals';

export type ForkTarget = 'new-tab' | 'current-tab';

/**
 * Show a modal asking the user whether to fork into the current tab
 * or a new tab. Returns the chosen target, or `null` if dismissed.
 */
export function chooseForkTarget(doc: Document): Promise<ForkTarget | null> {
  return new Promise(resolve => {
    let resolved = false;

    const handle = showModal(doc, {
      title: 'Fork conversation',
      content: (containerEl: HTMLElement) => {
        const list = doc.createElement('div');
        list.className = 'claudian-fork-target-list';
        list.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';
        containerEl.appendChild(list);

        createOption(doc, list, 'current-tab', 'Fork in current tab', () => {
          resolved = true;
          resolve('current-tab');
          handle.close();
        });

        createOption(doc, list, 'new-tab', 'Fork to new tab', () => {
          resolved = true;
          resolve('new-tab');
          handle.close();
        });
      },
      onClose: () => {
        if (!resolved) {
          resolve(null);
        }
      },
    });
  });
}

function createOption(
  doc: Document,
  container: HTMLElement,
  _target: ForkTarget,
  label: string,
  onClick: () => void,
): void {
  const item = doc.createElement('div');
  item.className = 'claudian-fork-target-option';
  item.textContent = label;
  item.style.cssText = [
    'padding: 10px 14px',
    'border-radius: 6px',
    'cursor: pointer',
    'font-size: 14px',
    'transition: background 0.15s',
    'color: var(--ls-primary-text-color, #333)',
  ].join(';');

  item.addEventListener('mouseenter', () => {
    item.style.background = 'var(--ls-quaternary-background-color, #f0f0f0)';
  });
  item.addEventListener('mouseleave', () => {
    item.style.background = '';
  });
  item.addEventListener('click', onClick);

  container.appendChild(item);
}
