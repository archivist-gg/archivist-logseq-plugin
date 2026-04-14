/**
 * Service coordinator — wires core services together for the sidecar.
 *
 * Creates and initializes StorageService, McpServerManager, PluginManager,
 * AgentManager, and ClaudianService with a SidecarContext that adapts to
 * the headless Node.js environment.
 */

import * as os from 'node:os';
import * as path from 'node:path';

import { NotificationEmitter } from './adapter/index.js';
import { ClaudianService, type ApprovalDecision } from './core/agent/ClaudianService.js';
import { AgentManager } from './core/agents/AgentManager.js';
import { McpServerManager } from './core/mcp/index.js';
import { PluginManager } from './core/plugins/PluginManager.js';
import { StorageService } from './core/storage/StorageService.js';
import type { ClaudianSettings } from './core/types/settings.js';
import type { SidecarContext } from './core/agent/ClaudianService.js';
import type { ExitPlanModeDecision } from './core/types/index.js';

// ── Pending callback registry ─────────────────────────────

export type PlanDecision =
  | { type: 'approve' }
  | { type: 'approve_new_session'; planContent: string }
  | { type: 'feedback'; text: string };

/**
 * Generic pending callback registry for approval-style interactions.
 * WebSocket handler resolves promises by toolCallId when the plugin responds.
 */
export class PendingCallbackRegistry<T> {
  private pending = new Map<string, {
    resolve: (value: T) => void;
    reject: (error: Error) => void;
  }>();

  /**
   * Create a promise that will be resolved when the plugin sends a response
   * for the given toolCallId.
   */
  create(toolCallId: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.set(toolCallId, { resolve, reject });
    });
  }

  /**
   * Resolve a pending callback with the given value.
   * For ApprovalDecision, pass the pattern as a third argument for allow-always.
   */
  resolve(toolCallId: string, ...args: unknown[]): void {
    const entry = this.pending.get(toolCallId);
    if (entry) {
      this.pending.delete(toolCallId);
      entry.resolve(args.length === 1 ? args[0] as T : args as unknown as T);
    }
  }

  reject(toolCallId: string, error: Error): void {
    const entry = this.pending.get(toolCallId);
    if (entry) {
      this.pending.delete(toolCallId);
      entry.reject(error);
    }
  }

  clear(): void {
    for (const [, entry] of this.pending) {
      entry.reject(new Error('Registry cleared'));
    }
    this.pending.clear();
  }
}

// ── Service interfaces ────────────────────────────────────

export interface SidecarServices {
  storage: StorageService;
  claudian: ClaudianService & {
    /** Proxy to the context's getSettings for the handler. */
    getSettings(): ClaudianSettings;
  };
  mcp: McpServerManager;
  notifications: NotificationEmitter;
  pendingApprovals: PendingCallbackRegistry<ApprovalDecision>;
  pendingPlanDecisions: PendingCallbackRegistry<PlanDecision>;
  pendingAskUser: PendingCallbackRegistry<Record<string, string> | null>;
  /** Current settings accessor. */
  getSettings(): ClaudianSettings;
}

// ── Initialization ────────────────────────────────────────

/**
 * Resolve the Claude CLI path from settings or common install locations.
 */
function resolveClaudeCliPath(settings: ClaudianSettings): string {
  // Check hostname-based paths first
  const hostname = os.hostname();
  if (settings.claudeCliPathsByHost[hostname]) {
    return settings.claudeCliPathsByHost[hostname];
  }

  // Fallback to legacy path
  if (settings.claudeCliPath) {
    return settings.claudeCliPath;
  }

  // Default: assume `claude` is on PATH
  return 'claude';
}

/**
 * Initialize all sidecar services.
 *
 * @param graphRoot Absolute path to the Logseq graph root directory.
 * @returns Fully initialized SidecarServices.
 */
export async function initializeServices(
  graphRoot: string,
): Promise<SidecarServices> {
  const notifications = new NotificationEmitter();

  // 1. Storage (settings, sessions, commands, MCP configs)
  const storage = new StorageService(graphRoot, notifications);
  const combinedSettings = await storage.initialize();

  // Mutable settings reference — updated via settings.update messages
  let currentSettings: ClaudianSettings = {
    ...combinedSettings.claudian,
    // Overlay defaults for fields that ClaudianSettingsStorage may not have stored
    slashCommands: [],
  } as ClaudianSettings;

  // Load slash commands separately
  const commands = await storage.commands.loadAll();
  currentSettings = { ...currentSettings, slashCommands: commands };

  // 2. MCP server manager
  const mcp = new McpServerManager(storage.mcp);
  await mcp.loadServers();

  // 3. Plugin manager
  const pluginManager = new PluginManager(graphRoot, storage.ccSettings);
  await pluginManager.loadPlugins();

  // 4. Agent manager
  const agentManager = new AgentManager(graphRoot, pluginManager);
  await agentManager.loadAgents();

  // 5. Pending callback registries
  const pendingApprovals = new PendingCallbackRegistry<ApprovalDecision>();
  const pendingPlanDecisions = new PendingCallbackRegistry<PlanDecision>();
  const pendingAskUser = new PendingCallbackRegistry<Record<string, string> | null>();

  // 6. Build SidecarContext for ClaudianService
  const context: SidecarContext = {
    vaultPath: graphRoot,
    notifications,
    getSettings: () => currentSettings,
    getResolvedClaudeCliPath: () => resolveClaudeCliPath(currentSettings),
    getActiveEnvironmentVariables: () => currentSettings.environmentVariables ?? '',
    getStorageService: () => storage,
    pluginManager,
    agentManager,
    archivistMcpServer: null,
    getArchivistSettings: () => ({}),
  };

  // 7. ClaudianService
  const claudian = new ClaudianService(context, mcp);

  // Wire approval callback to route through the pending registry
  // (The actual wiring of approvalCallback, askUserCallback, etc.
  //  will be completed in the integration task when we have the
  //  broadcast function available.)

  // Create a proxy that also exposes getSettings
  const claudianProxy = Object.assign(claudian, {
    getSettings: () => currentSettings,
  });

  return {
    storage,
    claudian: claudianProxy,
    mcp,
    notifications,
    pendingApprovals,
    pendingPlanDecisions,
    pendingAskUser,
    getSettings: () => currentSettings,
  };
}
