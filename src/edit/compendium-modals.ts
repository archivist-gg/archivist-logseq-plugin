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

  let nameInput: HTMLInputElement;
  let descInput: HTMLInputElement;

  const { close } = showOverlayDialog({
    hostDoc,
    title: "New Compendium",
    body: (container) => {
      container.appendChild(formRow(hostDoc, "Name", (row) => {
        nameInput = hostDoc.createElement("input");
        nameInput.type = "text";
        nameInput.dataset.field = "name";
        nameInput.placeholder = "e.g. Homebrew, Campaign Notes";
        nameInput.className = "archivist-overlay-input";
        row.appendChild(nameInput);
      }));

      container.appendChild(formRow(hostDoc, "Description", (row) => {
        descInput = hostDoc.createElement("input");
        descInput.type = "text";
        descInput.dataset.field = "description";
        descInput.placeholder = "Optional description";
        descInput.className = "archivist-overlay-input";
        row.appendChild(descInput);
      }));
    },
    primaryLabel: "Create",
    onPrimary: () => {
      const name = nameInput.value.trim();
      if (!name) return;
      close();
      onCreate(name, descInput.value.trim());
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

  let selectEl: HTMLSelectElement;

  const { close } = showOverlayDialog({
    hostDoc,
    title: "Select Compendium",
    body: (container) => {
      container.appendChild(formRow(hostDoc, "Compendium", (row) => {
        selectEl = hostDoc.createElement("select");
        selectEl.dataset.field = "compendium";
        selectEl.className = "archivist-overlay-select";

        for (const comp of compendiums) {
          const opt = hostDoc.createElement("option");
          opt.value = comp.name;
          opt.textContent = `${comp.name} — ${comp.description}`;
          selectEl.appendChild(opt);
        }

        const newOpt = hostDoc.createElement("option");
        newOpt.value = NEW_KEY;
        newOpt.textContent = "+ New Compendium...";
        selectEl.appendChild(newOpt);

        selectEl.addEventListener("change", () => {
          if (selectEl.value === NEW_KEY) {
            close();
            onCreateNew();
          }
        });

        row.appendChild(selectEl);
      }));
    },
    primaryLabel: "Save",
    onPrimary: () => {
      const found = compendiums.find((c) => c.name === selectEl.value);
      if (!found) return;
      close();
      onSelect(found);
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

  let nameInput: HTMLInputElement;
  let selectEl: HTMLSelectElement;

  const { close } = showOverlayDialog({
    hostDoc,
    title: "Save As New Entity",
    body: (container) => {
      // Entity name
      container.appendChild(formRow(hostDoc, "Name", (row) => {
        nameInput = hostDoc.createElement("input");
        nameInput.type = "text";
        nameInput.dataset.field = "entity-name";
        nameInput.value = defaultName;
        nameInput.placeholder = "Entity name";
        nameInput.className = "archivist-overlay-input";
        row.appendChild(nameInput);
      }));

      // Compendium dropdown
      container.appendChild(formRow(hostDoc, "Compendium", (row) => {
        selectEl = hostDoc.createElement("select");
        selectEl.dataset.field = "compendium";
        selectEl.className = "archivist-overlay-select";

        for (const comp of compendiums) {
          const opt = hostDoc.createElement("option");
          opt.value = comp.name;
          opt.textContent = `${comp.name} — ${comp.description}`;
          selectEl.appendChild(opt);
        }

        const newOpt = hostDoc.createElement("option");
        newOpt.value = NEW_KEY;
        newOpt.textContent = "+ New Compendium...";
        selectEl.appendChild(newOpt);

        selectEl.addEventListener("change", () => {
          if (selectEl.value === NEW_KEY) {
            close();
            onCreateNew();
          }
        });

        row.appendChild(selectEl);
      }));
    },
    primaryLabel: "Save",
    onPrimary: () => {
      const name = nameInput.value.trim();
      const found = compendiums.find((c) => c.name === selectEl.value);
      if (!name || !found) return;
      close();
      onSave(found, name);
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
