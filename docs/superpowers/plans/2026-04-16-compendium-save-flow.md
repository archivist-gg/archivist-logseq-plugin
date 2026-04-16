# Compendium Save Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the compendium save flow from Obsidian to Logseq — overlay dialog system, three compendium modals, button icon fixes, save flow wiring, and "Save to Compendium" for regular code blocks.

**Architecture:** A reusable `showOverlayDialog()` function renders modal dialogs into Logseq's host document. Three modal functions (`showCreateCompendiumModal`, `showCompendiumSelectModal`, `showSaveAsNewModal`) compose on top of it. The save flow in `index.ts` is rewired to use these modals instead of toasts/inline pickers. Side button icons are updated to use `save-plus` and `book-plus` custom Lucide paths.

**Tech Stack:** TypeScript, Vitest, Logseq plugin API (`@logseq/libs`), CSS, inline SVG (Lucide-style)

**Spec:** `docs/superpowers/specs/2026-04-16-compendium-save-flow-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/edit/overlay-dialog.ts` | Create | Reusable overlay dialog: backdrop + centered parchment panel + Escape/click-outside close |
| `src/edit/compendium-modals.ts` | Create | Three modal functions: `showCreateCompendiumModal`, `showCompendiumSelectModal`, `showSaveAsNewModal` |
| `src/renderers/renderer-utils.ts` | Modify | Add `save-plus` and `book-plus` icon paths to `ICON_PATHS` |
| `src/edit/side-buttons.ts` | Modify | Update editing-state button layout: save-plus for compendium, book-plus for code blocks |
| `src/index.ts` | Modify | Rewire `onSaveAsNew`, add `onSaveToCompendium`, fix Inquiry panel save, remove `showCompendiumPicker` import |
| `src/edit/compendium-picker.ts` | Delete | Replaced by modal system |
| `src/styles/archivist-edit.css` | Modify | Add overlay dialog + form element styles |
| `src/styles/archivist-dnd.css` | Modify | Remove `.archivist-compendium-picker` CSS rules |
| `tests/edit/overlay-dialog.test.ts` | Create | Tests for overlay dialog creation, close behavior |
| `tests/edit/compendium-modals.test.ts` | Create | Tests for modal form rendering and callbacks |
| `tests/edit/side-buttons.test.ts` | Modify | Update tests for new button layouts |

---

### Task 1: Add new icon paths (`save-plus`, `book-plus`)

**Files:**
- Modify: `src/renderers/renderer-utils.ts:91-194` (ICON_PATHS object)
- Modify: `tests/renderers/renderer-utils.test.ts`

- [ ] **Step 1: Write test for new icons**

In `tests/renderers/renderer-utils.test.ts`, add:

```typescript
import { describe, it, expect } from "vitest";
import { lucideIcon } from "../../src/renderers/renderer-utils";

describe("lucideIcon", () => {
  it("renders save-plus icon with floppy disk and plus overlay", () => {
    const html = lucideIcon("save-plus");
    expect(html).toContain("<svg");
    expect(html).toContain("archivist-icon");
    // Should contain both the floppy disk body and a plus sign
    expect(html).toContain("<path");
  });

  it("renders book-plus icon", () => {
    const html = lucideIcon("book-plus");
    expect(html).toContain("<svg");
    expect(html).toContain("archivist-icon");
    expect(html).toContain("<path");
  });

  it("returns empty string for unknown icon", () => {
    expect(lucideIcon("nonexistent-icon")).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/shinoobi/w/archivist-logseq && npx vitest run tests/renderers/renderer-utils.test.ts`
Expected: FAIL — "save-plus" and "book-plus" not in ICON_PATHS, `lucideIcon` returns `""`.

- [ ] **Step 3: Add icon paths**

In `src/renderers/renderer-utils.ts`, add these entries to the `ICON_PATHS` object (after the existing `save` entry at line 193):

```typescript
  "save-plus":
    '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/>' +
    '<path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/>' +
    '<path d="M7 3v4a1 1 0 0 0 1 1h7"/>' +
    '<circle cx="19" cy="19" r="4" fill="#fdf1dc" stroke="currentColor" stroke-width="2"/>' +
    '<path d="M19 17v4"/><path d="M17 19h4"/>',
  "book-plus":
    '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/>' +
    '<path d="M9 10h6"/><path d="M12 7v6"/>',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/shinoobi/w/archivist-logseq && npx vitest run tests/renderers/renderer-utils.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/shinoobi/w/archivist-logseq && git add src/renderers/renderer-utils.ts tests/renderers/renderer-utils.test.ts && git commit -m "feat: add save-plus and book-plus Lucide icon paths"
```

---

### Task 2: Update side buttons for new editing layouts

**Files:**
- Modify: `src/edit/side-buttons.ts:5,14,19,25-48`
- Modify: `tests/edit/side-buttons.test.ts`

- [ ] **Step 1: Update tests for new button layouts**

Replace the full contents of `tests/edit/side-buttons.test.ts` with:

