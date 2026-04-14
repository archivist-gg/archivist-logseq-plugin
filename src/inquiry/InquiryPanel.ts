// ──────────────────────────────────────────────────────────
// InquiryPanel — DOM Injection Shell
// Creates and manages the sidebar chat panel in Logseq's host document.
// On sidecar connect, replaces placeholder content with ChatView.
// ──────────────────────────────────────────────────────────

import { SidecarClient, ConnectionState } from './SidecarClient';
import { ChatView } from './ui/ChatView';
import { setIcon, createIconEl } from './shared/icons';
import type { EntityRegistry } from '../entities/entity-registry';

// Import CSS as a raw string — Vite handles this via the ?inline suffix.
// We inject it into the host document <head> since the panel lives outside
// the plugin's sandboxed iframe.
import inquiryCss from '../styles/archivist-inquiry.css?inline';

export class InquiryPanel {
  private hostDoc: Document;
  private panelEl: HTMLElement;
  private client: SidecarClient;
  private entityRegistry: EntityRegistry | null;
  private isOpen = false;
  private styleEl: HTMLStyleElement | null = null;
  private connectionIndicator: HTMLElement | null = null;
  private toolbarBtn: HTMLElement | null = null;

  // ChatView content area — everything below the header/connection indicator
  private contentEl: HTMLElement | null = null;
  private chatView: ChatView | null = null;
  private chatViewReady = false;

  // Header action buttons (wired to ChatView when available)
  private historyBtn: HTMLElement | null = null;
  private newSessionBtn: HTMLElement | null = null;

  constructor(hostDoc: Document, client: SidecarClient, entityRegistry?: EntityRegistry) {
    this.hostDoc = hostDoc;
    this.client = client;
    this.entityRegistry = entityRegistry ?? null;
    this.panelEl = hostDoc.createElement('div');
  }

  init(): void {
    // 1. Inject CSS into host document head
    this.styleEl = this.hostDoc.createElement('style');
    this.styleEl.textContent = inquiryCss;
    this.hostDoc.head.appendChild(this.styleEl);

    // 2. Create panel element
    this.panelEl.id = 'archivist-inquiry-panel';

    // 3. Build panel structure:
    //    - Header (bot icon + "Claudian" title + action buttons)
    //    - Connection indicator
    //    - Content area (placeholder initially, ChatView when connected)

    const header = this.hostDoc.createElement('div');
    header.className = 'archivist-inquiry-header';

    const titleArea = this.hostDoc.createElement('div');
    titleArea.className = 'archivist-inquiry-header-title';
    const botIcon = createIconEl(this.hostDoc, 'bot', 'archivist-inquiry-title-icon');
    const titleText = this.hostDoc.createElement('span');
    titleText.textContent = 'Claudian';
    titleArea.appendChild(botIcon);
    titleArea.appendChild(titleText);

    const actions = this.hostDoc.createElement('div');
    actions.className = 'archivist-inquiry-header-actions';

    this.historyBtn = this.createActionButton('history', 'Session history');
    this.newSessionBtn = this.createActionButton('plus', 'New session');
    const closeBtn = this.createActionButton('x', 'Close');
    closeBtn.addEventListener('click', () => this.toggle());

    actions.appendChild(this.historyBtn);
    actions.appendChild(this.newSessionBtn);
    actions.appendChild(closeBtn);

    header.appendChild(titleArea);
    header.appendChild(actions);

    // Connection indicator
    this.connectionIndicator = this.hostDoc.createElement('div');
    this.connectionIndicator.className = 'archivist-connection-indicator';
    this.updateConnectionState('disconnected');

    // Content area — will hold placeholder or ChatView
    this.contentEl = this.hostDoc.createElement('div');
    this.contentEl.className = 'archivist-inquiry-content claudian-container';
    this.showPlaceholder();

    // Assemble panel
    this.panelEl.appendChild(header);
    this.panelEl.appendChild(this.connectionIndicator);
    this.panelEl.appendChild(this.contentEl);

    // 4. Append to host document
    const appContainer = this.hostDoc.getElementById('app-container')
      || this.hostDoc.body;
    appContainer.appendChild(this.panelEl);

    // 5. Subscribe to sidecar connection state changes
    this.client.onStateChange((state) => this.handleConnectionStateChange(state));

    // 6. Wire sidecar onReady — fires after WebSocket handshake + server greeting
    this.client.onReady(() => this.onSidecarReady());

    // 7. Inject toolbar toggle button into Logseq header
    this.injectToolbarButton();

    // 8. Start sidecar discovery (non-blocking, errors logged)
    const fixedPort = logseq.settings?.sidecarPort as number | undefined;
    this.client.discover(fixedPort && fixedPort > 0 ? fixedPort : undefined)
      .catch((err) => {
        console.log('[archivist] Sidecar not found (will retry on toggle):', err?.message);
      });
  }

