export type NotificationType = 'info' | 'warning' | 'error';

export interface NotificationListener {
  (message: string, type: NotificationType): void;
}

export class NotificationEmitter {
  private listeners: Set<NotificationListener> = new Set();

  onNotification(listener: NotificationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  notify(message: string, type: NotificationType = 'info'): void {
    for (const listener of this.listeners) {
      listener(message, type);
    }
  }

  notice(message: string): void {
    this.notify(message, 'info');
  }

  warn(message: string): void {
    this.notify(message, 'warning');
  }

  error(message: string): void {
    this.notify(message, 'error');
  }
}
