/**
 * SubagentManager -- Tracks subagent state from `stream.subagent` WebSocket messages.
 *
 * Ported from Obsidian. Key changes:
 * - Communicates via SidecarClient WebSocket, not direct SDK
 * - No Node.js `fs`/`os`/`path` imports (runs in browser iframe)
 * - Rendering functions take `doc: Document` as first parameter
 * - `setText()` -> `textContent =`
 */

import type { SidecarClient } from '../SidecarClient';
import type { ServerMessage, StreamSubagentMessage } from '../protocol';
import type {
  SubagentInfo,
  SubagentMode,
  ToolCallInfo,
} from '../state/types';

export type SubagentStateChangeCallback = (subagent: SubagentInfo) => void;

/**
 * Simplified SubagentManager for the Logseq plugin.
 *
 * The sidecar handles the heavy lifting (SDK interaction, file I/O).
 * This manager tracks state from `stream.subagent` WebSocket messages
 * and maintains the in-memory map of active subagents for the UI to query.
 */
export class SubagentManager {
  private client: SidecarClient;
  private subagents: Map<string, SubagentInfo> = new Map();
  private onStateChange: SubagentStateChangeCallback;
  private unsubscribe: (() => void) | null = null;

  constructor(client: SidecarClient, onStateChange: SubagentStateChangeCallback) {
    this.client = client;
    this.onStateChange = onStateChange;
    this.unsubscribe = this.client.onMessage((msg: ServerMessage) => {
      if (msg.type === 'stream.subagent') {
        this.handleSubagentMessage(msg);
      }
    });
  }

  // ── Public API ──────────────────────────────────────────

  setCallback(callback: SubagentStateChangeCallback): void {
    this.onStateChange = callback;
  }

  getSubagent(id: string): SubagentInfo | undefined {
    return this.subagents.get(id);
  }

  getAllSubagents(): SubagentInfo[] {
    return Array.from(this.subagents.values());
  }

  hasRunningSubagents(): boolean {
    for (const sub of this.subagents.values()) {
      if (sub.status === 'running') return true;
    }
    return false;
  }

  clear(): void {
    this.subagents.clear();
  }

  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.subagents.clear();
  }

  // ── Private ─────────────────────────────────────────────

  private handleSubagentMessage(msg: StreamSubagentMessage): void {
    const { id, status, description, result } = msg;
    let subagent = this.subagents.get(id);

    if (!subagent) {
      // Create new subagent entry
      subagent = {
        id,
        description: description ?? 'Subagent task',
        status: this.mapStatus(status),
        toolCalls: [],
        isExpanded: false,
      };
      this.subagents.set(id, subagent);
    } else {
      // Update existing
      subagent.status = this.mapStatus(status);
      if (description !== undefined) {
        subagent.description = description;
      }
      if (result !== undefined) {
        subagent.result = result;
      }
    }

    this.onStateChange(subagent);
  }

  private mapStatus(status: string): SubagentInfo['status'] {
    switch (status) {
      case 'running':
        return 'running';
      case 'completed':
        return 'completed';
      case 'error':
        return 'error';
      default:
        return 'running';
    }
  }
}
