/**
 * Express + WebSocket server for the Archivist sidecar.
 *
 * Provides:
 * - REST endpoints for health, settings, sessions, MCP, and commands
 * - WebSocket server for real-time streaming communication with the plugin
 */

import express from 'express';
import { createServer as createHttpServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

import type { ServerMessage } from './ws/protocol.js';
import { handleConnection } from './ws/handler.js';
import type { SidecarServices } from './services.js';

export interface ServerInstance {
  app: express.Application;
  server: ReturnType<typeof createHttpServer>;
  wss: WebSocketServer;
  /** Broadcast a message to all connected WebSocket clients. */
  broadcast: (message: ServerMessage) => void;
}

export function createServer(
  graphRoot: string,
  services: SidecarServices,
  token: string,
): ServerInstance {
  const app = express();
  app.use(express.json());

  // ── REST endpoints ──────────────────────────────────────

  app.get('/health', (_req, res) => {
    res.json({ service: 'archivist', graphRoot, version: '0.1.0' });
  });

  app.get('/settings', async (_req, res) => {
    try {
      const settings = services.getSettings();
      res.json({ claudian: settings, cc: {} });
    } catch (error) {
      res.status(500).json({ error: 'Failed to load settings' });
    }
  });

  app.post('/settings', async (req, res) => {
    try {
      const patch = req.body as Record<string, unknown>;
      // Settings update will be wired in integration task
      res.json({ ok: true, patch });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update settings' });
    }
  });

  app.get('/sessions', async (_req, res) => {
    try {
      const sessions = await services.storage.sessions.listAllConversations();
      res.json({ sessions });
    } catch (error) {
      res.status(500).json({ error: 'Failed to list sessions' });
    }
  });

  app.get('/mcp/servers', async (_req, res) => {
    try {
      const servers = services.mcp.getServers();
      res.json({ servers });
    } catch (error) {
      res.status(500).json({ error: 'Failed to list MCP servers' });
    }
  });

  app.post('/mcp/test', async (req, res) => {
    try {
      // MCP test will be wired in integration task
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to test MCP server' });
    }
  });

  app.get('/commands', async (_req, res) => {
    try {
      const commands = await services.storage.commands.loadAll();
      res.json({ commands });
    } catch (error) {
      res.status(500).json({ error: 'Failed to list commands' });
    }
  });

  // ── Tab state persistence ──────────────────────────────

  const TABS_STATE_PATH = '.archivist/tabs.json';

  app.get('/tabs/state', async (_req, res) => {
    try {
      const adapter = services.storage.getAdapter();
      if (await adapter.exists(TABS_STATE_PATH)) {
        const content = await adapter.read(TABS_STATE_PATH);
        const state = JSON.parse(content);
        res.json(state);
      } else {
        res.json(null);
      }
    } catch (error) {
      res.status(500).json({ error: 'Failed to load tab state' });
    }
  });

  app.post('/tabs/state', async (req, res) => {
    try {
      const adapter = services.storage.getAdapter();
      await adapter.write(TABS_STATE_PATH, JSON.stringify(req.body, null, 2));
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to save tab state' });
    }
  });

  // ── HTTP + WebSocket server ─────────────────────────────

  const server = createHttpServer(app);
  const wss = new WebSocketServer({ server });

  const clients = new Set<WebSocket>();

  function broadcast(message: ServerMessage): void {
    const data = JSON.stringify(message);
    for (const client of clients) {
      if (client.readyState === client.OPEN) {
        client.send(data);
      }
    }
  }

  wss.on('connection', (ws) => {
    clients.add(ws);

    ws.on('close', () => {
      clients.delete(ws);
    });

    handleConnection(ws, services);
  });

  // Forward notifications to all connected clients
  services.notifications.onNotification((message, notificationType) => {
    broadcast({ type: 'notification', message, notificationType });
  });

  return { app, server, wss, broadcast };
}
