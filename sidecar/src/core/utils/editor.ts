/**
 * Editor utilities - stubbed for sidecar (no Obsidian editor).
 */

export interface CursorContext {
  beforeCursor: string;
  afterCursor: string;
  isInbetween: boolean;
  line: number;
  column: number;
}

export interface EditorSelectionContext {
  notePath: string;
  mode: 'selection' | 'cursor' | 'none';
  selectedText?: string;
  cursorContext?: CursorContext;
  lineCount?: number;
  startLine?: number;
}

export function findNearestNonEmptyLine(
  _getLine: (line: number) => string,
  _lineCount: number,
  _startLine: number,
  _direction: 'before' | 'after'
): string {
  return '';
}

export function buildCursorContext(
  _getLine: (line: number) => string,
  _lineCount: number,
  _line: number,
  _column: number
): CursorContext {
  return { beforeCursor: '', afterCursor: '', isInbetween: true, line: 0, column: 0 };
}

export function formatEditorContext(_context: EditorSelectionContext): string {
  return '';
}

export function appendEditorContext(prompt: string, _context: EditorSelectionContext): string {
  return prompt;
}
