/**
 * Chat state types — adapted from Obsidian's inquiry state types.
 *
 * Obsidian-specific types (CM6 EditorView, DOM ranges, Obsidian selection
 * contexts) have been removed. DOM element references are kept as
 * `HTMLElement | null` since the Logseq plugin also renders to the DOM
 * via an iframe-based panel.
 */

import type { UsageInfo } from '../protocol';

// ── Image types ──────────────────────────────────────────

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export interface ImageAttachment {
  id: string;
  name: string;
  mediaType: ImageMediaType;
  /** Base64 encoded image data - single source of truth. */
  data: string;
  width?: number;
  height?: number;
  size: number;
  source: 'file' | 'paste' | 'drop';
}

// ── Tool types ───────────────────────────────────────────

export interface ToolDiffData {
  filePath: string;
  diffLines: DiffLine[];
  stats: DiffStats;
}

export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  oldLine?: number;
  newLine?: number;
}

export interface DiffStats {
  additions: number;
  deletions: number;
}

export interface ToolCallInfo {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: 'running' | 'completed' | 'error' | 'blocked';
  result?: string;
  isExpanded?: boolean;
  diffData?: ToolDiffData;
  subagent?: SubagentInfo;
}

export type SubagentMode = 'sync' | 'async';

export type AsyncSubagentStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'error'
  | 'orphaned';

export interface SubagentInfo {
  id: string;
  description: string;
  prompt?: string;
  mode?: SubagentMode;
  isExpanded: boolean;
  result?: string;
  status: 'running' | 'completed' | 'error';
  toolCalls: ToolCallInfo[];
  asyncStatus?: AsyncSubagentStatus;
  agentId?: string;
  outputToolId?: string;
  startedAt?: number;
  completedAt?: number;
}

// ── Content blocks ───────────────────────────────────────

export type ContentBlock =
  | { type: 'text'; content: string }
  | { type: 'tool_use'; toolId: string }
  | { type: 'thinking'; content: string; durationSeconds?: number }
  | { type: 'subagent'; subagentId: string; mode?: SubagentMode }
  | { type: 'compact_boundary' };

// ── Chat message types ───────────────────────────────────

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Display-only content (e.g., "/tests" when content is the expanded prompt). */
  displayContent?: string;
  timestamp: number;
  toolCalls?: ToolCallInfo[];
  contentBlocks?: ContentBlock[];
  currentNote?: string;
  images?: ImageAttachment[];
  /** True if this message represents a user interrupt. */
  isInterrupt?: boolean;
  /** True if this message is rebuilt context sent on session reset (should be hidden). */
  isRebuiltContext?: boolean;
  /** Duration in seconds from user send to response completion. */
  durationSeconds?: number;
  /** Flavor word used for duration display (e.g., "Baked", "Cooked"). */
  durationFlavorWord?: string;
  /** SDK user message UUID for rewind. */
  sdkUserUuid?: string;
  /** SDK assistant message UUID for resumeSessionAt. */
  sdkAssistantUuid?: string;
}

// ── Conversation types ───────────────────────────────────

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastResponseAt?: number;
  sessionId: string | null;
  sdkSessionId?: string;
  previousSdkSessionIds?: string[];
  messages: ChatMessage[];
  currentNote?: string;
  usage?: UsageInfo;
  titleGenerationStatus?: 'pending' | 'success' | 'failed';
  isNative?: boolean;
  legacyCutoffAt?: number;
  sdkMessagesLoaded?: boolean;
  subagentData?: Record<string, SubagentInfo>;
  resumeSessionAt?: string;
}

export interface ConversationMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastResponseAt?: number;
  messageCount: number;
  preview: string;
  titleGenerationStatus?: 'pending' | 'success' | 'failed';
  isNative?: boolean;
}

// ── Todo items ───────────────────────────────────────────

export interface TodoItem {
  /** Imperative description (e.g., "Run tests") */
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  /** Present continuous form (e.g., "Running tests") */
  activeForm: string;
}

// ── Queued / pending types ───────────────────────────────

