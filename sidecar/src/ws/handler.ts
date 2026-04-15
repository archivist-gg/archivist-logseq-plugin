/**
 * WebSocket message handler — routes incoming ClientMessages to services.
 *
 * The query route is the most complex: it iterates the async generator from
 * ClaudianService.query() and maps StreamChunk types to ServerMessage types,
 * streaming each one over the WebSocket as it arrives.
 */

import type { WebSocket } from 'ws';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { query as agentQuery } from '@anthropic-ai/claude-agent-sdk';

import type {
  ClientMessage,
  QueryMessage,
  ServerMessage,
  ConnectionReadyMessage,
} from './protocol.js';
import type { SidecarServices } from '../services.js';
import type { StreamChunk, ExitPlanModeDecision, ClaudianMcpServer } from '../core/types/index.js';
import type { ClaudianSettings } from '../core/types/settings.js';
import type { PlanDecision } from '../services.js';
import { TITLE_GENERATION_SYSTEM_PROMPT } from '../core/prompts/titleGeneration.js';
import { createCustomSpawnFunction } from '../core/agent/customSpawn.js';

/** Map a StreamChunk from the agent SDK to a ServerMessage for the plugin. */
function chunkToMessage(chunk: StreamChunk): ServerMessage | null {
  switch (chunk.type) {
    case 'text':
      return {
        type: 'stream.text',
        text: chunk.content,
        parentToolUseId: chunk.parentToolUseId,
      };
    case 'thinking':
      return {
        type: 'stream.thinking',
        text: chunk.content,
        parentToolUseId: chunk.parentToolUseId,
      };
    case 'tool_use':
      return {
        type: 'stream.tool_use',
        id: chunk.id,
        name: chunk.name,
        input: chunk.input,
        parentToolUseId: chunk.parentToolUseId,
      };
    case 'tool_result':
      return {
        type: 'stream.tool_result',
        id: chunk.id,
        content: chunk.content,
        isError: chunk.isError,
        parentToolUseId: chunk.parentToolUseId,
        toolUseResult: chunk.toolUseResult,
      };
    case 'done':
      return { type: 'stream.done' };
    case 'error':
      return { type: 'stream.error', message: chunk.content };
    case 'blocked':
      return { type: 'stream.blocked', content: chunk.content };
    case 'usage':
      return {
        type: 'stream.usage',
        usage: chunk.usage,
        sessionId: chunk.sessionId,
      };
    case 'compact_boundary':
      return { type: 'stream.compact_boundary' };
    case 'sdk_user_uuid':
      return { type: 'stream.sdk_user_uuid', uuid: chunk.uuid };
    case 'sdk_user_sent':
      return { type: 'stream.sdk_user_sent', uuid: chunk.uuid };
    case 'sdk_assistant_uuid':
      return { type: 'stream.sdk_assistant_uuid', uuid: chunk.uuid };
    case 'context_window_update':
      return { type: 'stream.context_window', contextWindow: chunk.contextWindow };
    default:
      return null;
  }
}

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

/**
 * Handle a new WebSocket connection.
 * Sends connection.ready, then routes incoming messages to services.
 */
export function handleConnection(ws: WebSocket, services: SidecarServices): void {
  // Send connection ready
  const ready: ConnectionReadyMessage = {
    type: 'connection.ready',
    version: '0.1.0',
  };
  send(ws, ready);

  ws.on('message', (raw) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(String(raw)) as ClientMessage;
    } catch {
      send(ws, { type: 'stream.error', message: 'Invalid JSON' });
      return;
    }

    void routeMessage(ws, message, services);
  });
}

