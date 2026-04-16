/**
 * Tab — Individual tab lifecycle and wiring.
 *
 * Ported from Obsidian's Tab.ts.
 * Key differences:
 * - No `ClaudianService` — sidecar handles agent lifecycle via `SidecarClient`.
 * - No `App`, `Plugin`, `Component` — uses `doc: Document` and `SidecarClient`.
 * - No `BrowserSelectionController`, `CanvasSelectionController` — Obsidian-specific.
 * - No `McpServerManager` — lives in sidecar.
 * - No `InlineEditService`, `SubagentManager`, `InstructionRefineService`,
 *   `TitleGenerationService`, `SlashCommandDropdown`, `EntityAutocomplete` — future tasks.
 * - `setIcon()` from `../shared/icons` instead of Obsidian.
 * - `RichInput` takes `(doc, container, options)` instead of `(container, options)`.
 * - Controllers use Logseq-adapted APIs (SidecarClient, doc).
 * - `renderMarkdownToEl()` wired as StreamController.rendererBridge.
 */

import '@logseq/libs';
import type { SidecarClient } from '../SidecarClient';
import type {
  ApprovalRequestMessage,
  AskUserQuestionMessage,
  BashResultMessage,
  InstructionRefineResultMessage,
  PlanModeRequestMessage,
  SessionListResultMessage,
  SessionLoadedMessage,
} from '../protocol';
import {
  ConversationController,
  InputController,
  NavigationController,
  SelectionController,
  StreamController,
} from '../controllers';
import { MessageRenderer } from '../rendering/MessageRenderer';
import type { CopyAndSaveCallback } from '../rendering/DndEntityRenderer';
import { renderMarkdownToEl } from '../rendering/markdown';
import { ChatState } from '../state/ChatState';
import {
  RichInput,
  SendButton,
  StatusPanel,
  FileContextManager,
  ImageContextManager,
  createInputToolbar,
  InstructionModeManager,
  BangBashModeManager,
} from '../ui';
import type { InstructionInputLike, ToolbarSettings } from '../ui';
import type { TabData, TabDOMElements, TabId } from './types';
import { generateTabId, TEXTAREA_MAX_HEIGHT_PERCENT, TEXTAREA_MIN_MAX_HEIGHT } from './types';

// ── Tab Create Options ──

export interface TabCreateOptions {
  doc: Document;
  client: SidecarClient;
  containerEl: HTMLElement;
  tabId?: TabId;
  onStreamingChanged?: (isStreaming: boolean) => void;
  onTitleChanged?: (title: string) => void;
  onAttentionChanged?: (needsAttention: boolean) => void;
  onConversationIdChanged?: (conversationId: string | null) => void;
}

// ── Auto-resize ──

/**
 * Auto-resizes an input element based on its content.
 * Max height is capped at 55% of view height (minimum 150px).
 */
function autoResizeInput(inputEl: HTMLElement): void {
  inputEl.style.minHeight = '';
  const viewHeight = inputEl.closest('.claudian-container')?.clientHeight ?? window.innerHeight;
  const maxHeight = Math.max(TEXTAREA_MIN_MAX_HEIGHT, viewHeight * TEXTAREA_MAX_HEIGHT_PERCENT);
  const flexAllocatedHeight = inputEl.offsetHeight;
  const contentHeight = Math.min(inputEl.scrollHeight, maxHeight);
  if (contentHeight > flexAllocatedHeight) {
    inputEl.style.minHeight = `${contentHeight}px`;
  }
  inputEl.style.maxHeight = `${maxHeight}px`;
}

// ── Create Tab ──

/**
 * Creates a new Tab instance with all required state.
 */
