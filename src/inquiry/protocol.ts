// ──────────────────────────────────────────────────────────
// WebSocket Protocol Types — Sidecar <-> Plugin
// Defined once, copied to both sides (no shared package).
// Keep sidecar/src/ws/protocol.ts and src/inquiry/protocol.ts in sync.
// ──────────────────────────────────────────────────────────

// ── Supporting types ─────────────────────────────────────

export interface UsageInfo {
  model?: string;
  inputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  contextWindow: number;
  contextTokens: number;
  percentage: number;
}

export interface StructuredPatchHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface SDKToolUseResult {
  structuredPatch?: StructuredPatchHunk[];
  filePath?: string;
  [key: string]: unknown;
}

// ── Base types ──────────────────────────────────────────

export interface ClientMessageBase {
  tabId: string;
}

export interface ServerMessageBase {
  tabId?: string;
}

// ── Client -> Server messages ────────────────────────────

export interface QueryMessage extends ClientMessageBase {
  type: 'query';
  text: string;
  images?: string[];
  filePaths?: string[];
  editorSelection?: string;
  entityRefs?: string[];
  sessionId?: string;
}

export interface InterruptMessage extends ClientMessageBase {
  type: 'interrupt';
}

export interface ApproveMessage extends ClientMessageBase {
  type: 'approve';
  toolCallId: string;
}

export interface DenyMessage extends ClientMessageBase {
  type: 'deny';
  toolCallId: string;
}

export interface AllowAlwaysMessage extends ClientMessageBase {
  type: 'allow_always';
  toolCallId: string;
  pattern: string;
}

export interface SessionListMessage extends ClientMessageBase {
  type: 'session.list';
}

export interface SessionResumeMessage extends ClientMessageBase {
  type: 'session.resume';
  sessionId: string;
}

export interface SessionForkMessage extends ClientMessageBase {
  type: 'session.fork';
  sessionId: string;
  messageIndex: number;
}

export interface SessionRewindMessage extends ClientMessageBase {
  type: 'session.rewind';
  sessionId: string;
  messageIndex: number;
}

export interface SessionRenameMessage extends ClientMessageBase {
  type: 'session.rename';
  sessionId: string;
  title: string;
}

export interface SettingsGetMessage extends ClientMessageBase {
  type: 'settings.get';
}

export interface SettingsUpdateMessage extends ClientMessageBase {
  type: 'settings.update';
  patch: Record<string, unknown>;
}

export interface McpListMessage extends ClientMessageBase {
  type: 'mcp.list';
}

export interface McpUpdateMessage extends ClientMessageBase {
  type: 'mcp.update';
  config: Record<string, unknown>;
}

export interface CommandListMessage extends ClientMessageBase {
  type: 'command.list';
}

export interface PlanApproveMessage extends ClientMessageBase {
  type: 'plan.approve';
  toolCallId: string;
}

export interface PlanApproveNewSessionMessage extends ClientMessageBase {
  type: 'plan.approve_new_session';
  toolCallId: string;
  planContent: string;
}

export interface PlanFeedbackMessage extends ClientMessageBase {
  type: 'plan.feedback';
  toolCallId: string;
  text: string;
}

export interface AskUserAnswerMessage extends ClientMessageBase {
  type: 'askuser.answer';
  toolCallId: string;
  answers: Record<string, string>;
}

export interface AskUserDismissMessage extends ClientMessageBase {
  type: 'askuser.dismiss';
  toolCallId: string;
}

export interface TabDestroyMessage extends ClientMessageBase {
  type: 'tab.destroy';
}

export type ClientMessage =
  | QueryMessage
  | InterruptMessage
  | ApproveMessage
  | DenyMessage
  | AllowAlwaysMessage
  | SessionListMessage
  | SessionResumeMessage
  | SessionForkMessage
  | SessionRewindMessage
  | SessionRenameMessage
  | SettingsGetMessage
  | SettingsUpdateMessage
  | McpListMessage
  | McpUpdateMessage
  | CommandListMessage
  | PlanApproveMessage
  | PlanApproveNewSessionMessage
  | PlanFeedbackMessage
  | AskUserAnswerMessage
  | AskUserDismissMessage
  | TabDestroyMessage;

// ── Server -> Client messages ────────────────────────────

export interface StreamTextMessage extends ServerMessageBase {
  type: 'stream.text';
  text: string;
  parentToolUseId?: string | null;
}

