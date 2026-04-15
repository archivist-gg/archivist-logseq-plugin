// ──────────────────────────────────────────────────────────
// SidecarClient — Browser-side WebSocket + HTTP client
// Runs in Logseq's plugin iframe, connects to the sidecar server.
// Uses the browser's native WebSocket and fetch APIs.
// ──────────────────────────────────────────────────────────

import type { ClientMessage, ServerMessage } from "./protocol";

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

const PORT_RANGE_START = 52340;
const PORT_RANGE_END = 52360;
const RECONNECT_INITIAL_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const HEALTH_TIMEOUT_MS = 2000;

export class SidecarClient {
  private ws: WebSocket | null = null;
  private state: ConnectionState = "disconnected";
  private port: number | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = RECONNECT_INITIAL_MS;
  private manualDisconnect = false;

  // Dependency-injected WebSocket constructor for testability
  private readonly WS: typeof WebSocket;

  // Event listeners
  private streamListeners = new Set<(msg: ServerMessage) => void>();
  private stateListeners = new Set<(state: ConnectionState) => void>();
  private readyListeners = new Set<() => void>();

  constructor(wsConstructor?: typeof WebSocket) {
    this.WS = wsConstructor ?? WebSocket;
  }

  // ── Connection lifecycle ────────────────────────────────

  /**
   * Discover a running sidecar by scanning ports or using a fixed port.
   * Once found, initiates a WebSocket connection.
   */
  async discover(fixedPort?: number): Promise<void> {
    if (fixedPort !== undefined) {
      await this.probeHealth(fixedPort);
      this.connect(fixedPort);
      return;
    }

    // Scan port range concurrently
    const results = await Promise.allSettled(
      Array.from(
        { length: PORT_RANGE_END - PORT_RANGE_START + 1 },
        (_, i) => PORT_RANGE_START + i
      ).map((port) => this.probeHealth(port).then(() => port))
    );

    const found = results.find(
      (r): r is PromiseFulfilledResult<number> => r.status === "fulfilled"
    );

    if (!found) {
      throw new Error(
        `No Archivist sidecar found on ports ${PORT_RANGE_START}-${PORT_RANGE_END}`
      );
    }

    this.connect(found.value);
  }

