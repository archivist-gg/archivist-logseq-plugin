/**
 * FileContextManager -- @-mention file chips.
 *
 * Ported from Obsidian. Changes:
 * - Removed `App`, `TFile`, `Vault`, `EventRef` deps (Obsidian API)
 * - Removed `VaultMentionDataProvider`, `MentionDropdownController` (complex Obsidian-specific)
 * - File resolution goes through sidecar; the plugin only tracks chip state
 * - This is a simplified version: file chips are rendered and tracked,
 *   but the full mention dropdown is deferred to a follow-up task
 * - Constructor takes `doc: Document` + `client: SidecarClient`
 */

import type { SidecarClient } from '../SidecarClient';
import type { RichInput } from './RichInput';

export interface FileContextCallbacks {
  onChipsChanged?: () => void;
}

export class FileContextManager {
  private doc: Document;
  private client: SidecarClient;
  private chipsContainerEl: HTMLElement;
  private richInput: RichInput;
  private callbacks: FileContextCallbacks;

  // Current note (shown as chip)
  private currentNotePath: string | null = null;
  private attachedFiles: Set<string> = new Set();
  private sessionStarted = false;
  private currentNoteSent = false;

  constructor(
    doc: Document,
    client: SidecarClient,
    chipsContainerEl: HTMLElement,
    richInput: RichInput,
    callbacks: FileContextCallbacks,
  ) {
    this.doc = doc;
    this.client = client;
    this.chipsContainerEl = chipsContainerEl;
    this.richInput = richInput;
    this.callbacks = callbacks;
  }

  // ── Public API ──

  getCurrentNotePath(): string | null {
    return this.currentNotePath;
  }

  getAttachedFiles(): Set<string> {
    return new Set(this.attachedFiles);
  }

  shouldSendCurrentNote(notePath?: string | null): boolean {
    const resolvedPath = notePath ?? this.currentNotePath;
    return !!resolvedPath && !this.currentNoteSent;
  }

  markCurrentNoteSent(): void {
    this.currentNoteSent = true;
  }

  isSessionStarted(): boolean {
    return this.sessionStarted;
  }

  startSession(): void {
    this.sessionStarted = true;
  }

  resetForNewConversation(): void {
    this.currentNotePath = null;
    this.attachedFiles.clear();
    this.sessionStarted = false;
    this.currentNoteSent = false;
    this.refreshChips();
  }

  resetForLoadedConversation(hasMessages: boolean): void {
    this.currentNotePath = null;
    this.attachedFiles.clear();
    this.sessionStarted = hasMessages;
    this.currentNoteSent = hasMessages;
    this.refreshChips();
  }

  setCurrentNote(notePath: string | null): void {
    this.currentNotePath = notePath;
    if (notePath) {
      this.attachedFiles.add(notePath);
    }
    this.refreshChips();
  }

  attachFile(filePath: string): void {
    this.attachedFiles.add(filePath);
    this.refreshChips();
  }

  detachFile(filePath: string): void {
    this.attachedFiles.delete(filePath);
    if (this.currentNotePath === filePath) {
      this.currentNotePath = null;
    }
    this.refreshChips();
  }

  /** Handles input changes to detect @ mentions. */
  handleInputChange(): void {
    // Mention dropdown deferred to follow-up task
    // Currently a no-op; will wire MentionDropdownController later
  }

  /** Handles keyboard navigation in mention dropdown. Returns true if handled. */
  handleMentionKeydown(_e: KeyboardEvent): boolean {
    // Mention dropdown deferred to follow-up task
    return false;
  }

  isMentionDropdownVisible(): boolean {
    return false;
  }

  hideMentionDropdown(): void {
    // No-op
  }

  containsElement(_el: Node): boolean {
    return false;
  }

  destroy(): void {
    // Clean up chip container
    while (this.chipsContainerEl.firstChild) {
      this.chipsContainerEl.removeChild(this.chipsContainerEl.firstChild);
    }
  }

  // ── Private ──

  private refreshChips(): void {
    const doc = this.doc;
    while (this.chipsContainerEl.firstChild) {
      this.chipsContainerEl.removeChild(this.chipsContainerEl.firstChild);
    }

    if (this.currentNotePath) {
      const chip = doc.createElement('div');
      chip.className = 'claudian-file-chip claudian-file-chip--current';

      const nameEl = doc.createElement('span');
      nameEl.className = 'claudian-file-chip-name';
      nameEl.textContent = this.getFileName(this.currentNotePath);
      nameEl.setAttribute('title', this.currentNotePath);
      chip.appendChild(nameEl);

      const removeBtn = doc.createElement('span');
      removeBtn.className = 'claudian-file-chip-remove';
      removeBtn.textContent = '\u00D7';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.detachFile(this.currentNotePath!);
      });
      chip.appendChild(removeBtn);

      this.chipsContainerEl.appendChild(chip);
    }

    this.callbacks.onChipsChanged?.();
  }

  private getFileName(path: string): string {
    const parts = path.split('/');
    return parts[parts.length - 1] || path;
  }
}
