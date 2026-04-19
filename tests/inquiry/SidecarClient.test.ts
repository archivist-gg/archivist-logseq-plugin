import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  SidecarClient,
  ConnectionState,
} from "@/inquiry/SidecarClient";
import type { ServerMessage, ClientMessage } from "@/inquiry/protocol";

// ── MockWebSocket ───────────────────────────────────────────

type WSListener = (ev: { data: string }) => void;
type WSCloseListener = (ev: { code: number; reason: string }) => void;
type WSOpenListener = () => void;
type WSErrorListener = (ev: Event) => void;

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = 0; // CONNECTING
  sent: string[] = [];

  onopen: WSOpenListener | null = null;
  onclose: WSCloseListener | null = null;
  onmessage: WSListener | null = null;
  onerror: WSErrorListener | null = null;

  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose({ code: 1000, reason: "closed" });
    }
  }

  // Test helpers
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) this.onopen();
  }

  simulateMessage(msg: ServerMessage): void {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(msg) });
    }
  }

  simulateClose(code = 1006, reason = "abnormal"): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose({ code, reason });
    }
  }

  simulateError(): void {
    if (this.onerror) {
      this.onerror(new Event("error"));
    }
  }

  static reset(): void {
    MockWebSocket.instances = [];
  }

  static latest(): MockWebSocket {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
  }
}

// ── Helpers ──────────────────────────────────────────────────

function createClient(): SidecarClient {
  return new SidecarClient(MockWebSocket as unknown as typeof WebSocket);
}

function connectClient(client: SidecarClient, port = 52340): MockWebSocket {
  client.connect(port);
  const ws = MockWebSocket.latest();
  ws.simulateOpen();
  // Simulate the connection.ready message the server sends
  ws.simulateMessage({ type: "connection.ready", version: "1.0.0" });
  return ws;
}

// ── Tests ────────────────────────────────────────────────────

