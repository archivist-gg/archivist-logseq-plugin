# Compendium Save Flow — Design Spec

**Date:** 2026-04-16
**Status:** Approved

## Problem

The Logseq port of archivist has two broken flows in edit mode:

1. **Confusing button icons:** When editing a readonly compendium entity (e.g., SRD monster), the save-as-new button shows a "+" icon, which users mistake for "add" rather than "save as new". Expected: a floppy-disk-with-plus icon.

2. **Missing Create Compendium UI:** Clicking save-as-new when no writable compendiums exist shows a toast error ("No writable compendiums available") instead of offering to create one. The Obsidian version opens a `CreateCompendiumModal` — this was never ported to Logseq.

3. **No "Save to Compendium" for regular code blocks:** Entities written as inline YAML code blocks (not on a compendium page) have no way to be saved to a compendium from edit mode.

## Solution

Port Obsidian's modal system as a floating overlay dialog, implement all three compendium modals, fix button icons, and add a "Save to Compendium" action for regular code blocks.

## Design

### 1. Overlay Dialog System

**File:** `src/edit/overlay-dialog.ts`

A reusable `showOverlayDialog(options)` function that:

- Creates a backdrop (`div.archivist-overlay-backdrop`) with click-outside-to-close
- Centers a parchment-themed dialog (`div.archivist-overlay-dialog`) with title, body, and footer
- Footer has Cancel + primary action button
- Appends to `document.body` (or Logseq's host document)
- Returns a `close()` handle for programmatic dismissal
- Handles Escape key to close

### 2. Three Modals

**File:** `src/edit/compendium-modals.ts`

All three render into the overlay dialog.

**CreateCompendiumModal:**
- Title: "New Compendium"
- Fields: Name (required), Description (optional)
- Buttons: Cancel, Create (primary)
- On create: `CompendiumManager.create(name, desc, homebrew=true, readonly=false)`
- Callback: `onCreated(compendium)`

**CompendiumSelectModal:**
- Title: "Select Compendium"
- Dropdown of writable compendiums + "+ New Compendium..." option
- Selecting "+ New" closes dialog, opens CreateCompendiumModal with chained callback
- Buttons: Cancel, Save (primary)
- Callback: `onSelect(compendium)`

**SaveAsNewModal:**
- Title: "Save As New Entity"
- Fields: Name (pre-filled), Compendium dropdown (with "+ New" option)
- Buttons: Cancel, Save (primary)
- Callback: `onSave(compendium, name)`

### 3. Button Changes

**File:** `src/edit/side-buttons.ts`

Three editing contexts with distinct button layouts:

| Context | Buttons (left to right) |
|---------|------------------------|
| Readonly compendium (SRD) | save-plus (save-as-new) → X (cancel) |
| Writable compendium (Homebrew) | check (save) → save-plus (save-as-new) → X (cancel) |
| Regular code block | check (save) → book-plus (save to compendium) → X (cancel) |

**New icons in `renderer-utils.ts`:**
- `save-plus`: floppy disk with small `+` in corner — signals "save as new copy"
- `book-plus`: book with `+` — signals "add to compendium"

### 4. Save Flow Wiring

**File:** `src/index.ts`

**onSaveAsNew** (replaces current implementation):
1. `managerRef.getWritable()`
2. Zero writable → `CreateCompendiumModal` → save to new compendium
3. One writable → save directly
4. Multiple writable → `CompendiumSelectModal` (with "+ New") → save to selected

**New onSaveToCompendium** (for regular code blocks):
Same flow as onSaveAsNew but opens `SaveAsNewModal` (includes entity name field since the entity isn't in a compendium yet).

**Inquiry panel fix** (line ~452):
Same pattern — zero writable opens `CreateCompendiumModal` instead of toast error.

**SideButtonCallbacks interface:**
Add `onSaveToCompendium` alongside `onSave`, `onSaveAsNew`, `onCancel`.

**Remove `compendium-picker.ts`:**
The inline dropdown is replaced by the modal system. Remove the function and its CSS.

### 5. CSS

**File:** `src/styles/archivist-edit.css`

**Overlay backdrop:** fixed full-viewport, `rgba(0,0,0,0.5)`, high z-index.

**Overlay dialog:** centered, max-width ~400px, parchment background (`#fdf1dc`), `1px dashed #d9c484` border.

**Form elements:** text inputs and dropdowns with dashed borders, focus solid `#922610`. Labels black, normal weight. Primary button crimson (`#922610`), cancel button neutral.

**Cleanup:** Remove `.archivist-compendium-picker` and `.archivist-compendium-picker-option` from `archivist-dnd.css`.
