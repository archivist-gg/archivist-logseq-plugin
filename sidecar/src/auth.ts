import * as crypto from 'node:crypto';

/**
 * The set of Origin header values accepted by the bridge's WebSocket handshake.
 *
 * Empirically observed: the Logseq Electron plugin iframe sends Origin: file://
 * (a bare scheme, no host). This is Logseq's plugin-host convention. Obsidian
 * is deliberately excluded — it doesn't consume the bridge.
 *
 * Note on breadth: `file://` is a coarse allowlist — any local HTML file loaded
 * in an Electron context with the same scheme would match. This is acceptable
 * for the audit's threat model (drive-by remote pages), since the bridge only
 * listens on 127.0.0.1 and a local attacker with filesystem write already has
 * the user's keys. If Logseq ever migrates to a more specific scheme (e.g.
 * `app://logseq` or `lsp://plugin`), update this list and the WS URL the
 * plugin sends.
 */
export const ALLOWED_ORIGINS: Set<string> = new Set([
  'file://',
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