export function createTab(options: TabCreateOptions): TabData {
  const {
    doc,
    containerEl,
    tabId,
    onStreamingChanged,
    onAttentionChanged,
    onConversationIdChanged,
  } = options;

  const id = tabId ?? generateTabId();

  // Create per-tab content container (hidden by default via class)
  const contentEl = doc.createElement('div');
  contentEl.className = 'claudian-tab-content claudian-tab-hidden';
  containerEl.appendChild(contentEl);

  // Create ChatState with callbacks
  const state = new ChatState({
    onStreamingStateChanged: (isStreaming) => {
      onStreamingChanged?.(isStreaming);
    },
    onAttentionChanged: (needsAttention) => {
      onAttentionChanged?.(needsAttention);
    },
    onConversationChanged: (conversationId) => {
      onConversationIdChanged?.(conversationId);
    },
  });

  // Create DOM structure
  const dom = buildTabDOM(doc, contentEl);

  // Create initial TabData (controllers are lazy-initialized)
  const tab: TabData = {
    id,
    conversationId: null,
    serviceInitialized: false,
    state,
    controllers: {
      selectionController: null,
      conversationController: null,
      streamController: null,
      inputController: null,
      navigationController: null,
    },
    ui: {
      fileContextManager: null,
      imageContextManager: null,
      modelSelector: null,
      thinkingBudgetSelector: null,
      contextUsageMeter: null,
      externalContextSelector: null,
      mcpServerSelector: null,
      instructionModeManager: null,
      bangBashModeManager: null,
      statusPanel: null,
    },
    dom,
    renderer: null,
  };

  return tab;
}

// ── Build Tab DOM ──

/**
 * Builds the DOM structure for a tab.
 */
function buildTabDOM(doc: Document, contentEl: HTMLElement): TabDOMElements {
  // Messages wrapper (for scroll-to-bottom button positioning)
  const messagesWrapperEl = doc.createElement('div');
  messagesWrapperEl.className = 'claudian-messages-wrapper';
  contentEl.appendChild(messagesWrapperEl);

  // History dropdown (positioned inside messages wrapper, hidden by default)
  const historyDropdownEl = doc.createElement('div');
  historyDropdownEl.className = 'claudian-history-menu';
  messagesWrapperEl.appendChild(historyDropdownEl);

  // Messages area (inside wrapper)
  const messagesEl = doc.createElement('div');
  messagesEl.className = 'claudian-messages';
  messagesWrapperEl.appendChild(messagesEl);

  // Welcome message placeholder
  const welcomeEl = doc.createElement('div');
  welcomeEl.className = 'claudian-welcome';
  messagesEl.appendChild(welcomeEl);

  // Status panel container (fixed between messages and input)
  const statusPanelContainerEl = doc.createElement('div');
  statusPanelContainerEl.className = 'claudian-status-panel-container';
  contentEl.appendChild(statusPanelContainerEl);

  // Input container
  const inputContainerEl = doc.createElement('div');
  inputContainerEl.className = 'claudian-input-container';
  contentEl.appendChild(inputContainerEl);

  // Nav row (for tab badges and header icons)
  const navRowEl = doc.createElement('div');
  navRowEl.className = 'claudian-input-nav-row';
  inputContainerEl.appendChild(navRowEl);

  const inputWrapper = doc.createElement('div');
  inputWrapper.className = 'claudian-input-wrapper';
  inputContainerEl.appendChild(inputWrapper);

  // Context row inside input wrapper (file chips + selection indicator)
  const contextRowEl = doc.createElement('div');
  contextRowEl.className = 'claudian-context-row';
  inputWrapper.appendChild(contextRowEl);

  // Rich input (contentEditable div)
  const richInput = new RichInput(doc, inputWrapper, {
    placeholder: 'Ask Archivist...',
  });
  const inputEl = richInput.el;

  return {
    contentEl,
    messagesEl,
    welcomeEl,
    statusPanelContainerEl,
    inputContainerEl,
    inputWrapper,
    inputEl,
    richInput,
    sendButton: null,
    navRowEl,
    contextRowEl,
    selectionIndicatorEl: null,
    historyDropdownEl,
    eventCleanups: [],
  };
}

// ── Initialize Tab UI ──

export interface InitializeTabUIOptions {
  /** Cached settings for toolbar display. */
  getSettings: () => ToolbarSettings;
  /** Called when model changes. */
  onModelChange: (model: string) => void;
  /** Called when effort level changes. */
  onEffortLevelChange: (effort: string) => void;
}

/**
 * Initializes the tab's UI components.
 * Call this after the tab is created and before it becomes active.
 */
