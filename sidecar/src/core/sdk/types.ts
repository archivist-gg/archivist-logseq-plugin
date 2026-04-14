import type { StreamChunk } from '../types/index.js';

export interface SessionInitEvent {
  type: 'session_init';
  sessionId: string;
  agents?: string[];
  permissionMode?: string;
}

export type TransformEvent = StreamChunk | SessionInitEvent;
