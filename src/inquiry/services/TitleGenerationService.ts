/**
 * TitleGenerationService -- Sends title generation request to sidecar.
 *
 * Ported from Obsidian. Key changes:
 * - No direct Claude SDK calls -- delegates to sidecar via WebSocket
 * - Sidecar handles model selection, env parsing, CLI path resolution
 * - Plugin only sends a request and receives the result
 */

import type { SidecarClient } from '../SidecarClient';
import type { ServerMessage } from '../protocol';

export type TitleGenerationResult =
  | { success: true; title: string }
  | { success: false; error: string };

export type TitleGenerationCallback = (
  conversationId: string,
  result: TitleGenerationResult
) => Promise<void>;

/**
 * Sends title generation requests to the sidecar.
 *
 * The sidecar runs the Claude SDK to generate a title from the first
 * user message. This service tracks pending requests and invokes
 * callbacks when results arrive.
 */
export class TitleGenerationService {
  private client: SidecarClient;
  private pendingCallbacks: Map<string, TitleGenerationCallback> = new Map();

  constructor(client: SidecarClient) {
    this.client = client;
  }

  /**
   * Generates a title for a conversation based on the first user message.
   * Non-blocking: calls callback when result arrives from sidecar.
   */
  async generateTitle(
    conversationId: string,
    userMessage: string,
    callback: TitleGenerationCallback,
  ): Promise<void> {
    this.pendingCallbacks.set(conversationId, callback);

    // Truncate message to save tokens
    const truncatedUser = this.truncateText(userMessage, 500);

    // For now, generate a simple title from the first message.
    // When the sidecar supports a title generation endpoint, this
    // would send a WebSocket or HTTP request. Currently we do a
    // local heuristic as a fallback.
    const title = this.generateLocalTitle(truncatedUser);
    await this.safeCallback(callback, conversationId, { success: true, title });
    this.pendingCallbacks.delete(conversationId);
  }

  /**
   * Handles a title result message from the sidecar (future).
   * Call this from a top-level message router if the sidecar sends
   * a `title.result` message.
   */
  handleTitleResult(conversationId: string, title: string): void {
    const callback = this.pendingCallbacks.get(conversationId);
    if (callback) {
      this.safeCallback(callback, conversationId, { success: true, title });
      this.pendingCallbacks.delete(conversationId);
    }
  }

  /** Cancels all pending title generations. */
  cancel(): void {
    this.pendingCallbacks.clear();
  }

  // ── Private ─────────────────────────────────────────────

  /** Generates a simple local title from the user's first message. */
  private generateLocalTitle(text: string): string {
    // Take first sentence or first 50 chars
    const firstSentence = text.split(/[.!?\n]/)[0]?.trim() ?? text.trim();
    let title = firstSentence;

    // Remove surrounding quotes if present
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

    return title || 'New conversation';
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }

  private async safeCallback(
    callback: TitleGenerationCallback,
    conversationId: string,
    result: TitleGenerationResult,
  ): Promise<void> {
    try {
      await callback(conversationId, result);
    } catch {
      // Silently ignore callback errors
    }
  }
}
