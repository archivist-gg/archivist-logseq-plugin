/**
 * Electron compatibility - stubbed for sidecar (pure Node.js, no Electron).
 */
export function patchSetMaxListenersForElectron(): void {
  // No-op in sidecar environment
}