```typescript
// tests/edit/side-buttons.test.ts
import { describe, it, expect } from "vitest";
import { renderSideButtons } from "../../src/edit/side-buttons";

describe("renderSideButtons", () => {
  it("renders source + columns + edit + trash for monster in default state", () => {
    const html = renderSideButtons({
      state: "default",
      showColumnToggle: true,
      isColumnActive: false,
      compendiumContext: null,
    });
    expect(html).toContain('data-action="source"');
    expect(html).toContain('data-action="column-toggle"');
    expect(html).toContain('data-action="edit"');
    expect(html).toContain('data-action="trash"');
  });

  it("renders source + edit + trash for spell (no column toggle)", () => {
    const html = renderSideButtons({
      state: "default",
      showColumnToggle: false,
      isColumnActive: false,
      compendiumContext: null,
    });
    expect(html).toContain('data-action="source"');
    expect(html).not.toContain('data-action="column-toggle"');
    expect(html).toContain('data-action="edit"');
    expect(html).toContain('data-action="trash"');
  });

  it("renders save + save-as-new + cancel for writable compendium", () => {
    const html = renderSideButtons({
      state: "editing",
      showColumnToggle: false,
      isColumnActive: false,
      compendiumContext: { slug: "goblin", compendium: "Homebrew", entityType: "monster", readonly: false },
    });
    expect(html).toContain('data-action="save"');
    expect(html).toContain('data-action="save-as-new"');
    expect(html).toContain('data-action="cancel"');
    expect(html).not.toContain('data-action="save-to-compendium"');
  });

  it("renders only save-as-new + cancel for readonly compendium", () => {
    const html = renderSideButtons({
      state: "editing",
      showColumnToggle: false,
      isColumnActive: false,
      compendiumContext: { slug: "goblin", compendium: "SRD", entityType: "monster", readonly: true },
    });
    expect(html).not.toContain('data-action="save"');
    expect(html).toContain('data-action="save-as-new"');
    expect(html).toContain('data-action="cancel"');
  });

  it("renders save + save-to-compendium + cancel without compendium context", () => {
    const html = renderSideButtons({
      state: "editing",
      showColumnToggle: false,
      isColumnActive: false,
      compendiumContext: null,
    });
    expect(html).toContain('data-action="save"');
    expect(html).toContain('data-action="save-to-compendium"');
    expect(html).toContain('data-action="cancel"');
    expect(html).not.toContain('data-action="save-as-new"');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/shinoobi/w/archivist-logseq && npx vitest run tests/edit/side-buttons.test.ts`
Expected: FAIL — old layout doesn't have `save-to-compendium` or `save-plus` icons.

- [ ] **Step 3: Update side-buttons.ts**

Replace the contents of `src/edit/side-buttons.ts`:

```typescript
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
  onSaveToCompendium: () => void;
  onCancel: () => void;
  onDeleteBlock: () => void;
  onDeleteEntity?: () => void;
}

export function renderSideButtons(config: SideButtonConfig): string {
  const { state, showColumnToggle, isColumnActive, compendiumContext } = config;
  let buttons = "";

  if (state === "editing") {
    if (compendiumContext) {
      // Compendium entity editing
      if (!compendiumContext.readonly) {
        buttons += sideBtn("save", "check", "archivist-side-btn-save");
      }
      buttons += sideBtn("save-as-new", "save-plus", "archivist-side-btn-save-as-new");
    } else {
      // Regular code block editing
      buttons += sideBtn("save", "check", "archivist-side-btn-save");
      buttons += sideBtn("save-to-compendium", "book-plus", "archivist-side-btn-save-to-compendium");
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
  options?: { signal?: AbortSignal },
): void {
  const listenerOptions: AddEventListenerOptions = options?.signal ? { signal: options.signal } : {};
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
      case "save-to-compendium": callbacks.onSaveToCompendium(); break;
      case "cancel": callbacks.onCancel(); break;
      case "trash": handleTrashClick(container, callbacks); break;
      case "cancel-delete": closeDeleteMenu(container); break;
      case "delete-block": callbacks.onDeleteBlock(); break;
      case "delete-entity": callbacks.onDeleteEntity?.(); break;
    }
  }, listenerOptions);
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/shinoobi/w/archivist-logseq && npx vitest run tests/edit/side-buttons.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/shinoobi/w/archivist-logseq && git add src/edit/side-buttons.ts tests/edit/side-buttons.test.ts && git commit -m "feat: update edit buttons — save-plus for compendium, book-plus for code blocks"
```

---

### Task 3: Create overlay dialog system

**Files:**
- Create: `src/edit/overlay-dialog.ts`
- Create: `tests/edit/overlay-dialog.test.ts`

- [ ] **Step 1: Write tests**

