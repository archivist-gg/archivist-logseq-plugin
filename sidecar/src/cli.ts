#!/usr/bin/env node

/**
 * CLI entry point for the Archivist sidecar server.
 *
 * Usage:
 *   archivist --graph /path/to/logseq-graph [--port 52340]
 *
 * The sidecar:
 * 1. Validates the graph directory exists
 * 2. Creates .archivist/ if needed
 * 3. Initializes all services (storage, MCP, Claude agent)
 * 4. Starts Express + WebSocket server
 * 5. Writes a discovery file at <graphRoot>/.archivist/server.json
 * 6. Cleans up on SIGINT/SIGTERM
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';

import { createServer } from './server.js';
import { initializeServices } from './services.js';

// ── Arg parsing ───────────────────────────────────────────

interface CliArgs {
  graphRoot: string;
  port: number | null;
}

function parseArgs(argv: string[]): CliArgs {
  let graphRoot = '';
  let port: number | null = null;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === '--graph' || arg === '-g') && i + 1 < argv.length) {
      graphRoot = argv[++i];
    } else if ((arg === '--port' || arg === '-p') && i + 1 < argv.length) {
      port = parseInt(argv[++i], 10);
      if (isNaN(port)) {
        console.error(`[archivist] Invalid port: ${argv[i]}`);
        process.exit(1);
      }
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: archivist --graph <path> [--port <number>]');
      console.log('');
      console.log('Options:');
      console.log('  --graph, -g  Path to the Logseq graph directory (required)');
      console.log('  --port, -p   Port to listen on (default: auto 52340-52360)');
      console.log('  --help, -h   Show this help');
      process.exit(0);
    }
  }

  if (!graphRoot) {
    console.error('[archivist] --graph is required');
    console.error('Usage: archivist --graph <path> [--port <number>]');
    process.exit(1);
  }

  return { graphRoot: path.resolve(graphRoot), port };
}

// ── Port finding ──────────────────────────────────────────

const PORT_RANGE_START = 52340;
const PORT_RANGE_END = 52360;

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function findAvailablePort(preferredPort: number | null): Promise<number> {
  if (preferredPort !== null) {
    if (await isPortAvailable(preferredPort)) {
      return preferredPort;
    }
    console.error(`[archivist] Port ${preferredPort} is not available`);
    process.exit(1);
  }

  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }

  console.error(`[archivist] No available port in range ${PORT_RANGE_START}-${PORT_RANGE_END}`);
  process.exit(1);
}

// ── Discovery file ────────────────────────────────────────

interface DiscoveryFile {
  pid: number;
  port: number;
  graphRoot: string;
  version: string;
  startedAt: string;
  token: string;
}

function writeDiscoveryFile(graphRoot: string, port: number, token: string): string {
  const discoveryDir = path.join(graphRoot, '.archivist');
  fs.mkdirSync(discoveryDir, { recursive: true });

  const discoveryPath = path.join(discoveryDir, 'server.json');
  const discovery: DiscoveryFile = {
    pid: process.pid,
    port,
    graphRoot,
    version: '0.7.0',
    startedAt: new Date().toISOString(),
    token,
  };

  fs.writeFileSync(
    discoveryPath,
    JSON.stringify(discovery, null, 2),
    { mode: 0o600 },
  );
  // writeFileSync's `mode` option is only applied when the file is created;
  // if it already exists from a previous run, the old mode is preserved.
  // chmodSync forces 0o600 unconditionally so the token file is owner-only
  // on every run. No-op on Windows.
  try {
    fs.chmodSync(discoveryPath, 0o600);
  } catch {
    // Best-effort — don't fail startup over a chmod failure.
  }
  return discoveryPath;
}

function removeDiscoveryFile(graphRoot: string): void {
  const discoveryPath = path.join(graphRoot, '.archivist', 'server.json');
  try {
    fs.unlinkSync(discoveryPath);
  } catch {
    // Already removed or never written
  }
}

// ── Main ──────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  // Validate graph directory
  if (!fs.existsSync(args.graphRoot)) {
    console.error(`[archivist] Graph directory does not exist: ${args.graphRoot}`);
    process.exit(1);
  }

  // Ensure .archivist/ exists
  const archivistDir = path.join(args.graphRoot, '.archivist');
  fs.mkdirSync(archivistDir, { recursive: true });

  console.log(`[archivist] Initializing services for graph: ${args.graphRoot}`);

  // Initialize services
  const services = await initializeServices(args.graphRoot);

  // Generate per-process auth token (256 bits of crypto randomness)
  const token = crypto.randomBytes(32).toString('hex');

  // Find port and create server
  const port = await findAvailablePort(args.port);
  const { server } = createServer(args.graphRoot, services, token);

  // Start listening
  server.listen(port, '127.0.0.1', () => {
    const discoveryPath = writeDiscoveryFile(args.graphRoot, port, token);
    console.log(`[archivist] Server listening on http://127.0.0.1:${port}`);
    console.log(`[archivist] Discovery file: ${discoveryPath}`);
    console.log(`[archivist] WebSocket: ws://127.0.0.1:${port}`);
    console.log(`[archivist] Health: http://127.0.0.1:${port}/health`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[archivist] Shutting down...');
    removeDiscoveryFile(args.graphRoot);
    server.close(() => {
      console.log('[archivist] Server closed');
      process.exit(0);
    });
    // Force exit after 5 seconds if graceful shutdown stalls
    setTimeout(() => {
      console.error('[archivist] Forced exit after timeout');
      process.exit(1);
    }, 5000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('[archivist] Fatal error:', error);
  process.exit(1);
});