/** Queued message waiting to be sent after current streaming completes. */
export interface QueuedMessage {
  content: string;
  images?: ImageAttachment[];
}

/** Pending tool call waiting to be rendered (buffered until input is complete). */
export interface PendingToolCall {
  toolCall: ToolCallInfo;
  parentEl: HTMLElement | null;
}

/** Stored selection state from editor polling. */
export interface StoredSelection {
  notePath: string;
  selectedText: string;
  lineCount: number;
  startLine?: number;
  from?: number;
  to?: number;
}

// ── Thinking / Write-Edit rendering state ────────────────

export interface ThinkingBlockState {
  wrapperEl: HTMLElement;
  contentEl: HTMLElement;
  labelEl: HTMLElement;
  content: string;
  startTime: number;
  timerInterval: ReturnType<typeof setInterval> | null;
  isExpanded: boolean;
}

export interface WriteEditState {
  wrapperEl: HTMLElement;
  contentEl: HTMLElement;
  headerEl: HTMLElement;
  nameEl: HTMLElement;
  summaryEl: HTMLElement;
  statsEl: HTMLElement;
  statusEl: HTMLElement;
  toolCall: ToolCallInfo;
  isExpanded: boolean;
  diffLines?: DiffLine[];
}

// ── Chat state data ──────────────────────────────────────

/** Permission mode for tool approval. */
export type PermissionMode = 'default' | 'plan' | 'yolo';

/** Centralized chat state data. */
export interface ChatStateData {
  // Message state
  messages: ChatMessage[];

  // Streaming control
  isStreaming: boolean;
  cancelRequested: boolean;
  streamGeneration: number;
  /** Guards against concurrent operations during conversation creation. */
  isCreatingConversation: boolean;
  /** Guards against concurrent operations during conversation switching. */
  isSwitchingConversation: boolean;

  // Conversation identity
  currentConversationId: string | null;

  // Queued message
  queuedMessage: QueuedMessage | null;

  // Active streaming DOM state
  currentContentEl: HTMLElement | null;
  currentTextEl: HTMLElement | null;
  currentTextContent: string;
  currentThinkingState: ThinkingBlockState | null;
  thinkingEl: HTMLElement | null;
  queueIndicatorEl: HTMLElement | null;
  /** Debounce timeout for showing thinking indicator after inactivity. */
  thinkingIndicatorTimeout: ReturnType<typeof setTimeout> | null;

  // Tool tracking maps
  toolCallElements: Map<string, HTMLElement>;
  writeEditStates: Map<string, WriteEditState>;
  /** Pending tool calls buffered until input is complete. */
  pendingTools: Map<string, PendingToolCall>;

  // Context window usage
  usage: UsageInfo | null;
  // Flag to ignore usage updates (during session reset)
  ignoreUsageUpdates: boolean;

  // Current todo items for the persistent bottom panel
  currentTodos: TodoItem[] | null;

  // Attention state (approval pending, error, etc.)
  needsAttention: boolean;

  // Auto-scroll control during streaming
  autoScrollEnabled: boolean;

  // Response timer state
  responseStartTime: number | null;
  flavorTimerInterval: ReturnType<typeof setInterval> | null;

  // Pending plan content for approve-new-session
  pendingNewSessionPlan: string | null;

  // Plan file path captured from Write tool calls
  planFilePath: string | null;
}

/** Callbacks for ChatState changes. */
export interface ChatStateCallbacks {
  onMessagesChanged?: () => void;
  onStreamingStateChanged?: (isStreaming: boolean) => void;
  onConversationChanged?: (id: string | null) => void;
  onUsageChanged?: (usage: UsageInfo | null) => void;
  onTodosChanged?: (todos: TodoItem[] | null) => void;
  onAttentionChanged?: (needsAttention: boolean) => void;
  onAutoScrollChanged?: (enabled: boolean) => void;
}

/** Options for query execution. */
export interface QueryOptions {
  allowedTools?: string[];
  model?: string;
  mcpMentions?: Set<string>;
  enabledMcpServers?: Set<string>;
  forceColdStart?: boolean;
  externalContextPaths?: string[];
}
