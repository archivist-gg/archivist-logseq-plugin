/**
 * Integration tests for the WebSocket handshake auth.
 *
 * Each connection MUST present:
 *   1. An `Origin` header in `ALLOWED_ORIGINS`, AND
 *   2. A `?token=<bridge-token>` query string matching the configured token.
 *
 * If either check fails the upgrade is rejected at the handshake (HTTP 401)
 * and no `connection` event ever fires on the WebSocketServer.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import WebSocket from 'ws';

import { createServer } from '../../src/server.js';
import type { SidecarServices } from '../../src/services.js';
import { NotificationEmitter } from '../../src/adapter/index.js';
import { ALLOWED_ORIGINS } from '../../src/auth.js';

const TOKEN = 'a'.repeat(64);

/**
 * Build a minimal mock SidecarServices — same approach as server.test.ts.
 * The WS auth gate runs at the handshake, so no actual message handling is
 * exercised; the underlying services don't need to be fully functional.
 */
function createMockServices(): SidecarServices {
  const notifications = new NotificationEmitter();

  return {
    notifications,
    getSettings: () => ({}) as ReturnType<SidecarServices['getSettings']>,
    storage: {
      sessions: { listAllConversations: async () => [] },
      commands: { loadAll: async () => [] },
      getAdapter: () => ({
        exists: async () => false,
        read: async () => '',
        write: async () => {},
      }),
    },
    mcp: { getServers: () => [] },
    pendingApprovals: {
      create: async () => 'allow' as const,
      resolve: () => {},
      reject: () => {},
      clear: () => {},
    },
    pendingPlanDecisions: {
      create: async () => ({ type: 'approve' as const }),
      resolve: () => {},
      reject: () => {},
      clear: () => {},
    },
    pendingAskUser: {
      create: async () => null,
      resolve: () => {},
      reject: () => {},
      clear: () => {},
    },
  } as unknown as SidecarServices;
}

interface TestBridgeCtx {
  graphRoot: string;
  server: ReturnType<typeof createServer>['server'];
  port: number;
  allowedOrigin: string;
}

async function startTestBridge(): Promise<TestBridgeCtx> {
  const graphRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bridge-ws-auth-'));
  const services = createMockServices();
  const { server } = createServer(graphRoot, services, TOKEN);
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve()),
  );
  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('unexpected address');
  }
  const allowedOrigin = Array.from(ALLOWED_ORIGINS)[0];
  if (!allowedOrigin) {
    throw new Error('ALLOWED_ORIGINS is empty — cannot run WS auth tests');
  }
  return { graphRoot, server, port: addr.port, allowedOrigin };
}

/**
 * Open a WebSocket and report whether the handshake succeeded (`opened: true`)
 * or was rejected (`opened: false`). Resolves on first terminal event so each
 * test completes quickly.
 */
function connect(
  url: string,
  origin: string | undefined,
): Promise<{ opened: boolean }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, {
      headers: origin ? { Origin: origin } : {},
    });
    let opened = false;
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      resolve({ opened });
    };
    ws.on('open', () => {
      opened = true;
      ws.close();
      settle();
    });
    ws.on('unexpected-response', () => settle());
    ws.on('error', () => settle());
    ws.on('close', () => settle());
  });
}

describe('WebSocket auth', () => {
  let ctx: TestBridgeCtx;

  beforeAll(async () => {
    ctx = await startTestBridge();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => ctx.server.close(() => resolve()));
    await fs.rm(ctx.graphRoot, { recursive: true, force: true });
  });

  it('rejects missing token (correct origin)', async () => {
    const r = await connect(
      `ws://127.0.0.1:${ctx.port}`,
      ctx.allowedOrigin,
    );
    expect(r.opened).toBe(false);
  });

  it('rejects wrong token (correct origin)', async () => {
    const r = await connect(
      `ws://127.0.0.1:${ctx.port}?token=nope`,
      ctx.allowedOrigin,
    );
    expect(r.opened).toBe(false);
  });

  it('rejects correct token + disallowed origin', async () => {
    const r = await connect(
      `ws://127.0.0.1:${ctx.port}?token=${TOKEN}`,
      'https://evil.example',
    );
    expect(r.opened).toBe(false);
  });

  it('rejects missing origin', async () => {
    const r = await connect(
      `ws://127.0.0.1:${ctx.port}?token=${TOKEN}`,
      undefined,
    );
    expect(r.opened).toBe(false);
  });

  it('accepts correct token + allowed origin', async () => {
    const r = await connect(
      `ws://127.0.0.1:${ctx.port}?token=${TOKEN}`,
      ctx.allowedOrigin,
    );
    expect(r.opened).toBe(true);
  });
});