export interface StreamThinkingMessage extends ServerMessageBase {
  type: 'stream.thinking';
  text: string;
  parentToolUseId?: string | null;
}

export interface StreamToolUseMessage extends ServerMessageBase {
  type: 'stream.tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
  parentToolUseId?: string | null;
}

export interface StreamToolResultMessage extends ServerMessageBase {
  type: 'stream.tool_result';
  id: string;
  content: string;
  isError?: boolean;
  parentToolUseId?: string | null;
  toolUseResult?: SDKToolUseResult;
}

export interface StreamDoneMessage extends ServerMessageBase {
  type: 'stream.done';
}

export interface StreamErrorMessage extends ServerMessageBase {
  type: 'stream.error';
  message: string;
}

export interface StreamBlockedMessage extends ServerMessageBase {
  type: 'stream.blocked';
  content: string;
}

export interface StreamUsageMessage extends ServerMessageBase {
  type: 'stream.usage';
  usage: UsageInfo;
  sessionId?: string | null;
}

export interface StreamSubagentMessage extends ServerMessageBase {
  type: 'stream.subagent';
  id: string;
  status: string;
  description?: string;
  result?: string;
}

export interface StreamCompactBoundaryMessage extends ServerMessageBase {
  type: 'stream.compact_boundary';
}

export interface StreamSdkUserUuidMessage extends ServerMessageBase {
  type: 'stream.sdk_user_uuid';
  uuid: string;
}

export interface StreamSdkUserSentMessage extends ServerMessageBase {
  type: 'stream.sdk_user_sent';
  uuid: string;
}

export interface StreamSdkAssistantUuidMessage extends ServerMessageBase {
  type: 'stream.sdk_assistant_uuid';
  uuid: string;
}

export interface StreamContextWindowMessage extends ServerMessageBase {
  type: 'stream.context_window';
  contextWindow: number;
}

export interface ApprovalRequestMessage extends ServerMessageBase {
  type: 'approval.request';
  toolCallId: string;
  name: string;
  input: Record<string, unknown>;
  description: string;
}

export interface PlanModeRequestMessage extends ServerMessageBase {
  type: 'plan_mode.request';
  toolCallId: string;
  input: Record<string, unknown>;
}

export interface AskUserQuestionMessage extends ServerMessageBase {
  type: 'askuser.question';
  toolCallId: string;
  input: Record<string, unknown>;
}

export interface SessionLoadedMessage extends ServerMessageBase {
  type: 'session.loaded';
  conversation: unknown;
}

export interface SessionListResultMessage extends ServerMessageBase {
  type: 'session.list_result';
  sessions: Array<{
    id: string;
    title: string;
    lastModified: number;
    messageCount: number;
  }>;
}

export interface SettingsCurrentMessage extends ServerMessageBase {
  type: 'settings.current';
  claudian: Record<string, unknown>;
  cc: Record<string, unknown>;
}

export interface McpListResultMessage extends ServerMessageBase {
  type: 'mcp.list_result';
  servers: Array<{
    name: string;
    config: Record<string, unknown>;
    enabled: boolean;
    contextSaving: boolean;
    disabledTools?: string[];
    description?: string;
  }>;
}

export interface CommandListResultMessage extends ServerMessageBase {
  type: 'command.list_result';
  commands: Array<{ name: string; description: string }>;
}

export interface NotificationMessage extends ServerMessageBase {
  type: 'notification';
  message: string;
  notificationType: 'info' | 'warning' | 'error';
}

export interface ConnectionReadyMessage extends ServerMessageBase {
  type: 'connection.ready';
  version: string;
}

export type ServerMessage =
  | StreamTextMessage
  | StreamThinkingMessage
  | StreamToolUseMessage
  | StreamToolResultMessage
  | StreamDoneMessage
  | StreamErrorMessage
  | StreamBlockedMessage
  | StreamUsageMessage
  | StreamSubagentMessage
  | StreamCompactBoundaryMessage
  | StreamSdkUserUuidMessage
  | StreamSdkUserSentMessage
  | StreamSdkAssistantUuidMessage
  | StreamContextWindowMessage
  | ApprovalRequestMessage
  | PlanModeRequestMessage
  | AskUserQuestionMessage
  | SessionLoadedMessage
  | SessionListResultMessage
  | SettingsCurrentMessage
  | McpListResultMessage
  | CommandListResultMessage
  | NotificationMessage
  | ConnectionReadyMessage;
