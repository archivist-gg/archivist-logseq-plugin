/**
 * WebSocket message handler — routes incoming ClientMessages to services.
 *
 * The query route is the most complex: it iterates the async generator from
 * ClaudianService.query() and maps StreamChunk types to ServerMessage types,
 * streaming each one over the WebSocket as it arrives.
 */

import type { WebSocket } from 'ws';

import type {
  ClientMessage,
  QueryMessage,
  ServerMessage,
  ConnectionReadyMessage,
} from './protocol.js';
import type { SidecarServices } from '../services.js';
import type { StreamChunk } from '../core/types/index.js';

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

      case 'session.resume':
        // Session resume will be fully wired in integration task
        console.log(`[ws] session.resume: ${message.sessionId}`);
        break;

      case 'session.fork':
        console.log(`[ws] session.fork: ${message.sessionId} at ${message.messageIndex}`);
        break;

      case 'session.rewind':
        console.log(`[ws] session.rewind: ${message.sessionId} at ${message.messageIndex}`);
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

      case 'settings.update':
        // Settings update will be wired in integration task
        console.log('[ws] settings.update:', Object.keys(message.patch));
        break;

      case 'mcp.list': {
        const servers = services.mcp.getServers();
        // Send as notification for now; full MCP list response in integration task
        console.log(`[ws] mcp.list: ${servers.length} servers`);
        break;
      }

      case 'mcp.update':
        console.log('[ws] mcp.update');
        break;

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

    // If a sessionId is provided, ensure the query is ready with that session
    if (message.sessionId) {
      await claudian.ensureReady({ sessionId: message.sessionId });
    }

    const generator = claudian.query(
      message.text,
      message.images, // forward attached images from client
      undefined, // conversationHistory (managed by persistent query)
      { mcpMentions: new Set<string>() },
    );

    for await (const chunk of generator) {
      const serverMessage = chunkToMessage(chunk);
      if (serverMessage) {
        serverMessage.tabId = message.tabId;
        send(ws, serverMessage);
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Query failed';
    send(ws, { type: 'stream.error', message: errorMessage, tabId: message.tabId });
    send(ws, { type: 'stream.done', tabId: message.tabId });
  }
}
