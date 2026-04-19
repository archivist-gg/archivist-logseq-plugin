// ──────────────────────────────────────────────────────────
// SidecarClient — Browser-side WebSocket + HTTP client
// Runs in Logseq's plugin iframe, connects to the sidecar server.
// Uses the browser's native WebSocket and fetch APIs.
//
// T14 (security hardening): discovery no longer port-scans /health.
// Instead it reads <graphRoot>/.archivist/server.json which the bridge
// writes on startup with `{ pid, port, graphRoot, version, startedAt,
// token }`. Both the WebSocket handshake (via `?token=`) and every
// REST call (via `Authorization: Bearer`) now require this token.
// ──────────────────────────────────────────────────────────

import type { ClientMessage, ServerMessage } from "./protocol";

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

/**
 * Reads the contents of `<graphRoot>/.archivist/server.json` and returns
 * it as a string. Should reject with an error whose `.code === "ENOENT"`
 * when the file does not exist, so `discover()` can surface a clear
 * "bridge is not running" message.
 */
export type ReadServerJson = (graphRoot: string) => Promise<string>;

const RECONNECT_INITIAL_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

/**
 * Default implementation of {@link ReadServerJson} for the Logseq plugin
 * iframe. Logseq's plugin SDK (`@logseq/libs` 0.0.17) exposes no general
 * file-read API, but the iframe runs inside Electron's renderer with
 * relaxed `webSecurity`, so a `fetch()` against a `file://` URL pointing
 * at the discovery file works in practice.
 *
 * TODO(T14): verify this works in the production Logseq build channels.
 * If a future Logseq release tightens the iframe sandbox, fall back to
 * either (a) a small unauthenticated `/discovery` endpoint on the bridge
 * that returns just `{ port }` so we can still locate the server, or
 * (b) storing the token in `logseq.settings` and writing it from a
 * bridge-side first-run flow. Both alternatives are documented in the
 * Task 14 plan.
 */
async function defaultReadServerJson(graphRoot: string): Promise<string> {
  // Strip any trailing slash so the path join is clean.
  const clean = graphRoot.replace(/\/+$/, "");
  const url = `file://${clean}/.archivist/server.json`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err: any) {
    // Browser fetch on a missing file:// resource throws TypeError.
    // We translate that into the same shape Node's fs.readFile uses so
    // SidecarClient.discover() can produce a uniform "not running" error.
    const wrapped: any = new Error(
      `Failed to read server.json at ${url}: ${err?.message ?? err}`,
    );
    wrapped.code = "ENOENT";
    throw wrapped;
  }
  if (!res.ok) {
    if (res.status === 404) {
      const e: any = new Error(`server.json not found at ${url}`);
      e.code = "ENOENT";
      throw e;
    }
    throw new Error(
      `Failed to read server.json (HTTP ${res.status}) at ${url}`,
    );
  }
  return res.text();
}

export class SidecarClient {
  private ws: WebSocket | null = null;
  private state: ConnectionState = "disconnected";
  private port: number | null = null;
  private token: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = RECONNECT_INITIAL_MS;
  private manualDisconnect = false;

  // Dependency-injected WebSocket constructor for testability
  private readonly WS: typeof WebSocket;

  // Dependency-injected reader for `<graphRoot>/.archivist/server.json`
  private readonly readServerJson: ReadServerJson;

  // Event listeners
  private streamListeners = new Set<(msg: ServerMessage) => void>();
  private stateListeners = new Set<(state: ConnectionState) => void>();
  private readyListeners = new Set<() => void>();

  constructor(
    wsConstructor?: typeof WebSocket,
    readServerJson?: ReadServerJson,
  ) {
    this.WS = wsConstructor ?? WebSocket;
    this.readServerJson = readServerJson ?? defaultReadServerJson;
  }

  // ── Connection lifecycle ────────────────────────────────

  /**
   * Discover a running sidecar by reading the bridge's discovery file
   * at `<graphRoot>/.archivist/server.json`. Extracts both the port and
   * the per-process auth token, then opens an authenticated WebSocket.
   *
   * Throws user-facing errors:
   * - "not running" — server.json missing (ENOENT from the reader)
   * - "corrupted"   — server.json present but not valid JSON
   * - "out of date" — server.json missing the `token` field (pre-0.7.0)
   */
  async discover(opts: { graphRoot: string }): Promise<void> {
    let raw: string;
    try {
      raw = await this.readServerJson(opts.graphRoot);
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        throw new Error(
          "archivist-bridge is not running — start it from the plugin settings.",
        );
      }
      throw err;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        "archivist-bridge server.json is corrupted — restart the bridge.",
      );
    }

    if (typeof parsed.port !== "number") {
      throw new Error(
        "archivist-bridge server.json is malformed (no port).",
      );
    }
    if (typeof parsed.token !== "string" || parsed.token.length === 0) {
      throw new Error(
        "archivist-bridge is out of date — please update.",
      );
    }

    this.token = parsed.token;
    this.connect(parsed.port);
  }

  /**
   * Open a WebSocket connection to the given port.
   * Public so tests can call it directly without discover().
   *
   * If a token has been captured by `discover()`, it is appended as
   * `?token=<token>` so the bridge's `verifyClient` accepts the
   * handshake. Without the token, the bridge will return HTTP 401
   * during the upgrade.
   */
  connect(port: number): void {
    this.port = port;
    this.manualDisconnect = false;
    this.setState("connecting");

    const url = this.token
      ? `ws://localhost:${port}/ws?token=${encodeURIComponent(this.token)}`
      : `ws://localhost:${port}/ws`;
    const ws = new this.WS(url);

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

  sendArchivistSettings(tabId: string, ttrpgRootDir: string): void {
    this.send({ type: "archivist.settings", tabId, ttrpgRootDir });
  }

  sendTitleGenerate(tabId: string, conversationId: string, userMessage: string): void {
    this.send({ type: "title.generate", tabId, conversationId, userMessage });
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

  async fetchTabState(): Promise<{
    openTabs: Array<{ tabId: string; conversationId: string | null }>;
    activeTabId: string | null;
  } | null> {
    return this.httpGet("/tabs/state");
  }

  async saveTabState(state: {
    openTabs: Array<{ tabId: string; conversationId: string | null }>;
    activeTabId: string | null;
  }): Promise<void> {
    await this.httpPost("/tabs/state", state);
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

  private authHeaders(): Record<string, string> {
    if (!this.token) {
      throw new Error(
        "SidecarClient: no auth token — call discover() before issuing HTTP requests.",
      );
    }
    return { Authorization: `Bearer ${this.token}` };
  }

  private async httpGet<T>(path: string): Promise<T> {
    if (this.port === null || this.state === "disconnected") {
      throw new Error("Not connected to sidecar");
    }
    const res = await fetch(`http://localhost:${this.port}${path}`, {
      headers: this.authHeaders(),
    });
    return res.json() as Promise<T>;
  }

  private async httpPost<T>(path: string, body: unknown): Promise<T> {
    if (this.port === null || this.state === "disconnected") {
      throw new Error("Not connected to sidecar");
    }
    const res = await fetch(`http://localhost:${this.port}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.authHeaders(),
      },
      body: JSON.stringify(body),
    });
    return res.json() as Promise<T>;
  }
}
