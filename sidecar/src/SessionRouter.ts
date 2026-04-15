import { ClaudianService } from './core/agent/ClaudianService.js';
import type { SidecarContext } from './core/agent/ClaudianService.js';
import { McpServerManager } from './core/mcp/index.js';

export class SessionRouter {
  private sessions = new Map<string, ClaudianService>();
  private context: SidecarContext;
  private mcpManager: McpServerManager;

  constructor(context: SidecarContext, mcpManager: McpServerManager) {
    this.context = context;
    this.mcpManager = mcpManager;
  }

  getOrCreate(tabId: string): ClaudianService {
    let service = this.sessions.get(tabId);
    if (!service) {
      service = new ClaudianService(this.context, this.mcpManager);
      this.sessions.set(tabId, service);
    }
    return service;
  }

  get(tabId: string): ClaudianService | undefined {
    return this.sessions.get(tabId);
  }

  destroy(tabId: string): void {
    const service = this.sessions.get(tabId);
    if (service) {
      service.cancel();
      this.sessions.delete(tabId);
    }
  }

  destroyAll(): void {
    for (const [tabId] of this.sessions) {
      this.destroy(tabId);
    }
  }

  get size(): number {
    return this.sessions.size;
  }
}
