export {
  activateTab,
  createTab,
  type TabCreateOptions,
  deactivateTab,
  destroyTab,
  getTabTitle,
  initializeTabControllers,
  initializeTabUI,
  type InitializeTabUIOptions,
  wireTabInputEvents,
} from './Tab';

export { TabManager, type TabManagerOptions } from './TabManager';

export {
  DEFAULT_MAX_TABS,
  generateTabId,
  MAX_TABS,
  MIN_TABS,
  type PersistedTabManagerState,
  type PersistedTabState,
  type TabBarItem,
  type TabControllers,
  type TabData,
  type TabDOMElements,
  type TabId,
  type TabManagerCallbacks,
  type TabManagerInterface,
  type TabManagerViewHost,
  TEXTAREA_MAX_HEIGHT_PERCENT,
  TEXTAREA_MIN_MAX_HEIGHT,
  type TabUIComponents,
} from './types';