Create `tests/edit/overlay-dialog.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { showOverlayDialog } from "../../src/edit/overlay-dialog";

describe("showOverlayDialog", () => {
  let mockDoc: Document;

  beforeEach(() => {
    // Use jsdom's document as the host document
    mockDoc = document;
  });

  afterEach(() => {
    // Clean up any overlay leftovers
    document.querySelectorAll(".archivist-overlay-backdrop").forEach((el) => el.remove());
  });

  it("creates a backdrop and dialog in the host document", () => {
    const { close } = showOverlayDialog({
      hostDoc: mockDoc,
      title: "Test Dialog",
      body: (container) => {
        const p = document.createElement("p");
        p.textContent = "Hello";
        container.appendChild(p);
      },
      primaryLabel: "OK",
      onPrimary: vi.fn(),
    });

    const backdrop = mockDoc.querySelector(".archivist-overlay-backdrop");
    expect(backdrop).toBeTruthy();

    const dialog = backdrop!.querySelector(".archivist-overlay-dialog");
    expect(dialog).toBeTruthy();

    const title = dialog!.querySelector(".archivist-overlay-title");
    expect(title!.textContent).toBe("Test Dialog");

    const body = dialog!.querySelector(".archivist-overlay-body");
    expect(body!.querySelector("p")!.textContent).toBe("Hello");

    const primaryBtn = dialog!.querySelector(".archivist-overlay-btn-primary");
    expect(primaryBtn!.textContent).toBe("OK");

    close();
  });

  it("calls onPrimary when primary button is clicked", () => {
    const onPrimary = vi.fn();
    showOverlayDialog({
      hostDoc: mockDoc,
      title: "Test",
      body: () => {},
      primaryLabel: "Save",
      onPrimary,
    });

    const primaryBtn = mockDoc.querySelector<HTMLElement>(".archivist-overlay-btn-primary");
    primaryBtn!.click();
    expect(onPrimary).toHaveBeenCalledOnce();
  });

  it("closes when cancel button is clicked", () => {
    showOverlayDialog({
      hostDoc: mockDoc,
      title: "Test",
      body: () => {},
      primaryLabel: "Save",
      onPrimary: vi.fn(),
    });

    const cancelBtn = mockDoc.querySelector<HTMLElement>(".archivist-overlay-btn-cancel");
    cancelBtn!.click();

    const backdrop = mockDoc.querySelector(".archivist-overlay-backdrop");
    expect(backdrop).toBeNull();
  });

  it("closes when close() handle is called", () => {
    const { close } = showOverlayDialog({
      hostDoc: mockDoc,
      title: "Test",
      body: () => {},
      primaryLabel: "Save",
      onPrimary: vi.fn(),
    });

    close();
    const backdrop = mockDoc.querySelector(".archivist-overlay-backdrop");
    expect(backdrop).toBeNull();
  });

  it("closes on Escape key", () => {
    showOverlayDialog({
      hostDoc: mockDoc,
      title: "Test",
      body: () => {},
      primaryLabel: "Save",
      onPrimary: vi.fn(),
    });

    mockDoc.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    const backdrop = mockDoc.querySelector(".archivist-overlay-backdrop");
    expect(backdrop).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/shinoobi/w/archivist-logseq && npx vitest run tests/edit/overlay-dialog.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement overlay-dialog.ts**

Create `src/edit/overlay-dialog.ts`:

```typescript
// src/edit/overlay-dialog.ts

export interface OverlayDialogOptions {
  hostDoc: Document;
  title: string;
  body: (container: HTMLElement) => void;
  primaryLabel: string;
  onPrimary: () => void;
  onCancel?: () => void;
}

export interface OverlayDialogHandle {
  close: () => void;
}

export function showOverlayDialog(options: OverlayDialogOptions): OverlayDialogHandle {
  const { hostDoc, title, body, primaryLabel, onPrimary, onCancel } = options;

  // Backdrop
  const backdrop = hostDoc.createElement("div");
  backdrop.className = "archivist-overlay-backdrop";

  // Dialog
  const dialog = hostDoc.createElement("div");
  dialog.className = "archivist-overlay-dialog";

  // Title
  const titleEl = hostDoc.createElement("h3");
  titleEl.className = "archivist-overlay-title";
  titleEl.textContent = title;
  dialog.appendChild(titleEl);

  // Body
  const bodyEl = hostDoc.createElement("div");
  bodyEl.className = "archivist-overlay-body";
  body(bodyEl);
  dialog.appendChild(bodyEl);

  // Footer
  const footer = hostDoc.createElement("div");
  footer.className = "archivist-overlay-footer";

  const cancelBtn = hostDoc.createElement("button");
  cancelBtn.className = "archivist-overlay-btn archivist-overlay-btn-cancel";
  cancelBtn.textContent = "Cancel";
  cancelBtn.type = "button";

  const primaryBtn = hostDoc.createElement("button");
  primaryBtn.className = "archivist-overlay-btn archivist-overlay-btn-primary";
  primaryBtn.textContent = primaryLabel;
  primaryBtn.type = "button";

  footer.appendChild(cancelBtn);
  footer.appendChild(primaryBtn);
  dialog.appendChild(footer);

  backdrop.appendChild(dialog);
  hostDoc.body.appendChild(backdrop);

  // --- Close behavior ---
  function close(): void {
    backdrop.remove();
    hostDoc.removeEventListener("keydown", onKeydown);
  }

  cancelBtn.addEventListener("click", () => {
    close();
    onCancel?.();
  });

  primaryBtn.addEventListener("click", () => {
    onPrimary();
  });

  // Click outside dialog to close
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) {
      close();
      onCancel?.();
    }
  });

  // Escape key
  function onKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      close();
      onCancel?.();
    }
  }
  hostDoc.addEventListener("keydown", onKeydown);

  return { close };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/shinoobi/w/archivist-logseq && npx vitest run tests/edit/overlay-dialog.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/shinoobi/w/archivist-logseq && git add src/edit/overlay-dialog.ts tests/edit/overlay-dialog.test.ts && git commit -m "feat: add reusable overlay dialog system for Logseq"
