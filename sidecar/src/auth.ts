import * as crypto from 'node:crypto';

/**
 * The set of Origin header values accepted by the bridge's WebSocket handshake.
 *
 * The Logseq Electron webview's real Origin header value is discovered
 * empirically in Task 10 of the hardening plan. Until then, this contains a
 * placeholder value that must be replaced with the observed string before
 * the bridge can be released.
 */
export const ALLOWED_ORIGINS: Set<string> = new Set([
  // Placeholder — replaced in Task 10 with the empirically-observed value.
  'app://logseq.io',
]);

/**
 * Timing-safe string equality. Returns false (never throws) on length
 * mismatch so callers don't have to guard.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