  /**
   * Open a WebSocket connection to the given port.
   * Public so tests can call it directly without discover().
   */
  connect(port: number): void {
    this.port = port;
    this.manualDisconnect = false;
    this.setState("connecting");

    const ws = new this.WS(`ws://localhost:${port}/ws`);

    ws.onopen = () => {
      this.reconnectDelay = RECONNECT_INITIAL_MS;
      this.setState("connected");
    };

    ws.onmessage = (ev: MessageEvent | { data: string }) => {
      try {
        const msg = JSON.parse(
          typeof ev.data === "string" ? ev.data : String(ev.data)
        ) as ServerMessage;
        this.routeMessage(msg);
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      if (!this.manualDisconnect) {
        this.setState("reconnecting");
        this.scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // onclose will fire after onerror, so reconnect is handled there
    };

    this.ws = ws;
  }

  /**
   * Cleanly close the connection. No auto-reconnect will occur.
   */
  disconnect(): void {
    this.manualDisconnect = true;
    this.clearReconnectTimer();

    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.onopen = null;
      this.ws.close();
      this.ws = null;
    }

    this.setState("disconnected");
  }

  getState(): ConnectionState {
    return this.state;
  }

  // ── Event subscription ──────────────────────────────────

  /**
   * Subscribe to all incoming server messages.
   * Returns an unsubscribe function.
   */
  onMessage(listener: (msg: ServerMessage) => void): () => void {
    this.streamListeners.add(listener);
    return () => {
      this.streamListeners.delete(listener);
    };
  }

  /**
   * Subscribe to connection state changes.
   * Returns an unsubscribe function.
   */
  onStateChange(listener: (state: ConnectionState) => void): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  /**
   * Subscribe to messages for a specific tab.
   * Messages without a tabId are also delivered (broadcast messages).
   * Returns an unsubscribe function.
   */
  onTabMessage(tabId: string, listener: (msg: ServerMessage) => void): () => void {
    const filtered = (msg: ServerMessage) => {
      if (!(msg as any).tabId || (msg as any).tabId === tabId) {
        listener(msg);
      }
    };
    return this.onMessage(filtered);
  }

  /**
   * Subscribe to the connection.ready event from the server.
   * Returns an unsubscribe function.
   */
  onReady(listener: () => void): () => void {
    this.readyListeners.add(listener);
    return () => {
      this.readyListeners.delete(listener);
    };
  }

  // ── Send methods (all client message types) ─────────────

  sendQuery(
    tabId: string,
    text: string,
    options?: {
      images?: string[];
      filePaths?: string[];
      editorSelection?: string;
      entityRefs?: string[];
      sessionId?: string;
    }
  ): void {
    const msg: ClientMessage = { type: "query", tabId, text };
    if (options?.images) msg.images = options.images;
    if (options?.filePaths) msg.filePaths = options.filePaths;
    if (options?.editorSelection)
      msg.editorSelection = options.editorSelection;
    if (options?.entityRefs) msg.entityRefs = options.entityRefs;
    if (options?.sessionId) msg.sessionId = options.sessionId;
    this.send(msg);
  }

  sendInterrupt(tabId: string): void {
    this.send({ type: "interrupt", tabId });
  }

  sendApprove(tabId: string, toolCallId: string): void {
    this.send({ type: "approve", tabId, toolCallId });
  }

  sendDeny(tabId: string, toolCallId: string): void {
    this.send({ type: "deny", tabId, toolCallId });
  }

  sendAllowAlways(tabId: string, toolCallId: string, pattern: string): void {
    this.send({ type: "allow_always", tabId, toolCallId, pattern });
  }

  sendSessionList(tabId: string): void {
    this.send({ type: "session.list", tabId });
  }

  sendSessionResume(tabId: string, sessionId: string): void {
    this.send({ type: "session.resume", tabId, sessionId });
  }

  sendSessionFork(tabId: string, sessionId: string, messageIndex: number): void {
    this.send({ type: "session.fork", tabId, sessionId, messageIndex });
  }

  sendSessionRewind(tabId: string, sessionId: string, messageIndex: number): void {
    this.send({ type: "session.rewind", tabId, sessionId, messageIndex });
  }

  sendSessionRename(tabId: string, sessionId: string, title: string): void {
    this.send({ type: "session.rename", tabId, sessionId, title });
  }

  sendSettingsGet(tabId: string): void {
    this.send({ type: "settings.get", tabId });
  }

  sendSettingsUpdate(tabId: string, patch: Record<string, unknown>): void {
    this.send({ type: "settings.update", tabId, patch });
  }

  sendMcpList(tabId: string): void {
    this.send({ type: "mcp.list", tabId });
  }

  sendMcpUpdate(tabId: string, config: Record<string, unknown>): void {
    this.send({ type: "mcp.update", tabId, config });
  }

  sendCommandList(tabId: string): void {
    this.send({ type: "command.list", tabId });
  }

  sendPlanApprove(tabId: string, toolCallId: string): void {
    this.send({ type: "plan.approve", tabId, toolCallId });
  }

  sendPlanApproveNewSession(
    tabId: string,
    toolCallId: string,
    planContent: string
  ): void {
    this.send({ type: "plan.approve_new_session", tabId, toolCallId, planContent });
  }

  sendPlanFeedback(tabId: string, toolCallId: string, text: string): void {
    this.send({ type: "plan.feedback", tabId, toolCallId, text });
  }

  sendAskUserAnswer(
    tabId: string,
    toolCallId: string,
    answers: Record<string, string>
  ): void {
    this.send({ type: "askuser.answer", tabId, toolCallId, answers });
  }

  sendAskUserDismiss(tabId: string, toolCallId: string): void {
    this.send({ type: "askuser.dismiss", tabId, toolCallId });
  }

  sendTabDestroy(tabId: string): void {
    this.send({ type: "tab.destroy", tabId });
  }

  sendBashExecute(tabId: string, id: string, command: string): void {
    this.send({ type: "bash.execute", tabId, id, command });
  }

  sendInstructionRefine(tabId: string, instruction: string, existingInstructions: string): void {
    this.send({ type: "instruction.refine", tabId, instruction, existingInstructions });
  }

  // ── HTTP fetch methods ──────────────────────────────────

  async fetchSettings(): Promise<Record<string, unknown>> {
    return this.httpGet<Record<string, unknown>>("/settings");
  }

  async fetchSessions(): Promise<
    Array<{ id: string; title: string; lastModified: number }>
  > {
    return this.httpGet("/sessions");
  }

  async fetchCommands(): Promise<
    Array<{ name: string; description: string }>
  > {
    return this.httpGet("/commands");
  }

  // ── Private methods ─────────────────────────────────────

  private send(message: ClientMessage): void {
    if (
      !this.ws ||
      (this.ws as { readyState: number }).readyState !== 1 // WebSocket.OPEN
    ) {
      return; // Silently drop if not connected
    }
    this.ws.send(JSON.stringify(message));
  }

  private setState(newState: ConnectionState): void {
    if (this.state === newState) return;
    this.state = newState;
    for (const listener of this.stateListeners) {
      listener(newState);
    }
  }

  private routeMessage(msg: ServerMessage): void {
    // Fire ready listeners on connection.ready
    if (msg.type === "connection.ready") {
      for (const listener of this.readyListeners) {
        listener();
      }
    }

    // All messages go to stream listeners
    for (const listener of this.streamListeners) {
      listener(msg);
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();

    const delay = Math.min(this.reconnectDelay, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      if (this.port !== null && !this.manualDisconnect) {
        this.reconnectDelay = Math.min(
          this.reconnectDelay * 2,
          RECONNECT_MAX_MS
        );
        this.connect(this.port);
      }
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private async probeHealth(port: number): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      HEALTH_TIMEOUT_MS
    );

    try {
      const res = await fetch(`http://localhost:${port}/health`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { service?: string };
      if (body.service !== "archivist") {
        throw new Error("Not an archivist sidecar");
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  private async httpGet<T>(path: string): Promise<T> {
    if (this.port === null || this.state === "disconnected") {
      throw new Error("Not connected to sidecar");
    }
    const res = await fetch(`http://localhost:${this.port}${path}`);
    return res.json() as Promise<T>;
  }
}
