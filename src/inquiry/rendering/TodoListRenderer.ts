import { setIcon } from '../shared/icons';
import type { TodoItem } from '../state/types';

export function getTodoStatusIcon(status: TodoItem['status']): string {
  return status === 'completed' ? 'check' : 'dot';
}

export function getTodoDisplayText(todo: TodoItem): string {
  return todo.status === 'in_progress' ? todo.activeForm : todo.content;
}

export function renderTodoItems(
  doc: Document,
  container: HTMLElement,
  todos: TodoItem[]
): void {
  while (container.firstChild) container.removeChild(container.firstChild);

  for (const todo of todos) {
    const item = doc.createElement('div');
    item.className = `claudian-todo-item claudian-todo-${todo.status}`;
    container.appendChild(item);

    const icon = doc.createElement('span');
    icon.className = 'claudian-todo-status-icon';
    icon.setAttribute('aria-hidden', 'true');
    setIcon(icon, getTodoStatusIcon(todo.status));
    item.appendChild(icon);

    const text = doc.createElement('span');
    text.className = 'claudian-todo-text';
    text.textContent = getTodoDisplayText(todo);
    item.appendChild(text);
  }
}

/**
 * Extract the last set of todos from a conversation's messages.
 * Scans tool calls for TodoWrite results with todo lists.
 */
export function extractLastTodosFromMessages(
  messages: Array<{ toolCalls?: Array<{ name: string; input: Record<string, unknown> }> }>
): TodoItem[] | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg.toolCalls) continue;
    for (let j = msg.toolCalls.length - 1; j >= 0; j--) {
      const tc = msg.toolCalls[j];
      if (tc.name === 'TodoWrite' || tc.name === 'todo_write') {
        const todos = tc.input.todos;
        if (Array.isArray(todos) && todos.length > 0) {
          return todos as TodoItem[];
        }
      }
    }
  }
  return null;
}

/**
 * Parse raw todo input into typed TodoItems.
 */
export function parseTodoInput(input: Record<string, unknown>): TodoItem[] | undefined {
  const todos = input.todos;
  if (!todos || !Array.isArray(todos)) return undefined;
  return todos as TodoItem[];
}
