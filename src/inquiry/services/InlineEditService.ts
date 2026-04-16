/**
 * InlineEditService -- Sends inline edit request to sidecar, shows result in overlay modal.
 *
 * Ported from Obsidian's InstructionRefineService concept. Key changes:
 * - No Claude SDK calls -- delegates to sidecar via WebSocket
 * - Results displayed using showModal() overlay instead of Obsidian Modal
 * - Simplified: sends edit request, receives diff result
 */

import type { SidecarClient } from '../SidecarClient';
import type { ServerMessage } from '../protocol';
import { showModal } from '../shared/modals';

export interface InlineEditResult {
  success: boolean;
  original?: string;
  edited?: string;
  error?: string;
}

export type InlineEditCallback = (result: InlineEditResult) => void;

/**
 * Service for inline editing via the sidecar.
 *
 * Sends an edit instruction and selected text to the sidecar,
 * receives the edited result, and displays it in an overlay modal
 * for the user to accept or reject.
 */
export class InlineEditService {
  private client: SidecarClient;

  constructor(client: SidecarClient) {
    this.client = client;
  }

  /**
   * Request an inline edit from the sidecar.
   *
   * @param instruction - The edit instruction (e.g., "make it shorter")
   * @param selectedText - The text to edit
   * @param doc - Document reference for creating the modal overlay
   * @param onAccept - Called with edited text when user accepts
   */
  async requestEdit(
    instruction: string,
    selectedText: string,
    doc: Document,
    onAccept: (editedText: string) => void,
  ): Promise<void> {
    // For now, show a placeholder modal.
    // When the sidecar supports an edit endpoint, this would send
    // the request and wait for the result via WebSocket.

    const modal = showModal(doc, {
      title: 'Inline Edit',
      content: (containerEl: HTMLElement) => {
        const msgEl = doc.createElement('p');
        msgEl.textContent = 'Inline editing via sidecar is not yet implemented.';
        msgEl.style.color = 'var(--ls-secondary-text-color, #666)';
        containerEl.appendChild(msgEl);

        const preEl = doc.createElement('pre');
        preEl.style.whiteSpace = 'pre-wrap';
        preEl.style.padding = '8px';
        preEl.style.background = 'var(--ls-secondary-background-color, #f5f5f5)';
        preEl.style.borderRadius = '4px';
        preEl.style.fontSize = '12px';
        preEl.textContent = selectedText;
        containerEl.appendChild(preEl);
      },
    });
  }

  /** Cancel any active inline edit. */
  cancel(): void {
    // No active state to cancel in the simplified version
  }
}