```

---

### Task 4: Create compendium modal functions

**Files:**
- Create: `src/edit/compendium-modals.ts`
- Create: `tests/edit/compendium-modals.test.ts`

- [ ] **Step 1: Write tests**

Create `tests/edit/compendium-modals.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  showCreateCompendiumModal,
  showCompendiumSelectModal,
  showSaveAsNewModal,
} from "../../src/edit/compendium-modals";
import type { Compendium } from "../../src/entities/compendium-manager";

describe("showCreateCompendiumModal", () => {
  afterEach(() => {
    document.querySelectorAll(".archivist-overlay-backdrop").forEach((el) => el.remove());
  });

  it("renders name and description fields", () => {
    showCreateCompendiumModal({
      hostDoc: document,
      onCreate: vi.fn(),
    });

    const nameInput = document.querySelector<HTMLInputElement>('input[data-field="name"]');
    const descInput = document.querySelector<HTMLInputElement>('input[data-field="description"]');
    expect(nameInput).toBeTruthy();
    expect(descInput).toBeTruthy();
  });

  it("calls onCreate with trimmed name and description", () => {
    const onCreate = vi.fn();
    showCreateCompendiumModal({
      hostDoc: document,
      onCreate,
    });

    const nameInput = document.querySelector<HTMLInputElement>('input[data-field="name"]')!;
    const descInput = document.querySelector<HTMLInputElement>('input[data-field="description"]')!;
    const primaryBtn = document.querySelector<HTMLElement>(".archivist-overlay-btn-primary")!;

    // Simulate typing
    nameInput.value = "  Homebrew  ";
    descInput.value = "My compendium";
    primaryBtn.click();

    expect(onCreate).toHaveBeenCalledWith("Homebrew", "My compendium");
  });

  it("does not call onCreate if name is empty", () => {
    const onCreate = vi.fn();
    showCreateCompendiumModal({
      hostDoc: document,
      onCreate,
    });

    const primaryBtn = document.querySelector<HTMLElement>(".archivist-overlay-btn-primary")!;
    primaryBtn.click();
    expect(onCreate).not.toHaveBeenCalled();
  });
});

describe("showCompendiumSelectModal", () => {
  const comps: Compendium[] = [
    { name: "Homebrew", description: "My homebrew", readonly: false, homebrew: true },
    { name: "Campaign", description: "Campaign stuff", readonly: false, homebrew: true },
  ];

  afterEach(() => {
    document.querySelectorAll(".archivist-overlay-backdrop").forEach((el) => el.remove());
  });

  it("renders a dropdown with all compendiums plus new option", () => {
    showCompendiumSelectModal({
      hostDoc: document,
      compendiums: comps,
      onSelect: vi.fn(),
      onCreateNew: vi.fn(),
    });

    const select = document.querySelector<HTMLSelectElement>('select[data-field="compendium"]')!;
    // 2 compendiums + 1 "new" option
    expect(select.options.length).toBe(3);
    expect(select.options[0].value).toBe("Homebrew");
    expect(select.options[1].value).toBe("Campaign");
    expect(select.options[2].value).toBe("__new__");
  });

  it("calls onSelect with the selected compendium", () => {
    const onSelect = vi.fn();
    showCompendiumSelectModal({
      hostDoc: document,
      compendiums: comps,
      onSelect,
      onCreateNew: vi.fn(),
    });

    const select = document.querySelector<HTMLSelectElement>('select[data-field="compendium"]')!;
    select.value = "Campaign";
    const primaryBtn = document.querySelector<HTMLElement>(".archivist-overlay-btn-primary")!;
    primaryBtn.click();

    expect(onSelect).toHaveBeenCalledWith(comps[1]);
  });

  it("calls onCreateNew when + New Compendium is selected and confirmed", () => {
    const onCreateNew = vi.fn();
    showCompendiumSelectModal({
      hostDoc: document,
      compendiums: comps,
      onSelect: vi.fn(),
      onCreateNew,
    });

    const select = document.querySelector<HTMLSelectElement>('select[data-field="compendium"]')!;
    select.value = "__new__";
    select.dispatchEvent(new Event("change"));

    expect(onCreateNew).toHaveBeenCalledOnce();
  });
});

