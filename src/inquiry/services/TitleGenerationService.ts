/**
 * TitleGenerationService -- Sends title generation request to sidecar.
 *
 * Ported from Obsidian. Key changes:
 * - No direct Claude SDK calls -- delegates to sidecar via WebSocket
 * - Sidecar handles model selection (Haiku), env parsing, CLI path resolution
 * - Plugin sends a `title.generate` WS message and receives `title.result`
 * - Falls back to local heuristic if sidecar title generation fails
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
 * The sidecar runs the Claude SDK with the Haiku model to generate a title
 * from the first user message. This service tracks pending requests and
 * invokes callbacks when results arrive.
 */
export class TitleGenerationService {
  private client: SidecarClient;
  private pendingCallbacks: Map<string, TitleGenerationCallback> = new Map();
  private unsubscribe: (() => void) | null = null;

  constructor(client: SidecarClient) {
    this.client = client;

    // Listen for title.result messages from sidecar
    this.unsubscribe = this.client.onMessage((msg: ServerMessage) => {
      if (msg.type === 'title.result') {
        const { conversationId, success, title, error } = msg as {
          conversationId: string;
          success: boolean;
          title?: string;
          error?: string;
        };

        if (success && title) {
          this.handleTitleResult(conversationId, title);
        } else {
          // Sidecar title generation failed — use local fallback
          const callback = this.pendingCallbacks.get(conversationId);
          if (callback) {
            const fallbackMsg = this.pendingUserMessages.get(conversationId);
            this.pendingUserMessages.delete(conversationId);
            this.pendingCallbacks.delete(conversationId);

            if (fallbackMsg) {
              const fallbackTitle = this.generateLocalTitle(fallbackMsg);
              this.safeCallback(callback, conversationId, { success: true, title: fallbackTitle });
            } else {
              this.safeCallback(callback, conversationId, {
                success: false,
                error: error ?? 'Title generation failed',
              });
            }
          }
        }
      }
    });
  }

  /** Track user messages for local fallback. */
  private pendingUserMessages: Map<string, string> = new Map();

  /**
   * Generates a title for a conversation based on the first user message.
   * Non-blocking: sends request to sidecar and calls callback when result arrives.
   */
  async generateTitle(
    conversationId: string,
    userMessage: string,
    callback: TitleGenerationCallback,
  ): Promise<void> {
    this.pendingCallbacks.set(conversationId, callback);
    this.pendingUserMessages.set(conversationId, userMessage);

    // Truncate message to save tokens
    const truncatedUser = this.truncateText(userMessage, 500);

    // Send title generation request to sidecar via WebSocket
    // The sidecar will use the Haiku model and return a title.result message
    try {
      this.client.sendTitleGenerate('title-gen', conversationId, truncatedUser);
    } catch {
      // If WebSocket send fails, fall back to local heuristic
      this.pendingCallbacks.delete(conversationId);
      this.pendingUserMessages.delete(conversationId);
      const title = this.generateLocalTitle(truncatedUser);
      await this.safeCallback(callback, conversationId, { success: true, title });
    }
  }

  /**
   * Handles a title result message from the sidecar.
   * Called when a `title.result` message arrives via WebSocket.
   */
  handleTitleResult(conversationId: string, title: string): void {
    const callback = this.pendingCallbacks.get(conversationId);
    if (callback) {
      this.pendingCallbacks.delete(conversationId);
      this.pendingUserMessages.delete(conversationId);
      this.safeCallback(callback, conversationId, { success: true, title });
    }
  }

  /** Cancels all pending title generations. */
  cancel(): void {
    this.pendingCallbacks.clear();
    this.pendingUserMessages.clear();
  }

  /** Cleans up resources. */
  destroy(): void {
    this.cancel();
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  // ── Private ─────────────────────────────────────────────

  /** Generates a simple local title from the user's first message (fallback). */
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
