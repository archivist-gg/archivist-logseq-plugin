// src/edit/side-buttons.ts
import { lucideIcon } from "../renderers/renderer-utils";
import type { CompendiumContext } from "./block-utils";

export type SideButtonState = "default" | "editing";

export interface SideButtonConfig {
  state: SideButtonState;
  showColumnToggle: boolean;
  isColumnActive: boolean;
  compendiumContext: CompendiumContext | null;
}

export interface SideButtonCallbacks {
  onSource: () => void;
  onColumnToggle: () => void;
  onEdit: () => void;
  onSave: () => void;
  onSaveAsNew: () => void;
  onCancel: () => void;
  onDeleteBlock: () => void;
  onDeleteEntity?: () => void;
}

export function renderSideButtons(config: SideButtonConfig): string {
  const { state, showColumnToggle, isColumnActive, compendiumContext } = config;
  let buttons = "";

  if (state === "editing") {
    if (compendiumContext) {
      if (!compendiumContext.readonly) {
        buttons += sideBtn("save", "check", "archivist-side-btn-save");
      }
      buttons += sideBtn("save-as-new", "plus", "archivist-side-btn-save-as-new");
    } else {
      buttons += sideBtn("save", "check", "archivist-side-btn-save");
    }
    buttons += sideBtn("cancel", "x", "archivist-side-btn-cancel");
  } else {
    buttons += sideBtn("source", "code");
    if (showColumnToggle) {
      buttons += sideBtn("column-toggle", "columns-2", isColumnActive ? "archivist-side-btn active" : "");
    }
    buttons += sideBtn("edit", "pencil");
    buttons += sideBtn("trash", "trash-2");
  }

  return `<div class="archivist-side-btns">${buttons}</div>`;
}

function sideBtn(action: string, icon: string, extraClass?: string): string {
  const cls = `archivist-side-btn${extraClass ? " " + extraClass : ""}`;
  return `<button class="${cls}" data-action="${action}" title="${action}">${lucideIcon(icon)}</button>`;
}

export function renderDeleteMenu(hasCompendiumContext: boolean): string {
  let menu = `<div class="archivist-delete-menu">`;
  menu += sideBtn("cancel-delete", "x", "archivist-side-btn-cancel");
  menu += sideBtn("delete-block", "file-x", "archivist-delete-sub-btn");
  if (hasCompendiumContext) {
    menu += sideBtn("delete-entity", "book-x", "archivist-delete-sub-btn archivist-delete-entity-btn");
  }
  menu += `</div>`;
  return menu;
}

export function wireSideButtonEvents(
  container: HTMLElement,
  callbacks: SideButtonCallbacks,
): void {
  container.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("[data-action]");
    if (!btn) return;
    e.stopPropagation();

    const action = btn.getAttribute("data-action");
    switch (action) {
      case "source": callbacks.onSource(); break;
      case "column-toggle": callbacks.onColumnToggle(); break;
      case "edit": callbacks.onEdit(); break;
      case "save": callbacks.onSave(); break;
      case "save-as-new": callbacks.onSaveAsNew(); break;
      case "cancel": callbacks.onCancel(); break;
      case "trash": handleTrashClick(container, callbacks); break;
      case "cancel-delete": closeDeleteMenu(container); break;
      case "delete-block": callbacks.onDeleteBlock(); break;
      case "delete-entity": callbacks.onDeleteEntity?.(); break;
    }
  });
}

function handleTrashClick(container: HTMLElement, callbacks: SideButtonCallbacks): void {
  const btns = container.querySelector(".archivist-side-btns");
  if (!btns) return;
  const trashBtn = btns.querySelector('[data-action="trash"]');
  if (!trashBtn) return;
  const hasEntity = !!callbacks.onDeleteEntity;
  trashBtn.outerHTML = renderDeleteMenu(hasEntity);
  btns.classList.add("archivist-delete-menu-open");
}

function closeDeleteMenu(container: HTMLElement): void {
  const btns = container.querySelector(".archivist-side-btns");
  if (!btns) return;
  btns.classList.remove("archivist-delete-menu-open");
  const menu = btns.querySelector(".archivist-delete-menu");
  if (menu) {
    menu.outerHTML = sideBtn("trash", "trash-2");
  }
}
