/**
 * File link utilities - stubbed for sidecar (no Obsidian DOM).
 */
export function extractLinkTarget(fullMatch: string): string {
  const inner = fullMatch.slice(2, -2);
  const pipeIndex = inner.indexOf('|');
  return pipeIndex >= 0 ? inner.slice(0, pipeIndex) : inner;
}

export function registerFileLinkHandler(): void {
  // No-op in sidecar environment
}

export function processFileLinks(): void {
  // No-op in sidecar environment
}