describe("SidecarClient", () => {
  beforeEach(() => {
    MockWebSocket.reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Connection state ────────────────────────────────────

  describe("connection state", () => {
    it("starts in disconnected state", () => {
      const client = createClient();
      expect(client.getState()).toBe("disconnected");
    });

    it("transitions to connecting when connect is called", () => {
      const client = createClient();
      client.connect(52340);
      expect(client.getState()).toBe("connecting");
    });

    it("transitions to connected on WebSocket open", () => {
      const client = createClient();
      client.connect(52340);
      const ws = MockWebSocket.latest();
      ws.simulateOpen();
      expect(client.getState()).toBe("connected");
    });

    it("notifies state listeners on state changes", () => {
      const client = createClient();
      const states: ConnectionState[] = [];
      client.onStateChange((s) => states.push(s));

      client.connect(52340);
      const ws = MockWebSocket.latest();
      ws.simulateOpen();

      expect(states).toEqual(["connecting", "connected"]);
    });

    it("transitions to disconnected on manual disconnect", () => {
      const client = createClient();
      const ws = connectClient(client);

      client.disconnect();
      expect(client.getState()).toBe("disconnected");
    });

    it("unsubscribe removes state listener", () => {
      const client = createClient();
      const states: ConnectionState[] = [];
      const unsub = client.onStateChange((s) => states.push(s));

      client.connect(52340);
      unsub();
      MockWebSocket.latest().simulateOpen();

      // Only captured the 'connecting' state, not 'connected'
      expect(states).toEqual(["connecting"]);
    });
  });

  // ── Connection ready ────────────────────────────────────

  describe("connection ready detection", () => {
    it("fires ready listeners on connection.ready message", () => {
      const client = createClient();
      const readyCb = vi.fn();
      client.onReady(readyCb);

      client.connect(52340);
      const ws = MockWebSocket.latest();
      ws.simulateOpen();

      expect(readyCb).not.toHaveBeenCalled();

      ws.simulateMessage({ type: "connection.ready", version: "1.0.0" });
      expect(readyCb).toHaveBeenCalledOnce();
    });

    it("unsubscribe removes ready listener", () => {
      const client = createClient();
      const readyCb = vi.fn();
      const unsub = client.onReady(readyCb);
      unsub();

      client.connect(52340);
      const ws = MockWebSocket.latest();
      ws.simulateOpen();
      ws.simulateMessage({ type: "connection.ready", version: "1.0.0" });

      expect(readyCb).not.toHaveBeenCalled();
    });
  });

  // ── Sending messages ────────────────────────────────────

  describe("sending messages", () => {
    const TAB = "tab-1";

    it("sends query message correctly", () => {
      const client = createClient();
      const ws = connectClient(client);

      client.sendQuery(TAB, "What is a beholder?", {
        entityRefs: ["monster:beholder"],
        sessionId: "sess-1",
      });

      expect(ws.sent).toHaveLength(1);
      const msg = JSON.parse(ws.sent[0]) as ClientMessage;
      expect(msg).toEqual({
        type: "query",
        tabId: TAB,
        text: "What is a beholder?",
        entityRefs: ["monster:beholder"],
        sessionId: "sess-1",
      });
    });

    it("sends query with all optional fields", () => {
      const client = createClient();
      const ws = connectClient(client);

      client.sendQuery(TAB, "Describe this", {
        images: ["data:image/png;base64,abc"],
        filePaths: ["/path/to/file.md"],
        editorSelection: "selected text",
        entityRefs: ["spell:fireball"],
        sessionId: "sess-2",
      });

      const msg = JSON.parse(ws.sent[0]);
      expect(msg.type).toBe("query");
      expect(msg.tabId).toBe(TAB);
      expect(msg.images).toEqual(["data:image/png;base64,abc"]);
      expect(msg.filePaths).toEqual(["/path/to/file.md"]);
      expect(msg.editorSelection).toBe("selected text");
    });

    it("sends interrupt message", () => {
      const client = createClient();
      const ws = connectClient(client);

      client.sendInterrupt(TAB);

      const msg = JSON.parse(ws.sent[0]);
      expect(msg).toEqual({ type: "interrupt", tabId: TAB });
    });

    it("sends approve message", () => {
      const client = createClient();
      const ws = connectClient(client);

      client.sendApprove(TAB, "tool-123");

      const msg = JSON.parse(ws.sent[0]);
      expect(msg).toEqual({ type: "approve", tabId: TAB, toolCallId: "tool-123" });
    });

    it("sends deny message", () => {
      const client = createClient();
      const ws = connectClient(client);

      client.sendDeny(TAB, "tool-456");

      const msg = JSON.parse(ws.sent[0]);
      expect(msg).toEqual({ type: "deny", tabId: TAB, toolCallId: "tool-456" });
    });

    it("sends allow_always message", () => {
      const client = createClient();
      const ws = connectClient(client);

      client.sendAllowAlways(TAB, "tool-789", "file:read:*");

      const msg = JSON.parse(ws.sent[0]);
      expect(msg).toEqual({
        type: "allow_always",
        tabId: TAB,
        toolCallId: "tool-789",
        pattern: "file:read:*",
      });
    });

    it("sends session.list message", () => {
      const client = createClient();
      const ws = connectClient(client);

      client.sendSessionList(TAB);

      const msg = JSON.parse(ws.sent[0]);
      expect(msg).toEqual({ type: "session.list", tabId: TAB });
    });

    it("sends session.resume message", () => {
      const client = createClient();
      const ws = connectClient(client);

      client.sendSessionResume(TAB, "sess-abc");

      const msg = JSON.parse(ws.sent[0]);
      expect(msg).toEqual({ type: "session.resume", tabId: TAB, sessionId: "sess-abc" });
    });

    it("sends session.fork message", () => {
      const client = createClient();
      const ws = connectClient(client);

      client.sendSessionFork(TAB, "sess-abc", 5);

      const msg = JSON.parse(ws.sent[0]);
      expect(msg).toEqual({
        type: "session.fork",
        tabId: TAB,
        sessionId: "sess-abc",
        messageIndex: 5,
      });
    });

    it("sends session.rewind message", () => {
      const client = createClient();
      const ws = connectClient(client);

      client.sendSessionRewind(TAB, "sess-abc", 3);

      const msg = JSON.parse(ws.sent[0]);
      expect(msg).toEqual({
        type: "session.rewind",
        tabId: TAB,
        sessionId: "sess-abc",
        messageIndex: 3,
      });
    });

    it("sends settings.get message", () => {
      const client = createClient();
      const ws = connectClient(client);

      client.sendSettingsGet(TAB);

      const msg = JSON.parse(ws.sent[0]);
      expect(msg).toEqual({ type: "settings.get", tabId: TAB });
    });

    it("sends settings.update message", () => {
      const client = createClient();
      const ws = connectClient(client);

      client.sendSettingsUpdate(TAB, { model: "opus" });

      const msg = JSON.parse(ws.sent[0]);
      expect(msg).toEqual({ type: "settings.update", tabId: TAB, patch: { model: "opus" } });
    });

    it("sends mcp.list message", () => {
      const client = createClient();
      const ws = connectClient(client);

      client.sendMcpList(TAB);

      const msg = JSON.parse(ws.sent[0]);
      expect(msg).toEqual({ type: "mcp.list", tabId: TAB });
    });

    it("sends mcp.update message", () => {
      const client = createClient();
      const ws = connectClient(client);

      client.sendMcpUpdate(TAB, { servers: [] });

      const msg = JSON.parse(ws.sent[0]);
      expect(msg).toEqual({ type: "mcp.update", tabId: TAB, config: { servers: [] } });
    });

    it("sends command.list message", () => {
      const client = createClient();
      const ws = connectClient(client);

      client.sendCommandList(TAB);

      const msg = JSON.parse(ws.sent[0]);
      expect(msg).toEqual({ type: "command.list", tabId: TAB });
    });

    it("sends plan.approve message", () => {
      const client = createClient();
      const ws = connectClient(client);

      client.sendPlanApprove(TAB, "plan-1");

      const msg = JSON.parse(ws.sent[0]);
      expect(msg).toEqual({ type: "plan.approve", tabId: TAB, toolCallId: "plan-1" });
    });

    it("sends plan.approve_new_session message", () => {
      const client = createClient();
      const ws = connectClient(client);

      client.sendPlanApproveNewSession(TAB, "plan-2", "Build a wizard tower");

      const msg = JSON.parse(ws.sent[0]);
      expect(msg).toEqual({
        type: "plan.approve_new_session",
        tabId: TAB,
        toolCallId: "plan-2",
        planContent: "Build a wizard tower",
      });
    });

    it("sends plan.feedback message", () => {
      const client = createClient();
      const ws = connectClient(client);

      client.sendPlanFeedback(TAB, "plan-3", "Add more traps");

      const msg = JSON.parse(ws.sent[0]);
      expect(msg).toEqual({
        type: "plan.feedback",
        tabId: TAB,
        toolCallId: "plan-3",
        text: "Add more traps",
      });
    });

    it("sends askuser.answer message", () => {
      const client = createClient();
      const ws = connectClient(client);

      client.sendAskUserAnswer(TAB, "ask-1", { choice: "yes" });

      const msg = JSON.parse(ws.sent[0]);
      expect(msg).toEqual({
        type: "askuser.answer",
        tabId: TAB,
        toolCallId: "ask-1",
        answers: { choice: "yes" },
      });
    });

    it("sends askuser.dismiss message", () => {
      const client = createClient();
      const ws = connectClient(client);

      client.sendAskUserDismiss(TAB, "ask-2");

      const msg = JSON.parse(ws.sent[0]);
      expect(msg).toEqual({ type: "askuser.dismiss", tabId: TAB, toolCallId: "ask-2" });
    });

    it("sends tab.destroy message", () => {
      const client = createClient();
      const ws = connectClient(client);

      client.sendTabDestroy(TAB);

      const msg = JSON.parse(ws.sent[0]);
      expect(msg).toEqual({ type: "tab.destroy", tabId: TAB });
    });

    it("silently drops messages when not connected", () => {
      const client = createClient();
      // No connection established — should not throw
      expect(() => client.sendInterrupt(TAB)).not.toThrow();
    });
  });

  // ── Receiving messages (stream routing) ─────────────────

  describe("message routing", () => {
    it("routes stream.text chunks to message listeners", () => {
      const client = createClient();
      const messages: ServerMessage[] = [];
      client.onMessage((msg) => messages.push(msg));

      const ws = connectClient(client);

      const chunk: ServerMessage = { type: "stream.text", text: "Hello " };
      ws.simulateMessage(chunk);

      expect(messages).toHaveLength(2); // connection.ready + stream.text
      expect(messages[1]).toEqual(chunk);
    });

    it("routes multiple message types to listeners", () => {
      const client = createClient();
      const types: string[] = [];
      client.onMessage((msg) => types.push(msg.type));

      const ws = connectClient(client);

      ws.simulateMessage({ type: "stream.text", text: "Hi" });
      ws.simulateMessage({ type: "stream.done" });
      ws.simulateMessage({
        type: "stream.tool_use",
        id: "t1",
        name: "read_file",
        input: { path: "/foo" },
      });

      // connection.ready + 3 messages
      expect(types).toEqual([
        "connection.ready",
        "stream.text",
        "stream.done",
        "stream.tool_use",
      ]);
    });

    it("supports multiple simultaneous listeners", () => {
      const client = createClient();
      const listenerA = vi.fn();
      const listenerB = vi.fn();
      client.onMessage(listenerA);
      client.onMessage(listenerB);

      const ws = connectClient(client);
      ws.simulateMessage({ type: "stream.text", text: "test" });

      // Each listener gets connection.ready + stream.text
      expect(listenerA).toHaveBeenCalledTimes(2);
      expect(listenerB).toHaveBeenCalledTimes(2);
    });

    it("unsubscribe removes message listener", () => {
      const client = createClient();
      const listener = vi.fn();
      const unsub = client.onMessage(listener);

      const ws = connectClient(client);
      unsub();
      ws.simulateMessage({ type: "stream.text", text: "after unsub" });

      // Got connection.ready before unsub, but not the stream.text after
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  // ── Tab-filtered message subscription ───────────────────

  describe("onTabMessage", () => {
    it("delivers messages matching the tab id", () => {
      const client = createClient();
      const messages: ServerMessage[] = [];
      client.onTabMessage("tab-A", (msg) => messages.push(msg));

      const ws = connectClient(client);
      ws.simulateMessage({ type: "stream.text", text: "hello", tabId: "tab-A" } as any);

      // connection.ready (no tabId, so delivered) + stream.text (matching tabId)
      expect(messages).toHaveLength(2);
      expect(messages[1]).toMatchObject({ type: "stream.text", text: "hello" });
    });

    it("delivers messages without a tabId (broadcast)", () => {
      const client = createClient();
      const messages: ServerMessage[] = [];
      client.onTabMessage("tab-A", (msg) => messages.push(msg));

      const ws = connectClient(client);
      ws.simulateMessage({ type: "stream.done" });

      // connection.ready + stream.done — both lack tabId so both are delivered
      expect(messages).toHaveLength(2);
    });

    it("filters out messages for a different tab", () => {
      const client = createClient();
      const messages: ServerMessage[] = [];
      client.onTabMessage("tab-A", (msg) => messages.push(msg));

      const ws = connectClient(client);
      ws.simulateMessage({ type: "stream.text", text: "wrong tab", tabId: "tab-B" } as any);

      // Only connection.ready (no tabId) delivered; stream.text for tab-B filtered out
      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe("connection.ready");
    });

    it("returns an unsubscribe function", () => {
      const client = createClient();
      const messages: ServerMessage[] = [];
      const unsub = client.onTabMessage("tab-A", (msg) => messages.push(msg));

      const ws = connectClient(client);
      unsub();
      ws.simulateMessage({ type: "stream.text", text: "after unsub", tabId: "tab-A" } as any);

      // Got connection.ready before unsub, nothing after
      expect(messages).toHaveLength(1);
    });
  });

  // ── Auto-reconnect ─────────────────────────────────────

  describe("auto-reconnect", () => {
    it("enters reconnecting state on unexpected close", () => {
      const client = createClient();
      const states: ConnectionState[] = [];
      client.onStateChange((s) => states.push(s));

      connectClient(client);
      const ws = MockWebSocket.latest();

      // Simulate unexpected close (not manual disconnect)
      ws.simulateClose(1006, "abnormal closure");

      expect(client.getState()).toBe("reconnecting");
      expect(states).toContain("reconnecting");
    });

    it("attempts reconnect after delay", () => {
      const client = createClient();
      connectClient(client, 52345);

      const initialCount = MockWebSocket.instances.length;
      MockWebSocket.latest().simulateClose(1006, "dropped");

      // Not yet reconnected
      expect(MockWebSocket.instances).toHaveLength(initialCount);

      // Advance past the first reconnect delay (1s)
      vi.advanceTimersByTime(1000);

      // A new WebSocket should have been created
      expect(MockWebSocket.instances.length).toBe(initialCount + 1);
      const newWs = MockWebSocket.latest();
      expect(newWs.url).toContain("52345");
    });

    it("uses exponential backoff for reconnect delays", () => {
      const client = createClient();
      connectClient(client, 52340);

      // First disconnect -> 1s delay
      MockWebSocket.latest().simulateClose(1006);
      vi.advanceTimersByTime(1000);
      const afterFirst = MockWebSocket.instances.length;

      // Simulate second failure -> 2s delay
      MockWebSocket.latest().simulateClose(1006);
      vi.advanceTimersByTime(1000);
      expect(MockWebSocket.instances.length).toBe(afterFirst); // Not yet
      vi.advanceTimersByTime(1000);
      const afterSecond = MockWebSocket.instances.length;
      expect(afterSecond).toBe(afterFirst + 1);

      // Third failure -> 4s delay
      MockWebSocket.latest().simulateClose(1006);
      vi.advanceTimersByTime(3000);
      expect(MockWebSocket.instances.length).toBe(afterSecond); // Not yet
      vi.advanceTimersByTime(1000);
      expect(MockWebSocket.instances.length).toBe(afterSecond + 1);
    });

    it("resets reconnect delay on successful connection", () => {
      const client = createClient();
      connectClient(client, 52340);

      // Fail twice to build up backoff
      MockWebSocket.latest().simulateClose(1006);
      vi.advanceTimersByTime(1000); // 1s
      MockWebSocket.latest().simulateClose(1006);
      vi.advanceTimersByTime(2000); // 2s

      // Now succeed
      MockWebSocket.latest().simulateOpen();
      expect(client.getState()).toBe("connected");

      // Fail again — delay should be back to 1s, not 4s
      const countBefore = MockWebSocket.instances.length;
      MockWebSocket.latest().simulateClose(1006);
      vi.advanceTimersByTime(1000);
      expect(MockWebSocket.instances.length).toBe(countBefore + 1);
    });

    it("does not reconnect after manual disconnect", () => {
      const client = createClient();
      connectClient(client);

      client.disconnect();

      const count = MockWebSocket.instances.length;
      vi.advanceTimersByTime(30000);

      // No new WebSocket instances should be created
      expect(MockWebSocket.instances.length).toBe(count);
    });

    it("caps backoff at 30 seconds", () => {
      const client = createClient();
      connectClient(client, 52340);

      // Fail many times to build up backoff past 30s
      // 1, 2, 4, 8, 16, 32 -> should cap at 30
      for (let i = 0; i < 5; i++) {
        MockWebSocket.latest().simulateClose(1006);
        vi.advanceTimersByTime(30000);
      }

      const countBefore = MockWebSocket.instances.length;
      MockWebSocket.latest().simulateClose(1006);

      // At 29s, should not have reconnected yet
      vi.advanceTimersByTime(29000);
      expect(MockWebSocket.instances.length).toBe(countBefore);

      // At 30s, should reconnect
      vi.advanceTimersByTime(1000);
      expect(MockWebSocket.instances.length).toBe(countBefore + 1);
    });
  });

  // ── server.json-based discovery (T14) ───────────────────

  describe("discover (server.json mode)", () => {
    it("reads port+token from server.json and connects WS with ?token=", async () => {
      const reader = vi.fn().mockResolvedValue(JSON.stringify({
        pid: 1, port: 52355, graphRoot: "/g", version: "0.7.0",
        startedAt: new Date().toISOString(), token: "a".repeat(64),
      }));
      const client = new SidecarClient(
        MockWebSocket as unknown as typeof WebSocket,
        reader,
      );
      await client.discover({ graphRoot: "/g" });

      expect(reader).toHaveBeenCalledWith("/g");
      const ws = MockWebSocket.latest();
      expect(ws.url).toContain("token=" + "a".repeat(64));
      expect(ws.url).toContain("52355");
    });

    it("throws 'out of date' when server.json lacks token", async () => {
      const reader = vi.fn().mockResolvedValue(JSON.stringify({
        pid: 1, port: 52355, graphRoot: "/g", version: "0.6.0",
        startedAt: new Date().toISOString(),
      }));
      const client = new SidecarClient(
        MockWebSocket as unknown as typeof WebSocket,
        reader,
      );
      await expect(client.discover({ graphRoot: "/g" })).rejects.toThrow(
        /out of date/i,
      );
    });

    it("throws 'not running' when server.json is missing (ENOENT)", async () => {
      const reader = vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
        );
      const client = new SidecarClient(
        MockWebSocket as unknown as typeof WebSocket,
        reader,
      );
      await expect(client.discover({ graphRoot: "/g" })).rejects.toThrow(
        /not running/i,
      );
    });

    it("throws 'corrupted' when server.json is not valid JSON", async () => {
      const reader = vi.fn().mockResolvedValue("not-json{");
      const client = new SidecarClient(
        MockWebSocket as unknown as typeof WebSocket,
        reader,
      );
      await expect(client.discover({ graphRoot: "/g" })).rejects.toThrow(
        /corrupted/i,
      );
    });
  });

  // ── HTTP fetch methods ──────────────────────────────────

  describe("HTTP fetch methods", () => {
    // After T14, every authenticated REST call must send the bridge token
    // as `Authorization: Bearer <token>`. We populate the token by going
    // through `discover()` with an injected reader.
    const TOKEN = "a".repeat(64);

    function makeReader(port: number, token: string = TOKEN) {
      return vi.fn().mockResolvedValue(JSON.stringify({
        pid: 1, port, graphRoot: "/g", version: "0.7.0",
        startedAt: new Date().toISOString(), token,
      }));
    }

    it("fetchSettings sends Authorization header and returns settings", async () => {
      const client = new SidecarClient(
        MockWebSocket as unknown as typeof WebSocket,
        makeReader(52340),
      );
      await client.discover({ graphRoot: "/g" });
      MockWebSocket.latest().simulateOpen();

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ model: "opus", temperature: 0.7 }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await client.fetchSettings();
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:52340/settings",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${TOKEN}`,
          }),
        }),
      );
      expect(result).toEqual({ model: "opus", temperature: 0.7 });

      vi.unstubAllGlobals();
    });

    it("fetchSessions sends Authorization header and returns sessions", async () => {
      const client = new SidecarClient(
        MockWebSocket as unknown as typeof WebSocket,
        makeReader(52340),
      );
      await client.discover({ graphRoot: "/g" });
      MockWebSocket.latest().simulateOpen();

      const sessions = [{ id: "s1", title: "Session 1", lastModified: 1000 }];
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(sessions),
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await client.fetchSessions();
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:52340/sessions",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${TOKEN}`,
          }),
        }),
      );
      expect(result).toEqual(sessions);

      vi.unstubAllGlobals();
    });

    it("fetchCommands sends Authorization header and returns commands", async () => {
      const client = new SidecarClient(
        MockWebSocket as unknown as typeof WebSocket,
        makeReader(52340),
      );
      await client.discover({ graphRoot: "/g" });
      MockWebSocket.latest().simulateOpen();

      const commands = [{ name: "/help", description: "Show help" }];
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(commands),
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await client.fetchCommands();
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:52340/commands",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${TOKEN}`,
          }),
        }),
      );
      expect(result).toEqual(commands);

      vi.unstubAllGlobals();
    });

    it("throws when not connected and fetching", async () => {
      const client = createClient();
      await expect(client.fetchSettings()).rejects.toThrow(/not connected/i);
    });
  });
});
