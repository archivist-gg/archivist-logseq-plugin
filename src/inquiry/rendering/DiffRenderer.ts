/**
 * DiffLine type used by the rendering layer.
 * Maps to the Obsidian-style diff representation (equal/insert/delete + text).
 */
export interface DiffLine {
  type: 'equal' | 'insert' | 'delete';
  text: string;
}

export interface DiffHunk {
  lines: DiffLine[];
  oldStart: number;
  newStart: number;
}

export function splitIntoHunks(diffLines: DiffLine[], contextLines = 3): DiffHunk[] {
  if (diffLines.length === 0) return [];

  // Find indices of all changed lines
  const changedIndices: number[] = [];
  for (let i = 0; i < diffLines.length; i++) {
    if (diffLines[i].type !== 'equal') {
      changedIndices.push(i);
    }
  }

  // If no changes, return empty
  if (changedIndices.length === 0) return [];

  // Group changed lines into ranges with context
  const ranges: Array<{ start: number; end: number }> = [];

  for (const idx of changedIndices) {
    const start = Math.max(0, idx - contextLines);
    const end = Math.min(diffLines.length - 1, idx + contextLines);

    // Merge with previous range if overlapping or adjacent
    if (ranges.length > 0 && start <= ranges[ranges.length - 1].end + 1) {
      ranges[ranges.length - 1].end = end;
    } else {
      ranges.push({ start, end });
    }
  }

  // Convert ranges to hunks
  const hunks: DiffHunk[] = [];

  for (const range of ranges) {
    const lines = diffLines.slice(range.start, range.end + 1);

    // Find the starting line numbers for this hunk
    let oldStart = 1;
    let newStart = 1;

    // Count lines before this range
    for (let i = 0; i < range.start; i++) {
      const line = diffLines[i];
      if (line.type === 'equal' || line.type === 'delete') oldStart++;
      if (line.type === 'equal' || line.type === 'insert') newStart++;
    }

    hunks.push({ lines, oldStart, newStart });
  }

  return hunks;
}

/** Max lines to render for all-inserts diffs (new file creation). */
const NEW_FILE_DISPLAY_CAP = 20;

export function renderDiffContent(
  doc: Document,
  containerEl: HTMLElement,
  diffLines: DiffLine[],
  contextLines = 3
): void {
  while (containerEl.firstChild) containerEl.removeChild(containerEl.firstChild);

  // New file creation: all lines are inserts — cap display to avoid large DOM
  const allInserts = diffLines.length > 0 && diffLines.every(l => l.type === 'insert');
  if (allInserts && diffLines.length > NEW_FILE_DISPLAY_CAP) {
    const hunkEl = doc.createElement('div');
    hunkEl.className = 'claudian-diff-hunk';
    containerEl.appendChild(hunkEl);

    for (const line of diffLines.slice(0, NEW_FILE_DISPLAY_CAP)) {
      const lineEl = doc.createElement('div');
      lineEl.className = 'claudian-diff-line claudian-diff-insert';
      hunkEl.appendChild(lineEl);

      const prefixEl = doc.createElement('span');
      prefixEl.className = 'claudian-diff-prefix';
      prefixEl.textContent = '+';
      lineEl.appendChild(prefixEl);

      const contentEl = doc.createElement('span');
      contentEl.className = 'claudian-diff-text';
      contentEl.textContent = line.text || ' ';
      lineEl.appendChild(contentEl);
    }
    const remaining = diffLines.length - NEW_FILE_DISPLAY_CAP;
    const separator = doc.createElement('div');
    separator.className = 'claudian-diff-separator';
    separator.textContent = `... ${remaining} more lines`;
    containerEl.appendChild(separator);
    return;
  }

  const hunks = splitIntoHunks(diffLines, contextLines);

  if (hunks.length === 0) {
    // No changes
    const noChanges = doc.createElement('div');
    noChanges.className = 'claudian-diff-no-changes';
    noChanges.textContent = 'No changes';
    containerEl.appendChild(noChanges);
    return;
  }

  hunks.forEach((hunk, hunkIndex) => {
    // Add separator between hunks
    if (hunkIndex > 0) {
      const separator = doc.createElement('div');
      separator.className = 'claudian-diff-separator';
      separator.textContent = '...';
      containerEl.appendChild(separator);
    }

    // Render hunk lines
    const hunkEl = doc.createElement('div');
    hunkEl.className = 'claudian-diff-hunk';
    containerEl.appendChild(hunkEl);

    for (const line of hunk.lines) {
      const lineEl = doc.createElement('div');
      lineEl.className = `claudian-diff-line claudian-diff-${line.type}`;
      hunkEl.appendChild(lineEl);

      // Line prefix
      const prefix = line.type === 'insert' ? '+' : line.type === 'delete' ? '-' : ' ';
      const prefixEl = doc.createElement('span');
      prefixEl.className = 'claudian-diff-prefix';
      prefixEl.textContent = prefix;
      lineEl.appendChild(prefixEl);

      // Line content
      const contentEl = doc.createElement('span');
      contentEl.className = 'claudian-diff-text';
      contentEl.textContent = line.text || ' '; // Show space for empty lines
      lineEl.appendChild(contentEl);
    }
  });
}