export function initializeTabUI(
  tab: TabData,
  doc: Document,
  client: SidecarClient,
  options: InitializeTabUIOptions,
): void {
  const { dom, state } = tab;

  // File context manager
  tab.ui.fileContextManager = new FileContextManager(
    doc,
    client,
    dom.contextRowEl,
    dom.richInput,
    {
      onChipsChanged: () => {
        tab.controllers.selectionController?.updateContextRowVisibility();
        autoResizeInput(dom.inputEl);
      },
    },
  );

  // Selection indicator
  dom.selectionIndicatorEl = doc.createElement('div');
  dom.selectionIndicatorEl.className = 'claudian-selection-indicator';
  dom.selectionIndicatorEl.style.display = 'none';
  dom.contextRowEl.appendChild(dom.selectionIndicatorEl);

  // Image context manager
  tab.ui.imageContextManager = new ImageContextManager(
    doc,
    dom.inputContainerEl,
    dom.inputEl,
    {
      onImagesChanged: () => {
        tab.controllers.selectionController?.updateContextRowVisibility();
        autoResizeInput(dom.inputEl);
      },
    },
  );

  // Send button
  dom.sendButton = new SendButton(
    doc,
    dom.inputWrapper,
    () => { void tab.controllers.inputController?.sendMessage(); },
    () => { tab.controllers.inputController?.cancelStreaming(); },
  );

  // Instruction mode (# prefix)
  const inputAdapter: InstructionInputLike = {
    getValue: () => dom.richInput.value,
    setValue: (text: string) => {
      if (text === '') {
        dom.richInput.clear();
      } else {
        dom.richInput.setText(text);
      }
    },
    getPlaceholder: () => dom.richInput.el.dataset.placeholder ?? '',
    setPlaceholder: (text: string) => {
      dom.richInput.el.dataset.placeholder = text;
    },
  };

  tab.ui.instructionModeManager = new InstructionModeManager(inputAdapter, {
    onSubmit: async (instruction) => {
      // Send instruction to sidecar for refinement via cold-start query
      client.sendInstructionRefine(tab.id, instruction, '');
      tab.ui.instructionModeManager?.clear();
    },
    getInputWrapper: () => dom.inputWrapper,
    resetInputHeight: () => { /* contentEditable auto-sizes */ },
  });

  // Bang bash mode (! prefix)
  tab.ui.bangBashModeManager = new BangBashModeManager(inputAdapter, {
    onSubmit: async (command) => {
      const bashId = `bash-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      // Add running entry to StatusPanel
      tab.ui.statusPanel?.addBashOutput({
        id: bashId,
        command,
        status: 'running',
        output: '',
      });

      // Send to sidecar for execution
      client.sendBashExecute(tab.id, bashId, command);
    },
    getInputWrapper: () => dom.inputWrapper,
    resetInputHeight: () => { /* contentEditable auto-sizes */ },
  });

  // Status panel
  tab.ui.statusPanel = new StatusPanel(doc);
  tab.ui.statusPanel.mount(dom.statusPanelContainerEl);

  // Input toolbar (model selector, effort, context meter)
  const toolbarEl = doc.createElement('div');
  toolbarEl.className = 'claudian-input-toolbar';
  dom.inputWrapper.appendChild(toolbarEl);

  const toolbar = createInputToolbar(doc, toolbarEl, {
    onModelChange: async (model) => {
      options.onModelChange(model);
    },
    onEffortLevelChange: async (effort) => {
      options.onEffortLevelChange(effort);
    },
    getSettings: options.getSettings,
  }, client);

  tab.ui.modelSelector = toolbar.modelSelector;
  tab.ui.thinkingBudgetSelector = toolbar.thinkingBudgetSelector;
  tab.ui.contextUsageMeter = toolbar.contextUsageMeter;
  tab.ui.externalContextSelector = toolbar.externalContextSelector;
  tab.ui.mcpServerSelector = toolbar.mcpServerSelector;

  // Wire ChatState callbacks for UI updates
  state.callbacks = {
    ...state.callbacks,
    onUsageChanged: (usage) => tab.ui.contextUsageMeter?.update(usage),
    onTodosChanged: (todos) => tab.ui.statusPanel?.updateTodos(todos),
    onMessagesChanged: () => {
      tab.controllers.conversationController?.updateWelcomeVisibility();
    },
  };
}

// ── Initialize Tab Controllers ──

/**
 * Initializes the tab's controllers and renderer.
 * Call this after `initializeTabUI()`.
 */
export function initializeTabControllers(
  tab: TabData,
  doc: Document,
  client: SidecarClient,
  onCopyAndSave?: CopyAndSaveCallback,
): void {
  const { dom, state, ui } = tab;

  // Create renderer with page navigation callback for [[wikilinks]]
  tab.renderer = new MessageRenderer(
    doc,
    client,
    dom.messagesEl,
    (pageName: string) => {
      // Navigate to the referenced Logseq page
      logseq.App.pushState('page', { name: pageName });
    },
  );

  // Wire D&D entity Copy & Save callback
  if (onCopyAndSave) {
    tab.renderer.setDndCopyAndSaveCallback(onCopyAndSave);
  }

  // Create stream controller
  tab.controllers.streamController = new StreamController({
    client,
    doc,
    state,
    getMessagesEl: () => dom.messagesEl,
    updateQueueIndicator: () => tab.controllers.inputController?.updateQueueIndicator(),
  });

  // Wire Copy & Save callback on stream controller too (for live-streamed tool results)
  if (onCopyAndSave) {
    tab.controllers.streamController.setDndCopyAndSaveCallback(onCopyAndSave);
  }

  // Wire the renderer bridge so markdown renders properly (not plain text fallback)
  const pageClickHandler = (pageName: string) => {
    logseq.App.pushState('page', { name: pageName });
  };
  tab.controllers.streamController.setRendererBridge({
    renderContent: async (el: HTMLElement, markdown: string) => {
      renderMarkdownToEl(doc, el, markdown, pageClickHandler);
    },
    addTextCopyButton: (el: HTMLElement, text: string) => {
      tab.renderer?.addTextCopyButton(el, text);
    },
  });

  // Selection controller
  tab.controllers.selectionController = new SelectionController(
    doc,
    dom.selectionIndicatorEl!,
    dom.inputEl,
    dom.contextRowEl,
    () => autoResizeInput(dom.inputEl),
    dom.contentEl,
  );

  // Conversation controller
  tab.controllers.conversationController = new ConversationController(
    {
      client,
      doc,
      state,
      tabId: tab.id,
      renderer: tab.renderer ?? undefined,
      getHistoryDropdown: () => dom.historyDropdownEl,
      getWelcomeEl: () => dom.welcomeEl,
      setWelcomeEl: (el) => { dom.welcomeEl = el; },
      getMessagesEl: () => dom.messagesEl,
      getInputEl: () => dom.inputEl,
      clearQueuedMessage: () => tab.controllers.inputController?.clearQueuedMessage(),
    },
    {},
  );

  // Input controller
  tab.controllers.inputController = new InputController({
    client,
    doc,
    state,
    tabId: tab.id,
    streamController: tab.controllers.streamController,
    selectionController: tab.controllers.selectionController,
    conversationController: tab.controllers.conversationController,
    getInputEl: () => dom.inputEl,
    getWelcomeEl: () => dom.welcomeEl,
    getMessagesEl: () => dom.messagesEl,
    getInputContainerEl: () => dom.inputContainerEl,
    generateId: generateMessageId,
    resetInputHeight: () => {
      // Per-tab input height is managed by CSS
    },
  });

  // Subscribe to tab-scoped messages (approval, askuser, planmode, session, bash, instruction)
  const unsubTabMessages = client.onTabMessage(tab.id, (msg) => {
    if (msg.type === 'approval.request') {
      tab.controllers.inputController?.handleApprovalRequest(msg as ApprovalRequestMessage);
    } else if (msg.type === 'askuser.question') {
      tab.controllers.inputController?.handleAskUserQuestion(msg as AskUserQuestionMessage);
    } else if (msg.type === 'plan_mode.request') {
      tab.controllers.inputController?.handleExitPlanMode(msg as PlanModeRequestMessage);
    } else if (msg.type === 'session.list_result') {
      const listMsg = msg as SessionListResultMessage;
      tab.controllers.conversationController?.onSessionListResult(listMsg.sessions);
    } else if (msg.type === 'session.loaded') {
      const loadedMsg = msg as SessionLoadedMessage;
      tab.controllers.conversationController?.onSessionLoaded(loadedMsg.conversation);
    } else if (msg.type === 'bash.result') {
      // Update StatusPanel with bash execution result
      const bashMsg = msg as BashResultMessage;
      tab.ui.statusPanel?.updateBashOutput(bashMsg.id, {
        status: bashMsg.exitCode === 0 ? 'completed' : 'error',
        output: bashMsg.error || bashMsg.output,
        exitCode: bashMsg.exitCode,
      });
    } else if (msg.type === 'instruction.refine_result') {
      // Handle instruction refinement result from sidecar
      const refineMsg = msg as InstructionRefineResultMessage;
      if (refineMsg.success && refineMsg.refinedInstruction) {
        // Apply the refined instruction as custom system prompt
        client.sendSettingsUpdate(tab.id, { customSystemPrompt: refineMsg.refinedInstruction });
      }
    }
  });
  dom.eventCleanups.push(unsubTabMessages);

  // Navigation controller
  tab.controllers.navigationController = new NavigationController({
    getMessagesEl: () => dom.messagesEl,
    getInputEl: () => dom.inputEl,
    getSettings: () => ({
      scrollUpKey: 'k',
      scrollDownKey: 'j',
      focusInputKey: 'i',
    }),
    isStreaming: () => state.isStreaming,
    shouldSkipEscapeHandling: () => {
      if (ui.instructionModeManager?.isActive()) return true;
      if (ui.bangBashModeManager?.isActive()) return true;
      return false;
    },
  });
  tab.controllers.navigationController.initialize();
}

// ── Wire Tab Input Events ──

/**
 * Wires up input event handlers for a tab.
 * Call this after controllers are initialized.
 */
export function wireTabInputEvents(tab: TabData): void {
  const { dom, ui, state, controllers } = tab;

  let wasBangBashActive = ui.bangBashModeManager?.isActive() ?? false;
  const syncBangBashSuppression = (): void => {
    const isActive = ui.bangBashModeManager?.isActive() ?? false;
    if (isActive === wasBangBashActive) return;
    wasBangBashActive = isActive;
  };

  // Input keydown handler
  const keydownHandler = (e: KeyboardEvent) => {
    if (ui.bangBashModeManager?.isActive()) {
      ui.bangBashModeManager.handleKeydown(e);
      syncBangBashSuppression();
      return;
    }

    // Check for # trigger first (empty input + # keystroke)
    if (ui.instructionModeManager?.handleTriggerKey(e)) {
      return;
    }

    // Check for ! trigger (empty input + ! keystroke)
    if (ui.bangBashModeManager?.handleTriggerKey(e)) {
      syncBangBashSuppression();
      return;
    }

    if (ui.instructionModeManager?.handleKeydown(e)) {
      return;
    }

    // File context mention navigation
    if (ui.fileContextManager?.handleMentionKeydown(e)) {
      return;
    }

    // Shift+Tab: toggle plan mode
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      controllers.inputController?.togglePlanMode();
      return;
    }

    // Check !e.isComposing for IME support
    if (e.key === 'Escape' && !e.isComposing && state.isStreaming) {
      e.preventDefault();
      controllers.inputController?.cancelStreaming();
      return;
    }

    // Enter: Send message
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void controllers.inputController?.sendMessage();
    }
  };
  dom.inputEl.addEventListener('keydown', keydownHandler);
  dom.eventCleanups.push(() => dom.inputEl.removeEventListener('keydown', keydownHandler));

  // Input change handler (includes auto-resize and SendButton state)
  const updateSendButtonState = (): void => {
    if (!dom.sendButton) return;
    if (state.isStreaming) {
      dom.sendButton.setState('streaming');
    } else if (dom.richInput.isEmpty) {
      dom.sendButton.setState('idle-empty');
    } else {
      dom.sendButton.setState('idle-ready');
    }
  };

  const inputHandler = () => {
    if (!ui.bangBashModeManager?.isActive()) {
      ui.fileContextManager?.handleInputChange();
    }
    ui.instructionModeManager?.handleInputChange();
    ui.bangBashModeManager?.handleInputChange();
    syncBangBashSuppression();
    updateSendButtonState();
    autoResizeInput(dom.inputEl);
  };
  dom.inputEl.addEventListener('input', inputHandler);
  dom.eventCleanups.push(() => dom.inputEl.removeEventListener('input', inputHandler));

  // Update SendButton when streaming state changes
  const origStreamingCallback = state.callbacks.onStreamingStateChanged;
  state.callbacks = {
    ...state.callbacks,
    onStreamingStateChanged: (isStreaming) => {
      origStreamingCallback?.(isStreaming);
      updateSendButtonState();
    },
  };

  // Scroll listener for auto-scroll control
  const SCROLL_THRESHOLD = 20;
  const RE_ENABLE_DELAY = 150;
  let reEnableTimeout: ReturnType<typeof setTimeout> | null = null;

  const scrollHandler = () => {
    const { scrollTop, scrollHeight, clientHeight } = dom.messagesEl;
    const isAtBottom = scrollHeight - scrollTop - clientHeight <= SCROLL_THRESHOLD;

    if (!isAtBottom) {
      if (reEnableTimeout) {
        clearTimeout(reEnableTimeout);
        reEnableTimeout = null;
      }
      state.autoScrollEnabled = false;
    } else if (!state.autoScrollEnabled) {
      if (!reEnableTimeout) {
        reEnableTimeout = setTimeout(() => {
          reEnableTimeout = null;
          const { scrollTop, scrollHeight, clientHeight } = dom.messagesEl;
          if (scrollHeight - scrollTop - clientHeight <= SCROLL_THRESHOLD) {
            state.autoScrollEnabled = true;
          }
        }, RE_ENABLE_DELAY);
      }
    }
  };
  dom.messagesEl.addEventListener('scroll', scrollHandler, { passive: true });
  dom.eventCleanups.push(() => {
    dom.messagesEl.removeEventListener('scroll', scrollHandler);
    if (reEnableTimeout) clearTimeout(reEnableTimeout);
  });
}

// ── Tab Lifecycle ──

/**
 * Activates a tab (shows it and starts services).
 */
export function activateTab(tab: TabData): void {
  tab.dom.contentEl.classList.remove('claudian-tab-hidden');
  tab.controllers.selectionController?.start();
}

/**
 * Deactivates a tab (hides it and stops services).
 */
export function deactivateTab(tab: TabData): void {
  tab.dom.contentEl.classList.add('claudian-tab-hidden');
  tab.controllers.selectionController?.stop();
}

/**
 * Cleans up a tab and releases all resources.
 */
export async function destroyTab(tab: TabData): Promise<void> {
  // Stop polling
  tab.controllers.selectionController?.stop();
  tab.controllers.selectionController?.clear();

  // Cleanup navigation controller
  tab.controllers.navigationController?.dispose();

  // Cleanup UI components
  tab.ui.fileContextManager?.destroy();
  tab.ui.mcpServerSelector?.destroy();
  tab.ui.mcpServerSelector = null;
  tab.ui.instructionModeManager?.destroy();
  tab.ui.instructionModeManager = null;
  tab.ui.bangBashModeManager?.destroy();
  tab.ui.bangBashModeManager = null;
  tab.ui.statusPanel?.destroy();
  tab.ui.statusPanel = null;

  // Remove event listeners to prevent memory leaks
  for (const cleanup of tab.dom.eventCleanups) {
    cleanup();
  }
  tab.dom.eventCleanups.length = 0;

  // Remove DOM element
  tab.dom.contentEl.remove();
}

/**
 * Gets the display title for a tab.
 */
export function getTabTitle(tab: TabData): string {
  // In Logseq, conversation titles are managed by the sidecar.
  // For now, return a simple title based on first message or default.
  const firstUserMsg = tab.state.messages.find(m => m.role === 'user');
  if (firstUserMsg) {
    const text = firstUserMsg.displayContent ?? firstUserMsg.content;
    return text.length > 30 ? text.slice(0, 30) + '...' : text;
  }
  return 'New Chat';
}

// ── Helpers ──

function generateMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