  toggle(): void {
    this.isOpen = !this.isOpen;
    this.panelEl.classList.toggle('archivist-panel-open', this.isOpen);
    this.hostDoc.body.classList.toggle('archivist-inquiry-open', this.isOpen);
  }

  /** Trigger a new session from external code (e.g., command palette). */
  newSession(): void {
    this.chatView?.newSession();
  }

  destroy(): void {
    this.chatView?.destroy();
    this.chatView = null;
    this.chatViewReady = false;
    this.panelEl.remove();
    this.styleEl?.remove();
    this.toolbarBtn?.remove();
    this.hostDoc.body.classList.remove('archivist-inquiry-open');
    this.client.disconnect();
  }

  // ── Sidecar lifecycle ──────────────────────────────────

  /**
   * Called when the sidecar sends `connection.ready`.
   * Creates the ChatView if not already created.
   */
  private onSidecarReady(): void {
    if (this.chatViewReady || !this.contentEl) return;

    console.log('[archivist] Sidecar ready — initializing ChatView');

    this.chatView = new ChatView({
      doc: this.hostDoc,
      client: this.client,
      containerEl: this.contentEl,
    });
    this.chatView.init();
    this.chatViewReady = true;

    // Wire header buttons to ChatView
    this.newSessionBtn?.addEventListener('click', () => this.chatView?.newSession());
    this.historyBtn?.addEventListener('click', () => this.chatView?.showSessionHistory());
  }

  private handleConnectionStateChange(state: ConnectionState): void {
    this.updateConnectionState(state);

    if (state === 'disconnected' || state === 'reconnecting') {
      // Don't destroy ChatView on transient disconnects — it preserves
      // the current conversation and will resume when reconnected.
      // Only show the connection banner; ChatView stays mounted.
    }

    // Hide connection indicator when connected (ChatView is the UI now)
    if (state === 'connected' && this.connectionIndicator) {
      this.connectionIndicator.style.display = 'none';
    } else if (this.connectionIndicator) {
      this.connectionIndicator.style.display = '';
    }
  }

  // ── Placeholder ──────────────────────────────────────────

  private showPlaceholder(): void {
    if (!this.contentEl) return;
    this.contentEl.textContent = '';

    const placeholder = this.hostDoc.createElement('div');
    placeholder.className = 'archivist-inquiry-placeholder';
    placeholder.textContent = 'Start the sidecar to begin chatting';
    this.contentEl.appendChild(placeholder);
  }

  // ── DOM helpers ──────────────────────────────────────────

  private createActionButton(iconName: string, title: string): HTMLElement {
    const btn = this.hostDoc.createElement('button');
    btn.className = 'archivist-inquiry-header-btn';
    btn.title = title;
    setIcon(btn, iconName);
    return btn;
  }

  private updateConnectionState(state: ConnectionState): void {
    if (!this.connectionIndicator) return;
    this.connectionIndicator.className = `archivist-connection-indicator archivist-connection-${state}`;

    // Clear and rebuild with dot + label
    this.connectionIndicator.textContent = '';

    const dot = this.hostDoc.createElement('span');
    dot.className = 'archivist-connection-dot';
    this.connectionIndicator.appendChild(dot);

    const labels: Record<ConnectionState, string> = {
      disconnected: 'Start sidecar with: npx archivist serve',
      connecting: 'Connecting...',
      connected: 'Connected',
      reconnecting: 'Reconnecting...',
    };

    const label = this.hostDoc.createElement('span');
    label.textContent = labels[state];
    this.connectionIndicator.appendChild(label);
  }

  private injectToolbarButton(): void {
    // Find Logseq's toolbar area and inject a toggle button.
    // The '.cp__header > .r' selector targets the right-side action area
    // in Logseq's top header bar.
    const toolbar = this.hostDoc.querySelector('.cp__header > .r');
    if (toolbar) {
      const btn = this.hostDoc.createElement('button');
      btn.className = 'archivist-inquiry-toolbar-btn';
      btn.title = 'Toggle Claudian';
      setIcon(btn, 'bot');
      btn.addEventListener('click', () => this.toggle());
      toolbar.prepend(btn);
      this.toolbarBtn = btn;
    }
  }
}