describe("showSaveAsNewModal", () => {
  const comps: Compendium[] = [
    { name: "Homebrew", description: "My homebrew", readonly: false, homebrew: true },
  ];

  afterEach(() => {
    document.querySelectorAll(".archivist-overlay-backdrop").forEach((el) => el.remove());
  });

  it("renders name field pre-filled and compendium dropdown", () => {
    showSaveAsNewModal({
      hostDoc: document,
      compendiums: comps,
      defaultName: "Fire Drake",
      onSave: vi.fn(),
      onCreateNew: vi.fn(),
    });

    const nameInput = document.querySelector<HTMLInputElement>('input[data-field="entity-name"]')!;
    expect(nameInput.value).toBe("Fire Drake");

    const select = document.querySelector<HTMLSelectElement>('select[data-field="compendium"]')!;
    expect(select.options.length).toBe(2); // 1 compendium + new
  });

  it("calls onSave with selected compendium and entered name", () => {
    const onSave = vi.fn();
    showSaveAsNewModal({
      hostDoc: document,
      compendiums: comps,
      defaultName: "Fire Drake",
      onSave,
      onCreateNew: vi.fn(),
    });

    const primaryBtn = document.querySelector<HTMLElement>(".archivist-overlay-btn-primary")!;
    primaryBtn.click();

    expect(onSave).toHaveBeenCalledWith(comps[0], "Fire Drake");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/shinoobi/w/archivist-logseq && npx vitest run tests/edit/compendium-modals.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement compendium-modals.ts**

Create `src/edit/compendium-modals.ts`:

```typescript
// src/edit/compendium-modals.ts
import { showOverlayDialog } from "./overlay-dialog";
import type { Compendium } from "../entities/compendium-manager";

const NEW_KEY = "__new__";

// ---------------------------------------------------------------------------
// CreateCompendiumModal
// ---------------------------------------------------------------------------

export interface CreateCompendiumModalOptions {
  hostDoc: Document;
  onCreate: (name: string, description: string) => void;
}

export function showCreateCompendiumModal(options: CreateCompendiumModalOptions): void {
  const { hostDoc, onCreate } = options;

  let nameValue = "";
  let descValue = "";

  const { close } = showOverlayDialog({
    hostDoc,
    title: "New Compendium",
    body: (container) => {
      container.appendChild(formRow(hostDoc, "Name", (row) => {
        const input = hostDoc.createElement("input");
        input.type = "text";
        input.dataset.field = "name";
        input.placeholder = "e.g. Homebrew, Campaign Notes";
        input.className = "archivist-overlay-input";
        input.addEventListener("input", () => { nameValue = input.value; });
        row.appendChild(input);
      }));

      container.appendChild(formRow(hostDoc, "Description", (row) => {
        const input = hostDoc.createElement("input");
        input.type = "text";
        input.dataset.field = "description";
        input.placeholder = "Optional description";
        input.className = "archivist-overlay-input";
        input.addEventListener("input", () => { descValue = input.value; });
        row.appendChild(input);
      }));
    },
    primaryLabel: "Create",
    onPrimary: () => {
      const name = nameValue.trim();
      if (!name) return;
      close();
      onCreate(name, descValue.trim());
    },
  });
}

// ---------------------------------------------------------------------------
// CompendiumSelectModal
// ---------------------------------------------------------------------------

export interface CompendiumSelectModalOptions {
  hostDoc: Document;
  compendiums: Compendium[];
  onSelect: (compendium: Compendium) => void;
  onCreateNew: () => void;
}

export function showCompendiumSelectModal(options: CompendiumSelectModalOptions): void {
  const { hostDoc, compendiums, onSelect, onCreateNew } = options;

  let selected: Compendium = compendiums[0];

  const { close } = showOverlayDialog({
    hostDoc,
    title: "Select Compendium",
    body: (container) => {
      container.appendChild(formRow(hostDoc, "Compendium", (row) => {
        const select = hostDoc.createElement("select");
        select.dataset.field = "compendium";
        select.className = "archivist-overlay-select";

        for (const comp of compendiums) {
          const opt = hostDoc.createElement("option");
          opt.value = comp.name;
          opt.textContent = `${comp.name} — ${comp.description}`;
          select.appendChild(opt);
        }

        const newOpt = hostDoc.createElement("option");
        newOpt.value = NEW_KEY;
        newOpt.textContent = "+ New Compendium...";
        select.appendChild(newOpt);

        select.addEventListener("change", () => {
          if (select.value === NEW_KEY) {
            close();
            onCreateNew();
            return;
          }
          const found = compendiums.find((c) => c.name === select.value);
          if (found) selected = found;
        });

        row.appendChild(select);
      }));
    },
    primaryLabel: "Save",
    onPrimary: () => {
      close();
      onSelect(selected);
    },
  });
}

// ---------------------------------------------------------------------------
// SaveAsNewModal
// ---------------------------------------------------------------------------

export interface SaveAsNewModalOptions {
  hostDoc: Document;
  compendiums: Compendium[];
  defaultName: string;
  onSave: (compendium: Compendium, name: string) => void;
  onCreateNew: () => void;
}

export function showSaveAsNewModal(options: SaveAsNewModalOptions): void {
  const { hostDoc, compendiums, defaultName, onSave, onCreateNew } = options;

  let entityName = defaultName;
  let selected: Compendium = compendiums[0];

  const { close } = showOverlayDialog({
    hostDoc,
    title: "Save As New Entity",
    body: (container) => {
      // Entity name
      container.appendChild(formRow(hostDoc, "Name", (row) => {
        const input = hostDoc.createElement("input");
        input.type = "text";
        input.dataset.field = "entity-name";
        input.value = defaultName;
        input.placeholder = "Entity name";
        input.className = "archivist-overlay-input";
        input.addEventListener("input", () => { entityName = input.value; });
        row.appendChild(input);
      }));

      // Compendium dropdown
      container.appendChild(formRow(hostDoc, "Compendium", (row) => {
        const select = hostDoc.createElement("select");
        select.dataset.field = "compendium";
        select.className = "archivist-overlay-select";

        for (const comp of compendiums) {
          const opt = hostDoc.createElement("option");
          opt.value = comp.name;
          opt.textContent = `${comp.name} — ${comp.description}`;
          select.appendChild(opt);
        }

        const newOpt = hostDoc.createElement("option");
        newOpt.value = NEW_KEY;
        newOpt.textContent = "+ New Compendium...";
        select.appendChild(newOpt);

        select.addEventListener("change", () => {
          if (select.value === NEW_KEY) {
            close();
            onCreateNew();
            return;
          }
          const found = compendiums.find((c) => c.name === select.value);
          if (found) selected = found;
        });

        row.appendChild(select);
      }));
    },
    primaryLabel: "Save",
    onPrimary: () => {
      const name = entityName.trim();
      if (!name || !selected) return;
      close();
      onSave(selected, name);
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formRow(
  doc: Document,
  label: string,
  buildInput: (row: HTMLElement) => void,
): HTMLElement {
  const row = doc.createElement("div");
  row.className = "archivist-overlay-form-row";

  const labelEl = doc.createElement("label");
  labelEl.className = "archivist-overlay-label";
  labelEl.textContent = label;
  row.appendChild(labelEl);

  buildInput(row);
  return row;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/shinoobi/w/archivist-logseq && npx vitest run tests/edit/compendium-modals.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/shinoobi/w/archivist-logseq && git add src/edit/compendium-modals.ts tests/edit/compendium-modals.test.ts && git commit -m "feat: add compendium modal functions (create, select, save-as-new)"
```

---

### Task 5: Add overlay dialog and form CSS

**Files:**
- Modify: `src/styles/archivist-edit.css`
- Modify: `src/styles/archivist-dnd.css:1748-1772`

- [ ] **Step 1: Add overlay CSS to archivist-edit.css**

Append to the end of `src/styles/archivist-edit.css`:

```css
/* ==========================================================================
   Overlay Dialog
   Parchment-themed modal for compendium operations.
   ========================================================================== */

.archivist-overlay-backdrop {
  position: fixed;
  inset: 0;
  z-index: 99999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
}

.archivist-overlay-dialog {
  width: 100%;
  max-width: 400px;
  background: #fdf1dc;
  border: 1px dashed #d9c484;
  border-radius: 6px;
  padding: 20px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
  font-family: "Noto Sans", "Helvetica Neue", Helvetica, Arial, sans-serif;
  color: #191813;
}

.archivist-overlay-title {
  margin: 0 0 16px;
  font-size: 16px;
  font-weight: 600;
  color: #7a200d;
}

.archivist-overlay-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.archivist-overlay-form-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.archivist-overlay-label {
  font-size: 13px;
  font-weight: normal;
  color: #191813;
}

.archivist-overlay-input,
.archivist-overlay-select {
  width: 100%;
  padding: 6px 8px;
  font-size: 13px;
  font-family: "Noto Sans", "Helvetica Neue", Helvetica, Arial, sans-serif;
  color: #191813;
  background: #fdf1dc;
  border: 1px dashed #d9c484;
  border-radius: 4px;
  box-sizing: border-box;
  outline: none;
}

.archivist-overlay-input:focus,
.archivist-overlay-select:focus {
  border-style: solid;
  border-color: #922610;
}

.archivist-overlay-input::placeholder {
  color: #b5a67a;
}

.archivist-overlay-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.archivist-overlay-btn {
  padding: 6px 16px;
  font-size: 13px;
  font-family: "Noto Sans", "Helvetica Neue", Helvetica, Arial, sans-serif;
  border: 1px solid #d9c484;
  border-radius: 4px;
  cursor: pointer;
  background: #fdf1dc;
  color: #191813;
}

.archivist-overlay-btn:hover {
  background: #f0e3c0;
}

.archivist-overlay-btn-primary {
  background: #922610;
  color: #fdf1dc;
  border-color: #922610;
}

.archivist-overlay-btn-primary:hover {
  background: #7a200d;
}
```

- [ ] **Step 2: Remove old compendium picker CSS from archivist-dnd.css**

In `src/styles/archivist-dnd.css`, delete lines 1748–1772 (the `/* Inline compendium picker dropdown */` comment and the three rules `.archivist-compendium-picker`, `.archivist-compendium-picker-option`, `.archivist-compendium-picker-option:hover`).

- [ ] **Step 3: Verify build succeeds**

Run: `cd /Users/shinoobi/w/archivist-logseq && npm run build`
Expected: Build completes without errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/shinoobi/w/archivist-logseq && git add src/styles/archivist-edit.css src/styles/archivist-dnd.css && git commit -m "feat: add overlay dialog CSS, remove old compendium picker styles"
```

---

### Task 6: Rewire save flows in index.ts and delete compendium-picker.ts

**Files:**
- Modify: `src/index.ts:1-39,153-249,440-460`
- Delete: `src/edit/compendium-picker.ts`

- [ ] **Step 1: Update imports in index.ts**

In `src/index.ts`, replace the import line:

```typescript
import { showCompendiumPicker } from "./edit/compendium-picker";
```

with:

```typescript
import {
  showCreateCompendiumModal,
  showCompendiumSelectModal,
  showSaveAsNewModal,
} from "./edit/compendium-modals";
```

- [ ] **Step 2: Add `onSaveToCompendium` to EditCallbacks and buildCallbacks**

In `src/index.ts`, update the `EditCallbacks` interface (around line 35):

```typescript
export interface EditCallbacks {
  onSave: (yaml: string) => Promise<void>;
  onSaveAsNew: (yaml: string, entityName: string) => Promise<void>;
  onSaveToCompendium: (yaml: string, entityName: string) => Promise<void>;
  onCancel: () => void;
}
```

In `buildCallbacks()` (around line 153), add `onSaveToCompendium` to the returned object:

```typescript
onSaveToCompendium: () => {}, // handled by edit callbacks
```

- [ ] **Step 3: Add getHostDoc helper function**

Add a helper near the top of the file (after the `managerRef` / `registryRef` declarations around line 42):

```typescript
function getHostDoc(): Document {
  return parent?.document ?? top?.document ?? document;
}
```

- [ ] **Step 4: Rewrite onSaveAsNew in buildEditCallbacks**

Replace the `onSaveAsNew` property in `buildEditCallbacks()` (lines 213–230) with:

```typescript
        onSaveAsNew: async (yaml: string, entityName: string) => {
          if (!managerRef) return;
          const hostDoc = getHostDoc();
          const compendiums = managerRef.getWritable();

          if (compendiums.length === 0) {
            // No writable compendiums — offer to create one
            showCreateCompendiumModal({
              hostDoc,
              onCreate: async (name, description) => {
                const comp = await managerRef!.create(name, description || `${name} compendium`, true, false);
                await logseq.UI.showMsg(`Created compendium: ${name}`, "success");
                await saveToCompendium(comp, yaml, entityName);
              },
            });
          } else if (compendiums.length === 1) {
            await saveToCompendium(compendiums[0], yaml, entityName);
          } else {
            showCompendiumSelectModal({
              hostDoc,
              compendiums,
              onSelect: async (comp) => {
                await saveToCompendium(comp, yaml, entityName);
              },
              onCreateNew: () => {
                showCreateCompendiumModal({
                  hostDoc,
                  onCreate: async (name, description) => {
                    const comp = await managerRef!.create(name, description || `${name} compendium`, true, false);
                    await logseq.UI.showMsg(`Created compendium: ${name}`, "success");
                    await saveToCompendium(comp, yaml, entityName);
                  },
                });
              },
            });
          }
        },
```

- [ ] **Step 5: Add onSaveToCompendium in buildEditCallbacks**

Add `onSaveToCompendium` to `buildEditCallbacks()`, right after `onSaveAsNew`:

```typescript
        onSaveToCompendium: async (yaml: string, entityName: string) => {
          if (!managerRef) return;
          const hostDoc = getHostDoc();
          const compendiums = managerRef.getWritable();

          const doSave = async (comp: { name: string }, finalName: string) => {
            await saveToCompendium(comp, yaml, finalName);
          };

          if (compendiums.length === 0) {
            // No writable compendiums — create one, then save
            showCreateCompendiumModal({
              hostDoc,
              onCreate: async (name, description) => {
                const comp = await managerRef!.create(name, description || `${name} compendium`, true, false);
                await logseq.UI.showMsg(`Created compendium: ${name}`, "success");
                await doSave(comp, entityName);
              },
            });
          } else {
            showSaveAsNewModal({
              hostDoc,
              compendiums,
              defaultName: entityName,
              onSave: async (comp, finalName) => {
                await doSave(comp, finalName);
              },
              onCreateNew: () => {
                showCreateCompendiumModal({
                  hostDoc,
                  onCreate: async (name, description) => {
                    const comp = await managerRef!.create(name, description || `${name} compendium`, true, false);
                    await logseq.UI.showMsg(`Created compendium: ${name}`, "success");
                    await doSave(comp, entityName);
                  },
                });
              },
            });
          }
        },
```

- [ ] **Step 6: Fix Inquiry panel save flow**

Replace the Inquiry panel's save callback (around lines 445–458). Change:

```typescript
      const writable = managerRef.getWritable();
      if (writable.length === 0) {
        await logseq.UI.showMsg("No writable compendiums. Create one first.", "warning");
        return undefined;
      }
      const comp = writable[0];
      const entity = await managerRef.saveEntity(comp.name, entityType, { ...data, name });
      await logseq.UI.showMsg(`Saved "${name}" to ${comp.name}`, "success");
      return entity.slug;
```

to:

```typescript
      const writable = managerRef.getWritable();
      if (writable.length === 0) {
        // No writable compendiums — open create modal, return a promise
        return new Promise<string | undefined>((resolve) => {
          showCreateCompendiumModal({
            hostDoc: getHostDoc(),
            onCreate: async (compName, description) => {
              const comp = await managerRef!.create(compName, description || `${compName} compendium`, true, false);
              await logseq.UI.showMsg(`Created compendium: ${compName}`, "success");
              const entity = await managerRef!.saveEntity(comp.name, entityType, { ...data, name });
              await logseq.UI.showMsg(`Saved "${name}" to ${comp.name}`, "success");
              resolve(entity.slug);
            },
          });
        });
      }
      const comp = writable[0];
      const entity = await managerRef.saveEntity(comp.name, entityType, { ...data, name });
      await logseq.UI.showMsg(`Saved "${name}" to ${comp.name}`, "success");
      return entity.slug;
```

- [ ] **Step 7: Delete compendium-picker.ts**

```bash
cd /Users/shinoobi/w/archivist-logseq && rm src/edit/compendium-picker.ts
```

- [ ] **Step 8: Wire save-to-compendium in edit renderers**

In each of the three edit renderer files, add a click handler for `[data-action="save-to-compendium"]` alongside the existing `save-as-new` handler.

In `src/edit/monster-edit-render.ts`, after the save-as-new handler (around line 715), add:

```typescript
  // -- Wire save-to-compendium button --
  const saveToCompBtn = container.querySelector<HTMLElement>('[data-action="save-to-compendium"]');
  if (saveToCompBtn) {
    saveToCompBtn.addEventListener("click", () => {
      callbacks.onSaveToCompendium(state.toYaml(), state.current.name);
    });
  }
```

In `src/edit/spell-edit-render.ts`, after the save-as-new handler (around line 334), add:

```typescript
  // -- Wire save-to-compendium button --
  const saveToCompBtn = container.querySelector<HTMLElement>('[data-action="save-to-compendium"]');
  if (saveToCompBtn) {
    saveToCompBtn.addEventListener("click", () => {
      const clean = buildCleanSpell(draft);
      const yamlStr = yaml.dump(clean, {
        lineWidth: -1,
        quotingType: "\"",
        forceQuotes: false,
        sortKeys: false,
        noRefs: true,
      });
      callbacks.onSaveToCompendium(yamlStr, draft.name);
    });
  }
```

In `src/edit/item-edit-render.ts`, after the save-as-new handler (around line 323), add:

```typescript
  // -- Wire save-to-compendium button --
  const saveToCompBtn = container.querySelector<HTMLElement>('[data-action="save-to-compendium"]');
  if (saveToCompBtn) {
    saveToCompBtn.addEventListener("click", () => {
      const clean = buildCleanItem(draft);
      const yamlStr = yaml.dump(clean, {
        lineWidth: -1,
        quotingType: "\"",
        forceQuotes: false,
        sortKeys: false,
        noRefs: true,
      });
      callbacks.onSaveToCompendium(yamlStr, draft.name);
    });
  }
```

- [ ] **Step 9: Verify build succeeds**

Run: `cd /Users/shinoobi/w/archivist-logseq && npm run build`
Expected: Build completes without errors.

- [ ] **Step 10: Run all tests**

Run: `cd /Users/shinoobi/w/archivist-logseq && npx vitest run`
Expected: All tests pass. Some existing tests in `tests/edit/monster-edit-render.test.ts`, `tests/edit/spell-edit-render.test.ts`, or `tests/edit/item-edit-render.test.ts` may fail if they mock `EditCallbacks` without `onSaveToCompendium`. If so, add `onSaveToCompendium: vi.fn()` to those test mocks.

- [ ] **Step 11: Commit**

```bash
cd /Users/shinoobi/w/archivist-logseq && git add -A && git commit -m "feat: rewire save flows to use compendium modals, add save-to-compendium for code blocks"
```

---

### Task 7: Manual integration test

**Files:** None (testing only)

- [ ] **Step 1: Build and deploy**

Run: `cd /Users/shinoobi/w/archivist-logseq && npm run build`

- [ ] **Step 2: Test readonly compendium (SRD) edit flow**

1. Open Logseq, navigate to an SRD entity page (e.g., SRD/Monsters/Goblin)
2. Click Edit
3. Verify: save-as-new button shows floppy-disk-with-plus icon (not "+"), cancel shows "X", no checkmark button
4. Make a small edit, click save-as-new
5. If no writable compendiums exist: verify the "New Compendium" overlay dialog appears with Name + Description fields
6. Create a compendium named "Homebrew"
7. Verify: entity is saved to the new compendium, success toast shown

- [ ] **Step 3: Test writable compendium edit flow**

1. Navigate to the Homebrew entity just created
2. Click Edit
3. Verify: checkmark (save), save-as-new (floppy-disk-with-plus), cancel (X) all visible
4. Make a small edit, click checkmark — verify in-place save works
5. Click edit again, click save-as-new — verify CompendiumSelectModal appears if 2+ writable compendiums exist, or saves directly if only 1

- [ ] **Step 4: Test regular code block edit flow**

1. In any Logseq page, create a new `monster` code block with basic YAML
2. Click Edit
3. Verify: checkmark (save), book-plus (save to compendium), cancel (X) all visible
4. Click book-plus — verify SaveAsNewModal appears with entity name field and compendium dropdown
5. Save to a compendium, verify success

- [ ] **Step 5: Test Inquiry panel save**

1. Open Claudian (Cmd+Shift+I)
2. Ask it to generate a monster
3. Click the save button on the generated entity
4. Verify: if no writable compendiums, Create Compendium modal appears; otherwise saves directly
