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

// ── Client -> Server messages ────────────────────────────

export interface QueryMessage {
  type: 'query';
  text: string;
  images?: string[];
  filePaths?: string[];
  editorSelection?: string;
  entityRefs?: string[];
  sessionId?: string;
}

export interface InterruptMessage {
  type: 'interrupt';
}

export interface ApproveMessage {
  type: 'approve';
  toolCallId: string;
}

export interface DenyMessage {
  type: 'deny';
  toolCallId: string;
}

export interface AllowAlwaysMessage {
  type: 'allow_always';
  toolCallId: string;
  pattern: string;
}

export interface SessionListMessage {
  type: 'session.list';
}

export interface SessionResumeMessage {
  type: 'session.resume';
  sessionId: string;
}

export interface SessionForkMessage {
  type: 'session.fork';
  sessionId: string;
  messageIndex: number;
}

export interface SessionRewindMessage {
  type: 'session.rewind';
  sessionId: string;
  messageIndex: number;
}

export interface SettingsGetMessage {
  type: 'settings.get';
}

export interface SettingsUpdateMessage {
  type: 'settings.update';
  patch: Record<string, unknown>;
}

export interface McpListMessage {
  type: 'mcp.list';
}

export interface McpUpdateMessage {
  type: 'mcp.update';
  config: Record<string, unknown>;
}

export interface CommandListMessage {
  type: 'command.list';
}

export interface PlanApproveMessage {
  type: 'plan.approve';
  toolCallId: string;
}

export interface PlanApproveNewSessionMessage {
  type: 'plan.approve_new_session';
  toolCallId: string;
  planContent: string;
}

export interface PlanFeedbackMessage {
  type: 'plan.feedback';
  toolCallId: string;
  text: string;
}

export interface AskUserAnswerMessage {
  type: 'askuser.answer';
  toolCallId: string;
  answers: Record<string, string>;
}

export interface AskUserDismissMessage {
  type: 'askuser.dismiss';
  toolCallId: string;
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
  | SettingsGetMessage
  | SettingsUpdateMessage
  | McpListMessage
  | McpUpdateMessage
  | CommandListMessage
  | PlanApproveMessage
  | PlanApproveNewSessionMessage
  | PlanFeedbackMessage
  | AskUserAnswerMessage
  | AskUserDismissMessage;

// ── Server -> Client messages ────────────────────────────

export interface StreamTextMessage {
  type: 'stream.text';
  text: string;
  parentToolUseId?: string | null;
}

export interface StreamThinkingMessage {
  type: 'stream.thinking';
  text: string;
  parentToolUseId?: string | null;
}

export interface StreamToolUseMessage {
  type: 'stream.tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
  parentToolUseId?: string | null;
}

export interface StreamToolResultMessage {
  type: 'stream.tool_result';
  id: string;
  content: string;
  isError?: boolean;
  parentToolUseId?: string | null;
  toolUseResult?: SDKToolUseResult;
}

export interface StreamDoneMessage {
  type: 'stream.done';
}

export interface StreamErrorMessage {
  type: 'stream.error';
  message: string;
}

export interface StreamBlockedMessage {
  type: 'stream.blocked';
  content: string;
}

export interface StreamUsageMessage {
  type: 'stream.usage';
  usage: UsageInfo;
  sessionId?: string | null;
}

export interface StreamSubagentMessage {
  type: 'stream.subagent';
  id: string;
  status: string;
  description?: string;
  result?: string;
}

export interface StreamCompactBoundaryMessage {
  type: 'stream.compact_boundary';
}

export interface StreamSdkUserUuidMessage {
  type: 'stream.sdk_user_uuid';
  uuid: string;
}

export interface StreamSdkUserSentMessage {
  type: 'stream.sdk_user_sent';
  uuid: string;
}

export interface StreamSdkAssistantUuidMessage {
  type: 'stream.sdk_assistant_uuid';
  uuid: string;
}

export interface StreamContextWindowMessage {
  type: 'stream.context_window';
  contextWindow: number;
}

export interface ApprovalRequestMessage {
  type: 'approval.request';
  toolCallId: string;
  name: string;
  input: Record<string, unknown>;
  description: string;
}

export interface PlanModeRequestMessage {
  type: 'plan_mode.request';
  toolCallId: string;
  plan: Record<string, unknown>;
}

export interface AskUserQuestionMessage {
  type: 'askuser.question';
  toolCallId: string;
  question: string;
  header: string;
  options: Array<{ label: string; description: string }>;
  multiSelect: boolean;
}

export interface SessionLoadedMessage {
  type: 'session.loaded';
  conversation: unknown;
}

export interface SessionListResultMessage {
  type: 'session.list_result';
  sessions: Array<{
    id: string;
    title: string;
    lastModified: number;
    messageCount: number;
  }>;
}

export interface SettingsCurrentMessage {
  type: 'settings.current';
  claudian: Record<string, unknown>;
  cc: Record<string, unknown>;
}

export interface CommandListResultMessage {
  type: 'command.list_result';
  commands: Array<{ name: string; description: string }>;
}

export interface NotificationMessage {
  type: 'notification';
  message: string;
  notificationType: 'info' | 'warning' | 'error';
}

export interface ConnectionReadyMessage {
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
  | CommandListResultMessage
  | NotificationMessage
  | ConnectionReadyMessage;
