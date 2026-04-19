import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Server } from 'node:http';
import { createServer } from '../src/server.js';
import type { SidecarServices } from '../src/services.js';
import { NotificationEmitter } from '../src/adapter/index.js';

/**
 * Build a minimal mock SidecarServices for testing the HTTP layer.
 * Only the parts accessed by REST endpoints need to be present.
 */
function createMockServices(): SidecarServices {
  const notifications = new NotificationEmitter();

  return {
    notifications,
    getSettings: () => ({}) as ReturnType<SidecarServices['getSettings']>,
    storage: {
      sessions: {
        listAllConversations: async () => [],
      },
      commands: {
        loadAll: async () => [],
      },
    },
    mcp: {
      getServers: () => [],
    },
    claudian: {
      getSettings: () => ({}) as ReturnType<SidecarServices['getSettings']>,
      query: async function* () {},
      cancel: () => {},
      ensureReady: async () => false,
    },
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

describe('Server', () => {
  let tmpDir: string;
  let server: Server;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('GET /health returns service info', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archivist-test-'));
    const services = createMockServices();
    const instance = createServer(tmpDir, services, 'test-token');
    server = instance.server;

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('unexpected address');

    const res = await fetch(`http://127.0.0.1:${addr.port}/health`, {
      headers: { Authorization: 'Bearer test-token' },
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({
      service: 'archivist',
      graphRoot: tmpDir,
      version: '0.1.0',
    });
  });

  it('GET /sessions returns empty list', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archivist-test-'));
    const services = createMockServices();
    const instance = createServer(tmpDir, services, 'test-token');
    server = instance.server;

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('unexpected address');

    const res = await fetch(`http://127.0.0.1:${addr.port}/sessions`, {
      headers: { Authorization: 'Bearer test-token' },
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({ sessions: [] });
  });

  it('GET /commands returns empty list', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archivist-test-'));
    const services = createMockServices();
    const instance = createServer(tmpDir, services, 'test-token');
    server = instance.server;

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('unexpected address');

    const res = await fetch(`http://127.0.0.1:${addr.port}/commands`, {
      headers: { Authorization: 'Bearer test-token' },
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({ commands: [] });
  });

  it('GET /health without Authorization header returns 401', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archivist-test-'));
    const services = createMockServices();
    const instance = createServer(tmpDir, services, 'test-token');
    server = instance.server;

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('unexpected address');

    const res = await fetch(`http://127.0.0.1:${addr.port}/health`);
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body).toEqual({ error: 'unauthorized' });
  });

  it('GET /health with wrong Bearer token returns 401', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archivist-test-'));
    const services = createMockServices();
    const instance = createServer(tmpDir, services, 'test-token');
    server = instance.server;

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('unexpected address');

    const res = await fetch(`http://127.0.0.1:${addr.port}/health`, {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body).toEqual({ error: 'unauthorized' });
  });

  it('GET /health with correct Bearer token returns 200', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archivist-test-'));
    const services = createMockServices();
    const instance = createServer(tmpDir, services, 'test-token');
    server = instance.server;

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('unexpected address');

    const res = await fetch(`http://127.0.0.1:${addr.port}/health`, {
      headers: { Authorization: 'Bearer test-token' },
    });
    expect(res.status).toBe(200);
  });
});