async function routeMessage(
  ws: WebSocket,
  message: ClientMessage,
  services: SidecarServices,
): Promise<void> {
  const tabId = message.tabId;

  try {
    switch (message.type) {
      case 'query':
        await handleQuery(ws, message, services);
        break;

      case 'interrupt':
        services.sessionRouter.get(tabId)?.cancel();
        break;

      case 'approve':
        services.pendingApprovals.resolve(message.toolCallId, 'allow');
        break;

      case 'deny':
        services.pendingApprovals.resolve(message.toolCallId, 'deny');
        break;

      case 'allow_always':
        services.pendingApprovals.resolve(message.toolCallId, 'allow-always', message.pattern);
        break;

      case 'session.list': {
        const sessions = await services.storage.sessions.listAllConversations();
        send(ws, {
          type: 'session.list_result',
          sessions: sessions.map((s) => ({
            id: s.id,
            title: s.title,
            lastModified: s.updatedAt,
            messageCount: s.messageCount,
          })),
        });
        break;
      }

      case 'session.resume': {
        const claudian = services.sessionRouter.getOrCreate(tabId);
        await claudian.ensureReady({ sessionId: message.sessionId });
        const conversation = await services.storage.sessions.loadConversation(message.sessionId);
        send(ws, {
          type: 'session.loaded',
          conversation: conversation ?? { id: message.sessionId, messages: [] },
          tabId,
        });
        break;
      }

      case 'session.fork': {
        const forkClaudian = services.sessionRouter.getOrCreate(tabId);
        const forkConv = await services.storage.sessions.loadConversation(message.sessionId);
        // Find the assistant UUID at the fork point for SDK resume
        if (forkConv && forkConv.messages[message.messageIndex]) {
          const forkMsg = forkConv.messages[message.messageIndex];
          if (forkMsg.sdkAssistantUuid) {
            forkClaudian.setPendingResumeAt(forkMsg.sdkAssistantUuid);
          }
        }
        forkClaudian.setPendingForkSession(true);
        await forkClaudian.ensureReady({ sessionId: message.sessionId });
        send(ws, {
          type: 'session.loaded',
          conversation: forkConv ?? { id: message.sessionId, messages: [] },
          tabId,
        });
        break;
      }

      case 'session.rewind': {
        const rewindClaudian = services.sessionRouter.getOrCreate(tabId);
        const rewindConv = await services.storage.sessions.loadConversation(message.sessionId);
        if (rewindConv && rewindConv.messages[message.messageIndex]) {
          const targetMsg = rewindConv.messages[message.messageIndex];
          if (targetMsg.sdkAssistantUuid) {
            rewindClaudian.setPendingResumeAt(targetMsg.sdkAssistantUuid);
          }
        }
        await rewindClaudian.ensureReady({ sessionId: message.sessionId });
        send(ws, {
          type: 'session.loaded',
          conversation: rewindConv ?? { id: message.sessionId, messages: [] },
          tabId,
        });
        break;
      }

      case 'session.rename': {
        // Update conversation title in storage
        const conv = await services.storage.sessions.loadConversation(message.sessionId);
        if (conv) {
          conv.title = message.title;
          conv.updatedAt = Date.now();
          await services.storage.sessions.saveConversation(conv);
        } else {
          // Try native metadata
          const meta = await services.storage.sessions.loadMetadata(message.sessionId);
          if (meta) {
            meta.title = message.title;
            meta.updatedAt = Date.now();
            await services.storage.sessions.saveMetadata(meta);
          }
        }
        break;
      }

      case 'title.generate':
        void handleTitleGenerate(ws, message, services);
        break;

      case 'settings.get': {
        const settings = services.getSettings();
        send(ws, {
          type: 'settings.current',
          claudian: settings as unknown as Record<string, unknown>,
          cc: {},
        });
        break;
      }

      case 'settings.update': {
        const patch = message.patch as Partial<ClaudianSettings>;
        const currentSettings = services.getSettings();
        Object.assign(currentSettings, patch);

        // Strip slashCommands (loaded separately) before persisting
        const { slashCommands: _, ...storable } = currentSettings;
        await services.storage.saveClaudianSettings(storable);

        send(ws, {
          type: 'settings.current',
          tabId,
          claudian: currentSettings as unknown as Record<string, unknown>,
          cc: {},
        });
        break;
      }

      case 'mcp.list': {
        const servers = services.mcp.getServers();
        send(ws, {
          type: 'mcp.list_result',
          tabId,
          servers: servers.map((s) => ({
            name: s.name,
            config: s.config as unknown as Record<string, unknown>,
            enabled: s.enabled,
            contextSaving: s.contextSaving,
            disabledTools: s.disabledTools,
            description: s.description,
          })),
        });
        break;
      }

      case 'mcp.update': {
        const updatedServers = message.config as unknown as ClaudianMcpServer[];
        if (Array.isArray(updatedServers)) {
          await services.storage.mcp.save(updatedServers);
          await services.mcp.loadServers();
          const refreshed = services.mcp.getServers();
          send(ws, {
            type: 'mcp.list_result',
            tabId,
            servers: refreshed.map((s) => ({
              name: s.name,
              config: s.config as unknown as Record<string, unknown>,
              enabled: s.enabled,
              contextSaving: s.contextSaving,
              disabledTools: s.disabledTools,
              description: s.description,
            })),
          });
        }
        break;
      }

      case 'command.list': {
        const commands = await services.storage.commands.loadAll();
        send(ws, {
          type: 'command.list_result',
          commands: commands.map((c) => ({
            name: c.name,
            description: c.description ?? '',
          })),
        });
        break;
      }

      case 'plan.approve':
        services.pendingPlanDecisions.resolve(message.toolCallId, { type: 'approve' });
        break;

      case 'plan.approve_new_session':
        services.pendingPlanDecisions.resolve(message.toolCallId, {
          type: 'approve_new_session',
          planContent: message.planContent,
        });
        break;

      case 'plan.feedback':
        services.pendingPlanDecisions.resolve(message.toolCallId, {
          type: 'feedback',
          text: message.text,
        });
        break;

      case 'askuser.answer':
        services.pendingAskUser.resolve(message.toolCallId, message.answers);
        break;

      case 'askuser.dismiss':
        services.pendingAskUser.resolve(message.toolCallId, null);
        break;

      case 'tab.destroy':
        services.sessionRouter.destroy(tabId);
        break;

      case 'bash.execute':
        void handleBashExecute(ws, message, services);
        break;

      case 'instruction.refine':
        // Instruction refinement uses a cold-start agent query
        send(ws, {
          type: 'instruction.refine_result',
          tabId,
          success: false,
          error: 'Instruction refinement not yet implemented in sidecar',
        });
        break;

      default:
        console.log(`[ws] unhandled message type: ${(message as { type: string }).type}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[ws] error handling ${message.type}:`, errorMessage);
    send(ws, { type: 'stream.error', message: errorMessage });
  }
}

async function handleQuery(
  ws: WebSocket,
  message: QueryMessage,
  services: SidecarServices,
): Promise<void> {
  try {
    const claudian = services.sessionRouter.getOrCreate(message.tabId);
    const tabId = message.tabId;

    // If a sessionId is provided, ensure the query is ready with that session
    if (message.sessionId) {
      await claudian.ensureReady({ sessionId: message.sessionId });
    }

    // Wire approval callback: forward to plugin via WebSocket, wait for response
    claudian.setApprovalCallback(async (toolName, input, description) => {
      const toolCallId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      send(ws, {
        type: 'approval.request',
        tabId,
        toolCallId,
        name: toolName,
        input,
        description,
      });
      return services.pendingApprovals.create(toolCallId);
    });

    // Wire ask-user-question callback: forward to plugin via WebSocket, wait for response
    claudian.setAskUserQuestionCallback(async (input) => {
      const toolCallId = `askuser-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      send(ws, {
        type: 'askuser.question',
        tabId,
        toolCallId,
        input,
      });
      return services.pendingAskUser.create(toolCallId);
    });

    // Wire exit-plan-mode callback: forward to plugin via WebSocket, wait for response
    claudian.setExitPlanModeCallback(async (input) => {
      const toolCallId = `planmode-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      send(ws, {
        type: 'plan_mode.request',
        tabId,
        toolCallId,
        input,
      });
      const decision: PlanDecision = await services.pendingPlanDecisions.create(toolCallId);
      return planDecisionToExitDecision(decision);
    });

    const generator = claudian.query(
      message.text,
      message.images, // forward attached images from client
      undefined, // conversationHistory (managed by persistent query)
      { mcpMentions: new Set<string>() },
    );

    for await (const chunk of generator) {
      const serverMessage = chunkToMessage(chunk);
      if (serverMessage) {
        serverMessage.tabId = tabId;
        send(ws, serverMessage);
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Query failed';
    send(ws, { type: 'stream.error', message: errorMessage, tabId: message.tabId });
    send(ws, { type: 'stream.done', tabId: message.tabId });
  }
}

/** Convert a PlanDecision (from WebSocket protocol) to an ExitPlanModeDecision (for SDK). */
function planDecisionToExitDecision(decision: PlanDecision): ExitPlanModeDecision {
  switch (decision.type) {
    case 'approve':
      return { type: 'approve' };
    case 'approve_new_session':
      return { type: 'approve-new-session', planContent: decision.planContent };
    case 'feedback':
      return { type: 'feedback', text: decision.text };
  }
}

/**
 * Handle title generation using Haiku model.
 *
 * Uses the Claude Agent SDK with a small, fast model (haiku) to generate
 * a concise conversation title from the user's first message.
 */
async function handleTitleGenerate(
  ws: WebSocket,
  message: { tabId: string; conversationId: string; userMessage: string },
  services: SidecarServices,
): Promise<void> {
  const tabId = message.tabId;
  const { conversationId, userMessage } = message;

  try {
    const settings = services.getSettings();

    // Resolve CLI path (same logic as services.ts)
    const os = await import('node:os');
    const hostname = os.hostname();
    const cliPath = settings.claudeCliPathsByHost[hostname]
      || settings.claudeCliPath
      || 'claude';

    // Get the appropriate model with fallback chain
    const titleModel = settings.titleGenerationModel || 'claude-haiku-4-5';

    // Parse environment variables for PATH enhancement
    const { parseEnvironmentVariables, getEnhancedPath } = await import('../core/utils/env.js');
    const envVars = parseEnvironmentVariables(settings.environmentVariables ?? '');
    const enhancedPath = getEnhancedPath(envVars.PATH, cliPath);

    // Truncate message to save tokens
    const truncated = userMessage.length > 500
      ? userMessage.substring(0, 500) + '...'
      : userMessage;

    const prompt = `User's request:\n"""\n${truncated}\n"""\n\nGenerate a title for this conversation:`;

    const options: Options = {
      cwd: services.graphRoot,
      systemPrompt: TITLE_GENERATION_SYSTEM_PROMPT,
      model: titleModel,
      pathToClaudeCodeExecutable: cliPath,
      env: {
        ...process.env,
        ...envVars,
        PATH: enhancedPath,
      },
      tools: [],
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      persistSession: false,
      spawnClaudeCodeProcess: createCustomSpawnFunction(cliPath),
    };

    const response = agentQuery({ prompt, options });
    let responseText = '';

    for await (const msg of response) {
      if (msg.type === 'assistant' && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text) {
            responseText += block.text;
          }
        }
      }
    }

    // Parse and clean the title
    let title = responseText.trim();
    if (!title) {
      send(ws, {
        type: 'title.result',
        tabId,
        conversationId,
        success: false,
        error: 'Empty response from title generation',
      });
      return;
    }

    // Remove surrounding quotes
    if (
      (title.startsWith('"') && title.endsWith('"')) ||
      (title.startsWith("'") && title.endsWith("'"))
    ) {
      title = title.slice(1, -1);
    }

    // Remove trailing punctuation
    title = title.replace(/[.!?:;,]+$/, '');

    // Truncate to max 50 characters
    if (title.length > 50) {
      title = title.substring(0, 47) + '...';
    }

    send(ws, {
      type: 'title.result',
      tabId,
      conversationId,
      success: true,
      title,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Title generation failed';
    console.error(`[ws] title generation error:`, errorMessage);
    send(ws, {
      type: 'title.result',
      tabId,
      conversationId,
      success: false,
      error: errorMessage,
    });
  }
}

/**
 * Handle direct bash command execution (bang-bash mode).
 *
 * This intentionally uses `exec` with a shell because the feature's
 * purpose is to let the *user* run arbitrary shell commands (pipes,
 * redirects, globs, etc.) — the same pattern as Obsidian's
 * BangBashService. The command string originates from explicit user
 * input via the `!` prefix, not from untrusted external data.
 */
async function handleBashExecute(
  ws: WebSocket,
  message: { tabId: string; id: string; command: string },
  services: SidecarServices,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- dynamic import for Node built-in
  const { exec } = await import('node:child_process');
  const tabId = message.tabId;

  const TIMEOUT_MS = 30_000;
  const MAX_BUFFER = 1024 * 1024; // 1MB

  return new Promise<void>((resolve) => {
    exec(message.command, {
      cwd: services.graphRoot,
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
    }, (error, stdout, stderr) => {
      let exitCode = 0;
      let errorMsg: string | undefined;

      if (error && 'killed' in error && error.killed) {
        const isMaxBuffer = 'code' in error && (error.code as unknown) === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
        exitCode = 124;
        errorMsg = isMaxBuffer
          ? 'Output exceeded maximum buffer size (1MB)'
          : `Command timed out after ${TIMEOUT_MS / 1000}s`;
      } else if (error) {
        exitCode = typeof error.code === 'number' ? error.code : 1;
      }

      const output = [stdout ?? '', stderr ?? ''].filter(Boolean).join('\n').trimEnd();

      send(ws, {
        type: 'bash.result',
        tabId,
        id: message.id,
        command: message.command,
        output,
        exitCode,
        error: errorMsg,
      });

      resolve();
    });
  });
}
