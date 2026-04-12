// src/edit/item-edit-render.ts
// Item edit form renderer — converts Obsidian DOM manipulation to HTML string output.

import * as yaml from "js-yaml";
import { escapeHtml, createSvgBar, lucideIcon } from "../renderers/renderer-utils";
import type { Item } from "../types/item";
import type { CompendiumContext } from "./block-utils";
import type { EditCallbacks } from "../index";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ITEM_TYPES = [
  "Armor", "Weapon", "Potion", "Ring", "Rod", "Scroll",
  "Staff", "Wand", "Wondrous Item", "Adventuring Gear",
];

const ITEM_RARITIES = [
  "Common", "Uncommon", "Rare", "Very Rare", "Legendary", "Artifact",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function selectOptions(values: string[], selectedValue: string, placeholder: string): string {
  const opts: string[] = [];
  const sel = !selectedValue;
  opts.push(`<option value=""${sel ? " selected" : ""}>${escapeHtml(placeholder)}</option>`);
  for (const v of values) {
    const selected = v.toLowerCase() === selectedValue.toLowerCase();
    opts.push(`<option value="${escapeHtml(v.toLowerCase())}"${selected ? " selected" : ""}>${escapeHtml(v)}</option>`);
  }
  return opts.join("");
}

function editableProperty(
  iconName: string,
  label: string,
  field: string,
  value: string,
): string {
  const iconSvg = lucideIcon(iconName);
  return (
    '<div class="archivist-property-line">' +
    `<div class="archivist-property-icon">${iconSvg}</div>` +
    `<div class="archivist-property-name">${escapeHtml(label)}</div>` +
    `<input class="archivist-edit-input wide" type="text" data-field="${escapeHtml(field)}" value="${escapeHtml(value)}" />` +
    "</div>"
  );
}

/** Build a clean data object from the draft for YAML serialization. */
function buildCleanItem(draft: Item): Record<string, unknown> {
  const clean: Record<string, unknown> = { name: draft.name };
  if (draft.type) clean.type = draft.type;
  if (draft.rarity) clean.rarity = draft.rarity;
  if (draft.attunement !== undefined && draft.attunement !== false) clean.attunement = draft.attunement;
  if (draft.weight != null) clean.weight = draft.weight;
  if (draft.value != null) clean.value = draft.value;
  if (draft.damage) clean.damage = draft.damage;
  if (draft.damage_type) clean.damage_type = draft.damage_type;
  if (draft.properties && draft.properties.length > 0) clean.properties = draft.properties;
  if (draft.charges != null) clean.charges = draft.charges;
  if (draft.recharge) clean.recharge = draft.recharge;
  if (draft.curse) clean.curse = true;
  if (draft.entries && draft.entries.length > 0) clean.entries = draft.entries;
  return clean;
}

// ---------------------------------------------------------------------------
// Main export: render HTML string
// ---------------------------------------------------------------------------

export function renderItemEditMode(
  item: Item,
  compendiumContext: CompendiumContext | null,
): string {
  const parts: string[] = [];

  // Open wrapper + block with editing class
  parts.push('<div class="archivist-item-block-wrapper">');
  parts.push('<div class="archivist-item-block editing">');

  // =========================================================================
  // 1. HEADER
  // =========================================================================
  parts.push('<div class="archivist-item-block-header">');

  // Name input
  parts.push(
    `<input class="archivist-edit-input-name" type="text" data-field="name" value="${escapeHtml(item.name)}" placeholder="Item Name" />`
  );

  // Type + Rarity row
  parts.push('<div class="archivist-item-subtitle">');
  parts.push(
    `<select class="archivist-edit-select" data-field="type">${selectOptions(ITEM_TYPES, item.type ?? "", "-- Type --")}</select>`
  );
  parts.push(
    `<select class="archivist-edit-select" data-field="rarity">${selectOptions(ITEM_RARITIES, item.rarity ?? "", "-- Rarity --")}</select>`
  );
  parts.push("</div>"); // archivist-item-subtitle

  parts.push("</div>"); // archivist-item-block-header

  // =========================================================================
  // 2. SVG Bar
  // =========================================================================
  parts.push(createSvgBar());

  // =========================================================================
  // 3. Attunement
  // =========================================================================
  parts.push('<div class="archivist-item-properties">');

  // Attunement row: checkbox + conditional condition text input
  const attuneChecked = !!item.attunement;
  const attuneCondValue = typeof item.attunement === "string" ? item.attunement : "";
  const condDisplay = attuneChecked ? "" : ' style="display:none"';

  parts.push('<div class="archivist-property-line">');
  parts.push(`<div class="archivist-property-icon">${lucideIcon("sparkles")}</div>`);
  parts.push('<div class="archivist-property-name">Attunement:</div>');
  parts.push(
    `<input type="checkbox" class="archivist-edit-checkbox" data-field="attunement"${attuneChecked ? " checked" : ""} />`
  );
  parts.push(
    `<input class="archivist-edit-input wide" type="text" data-field="attunement_condition" value="${escapeHtml(attuneCondValue)}" placeholder="Condition (e.g. by a cleric)"${condDisplay} />`
  );
  parts.push("</div>"); // property-line

  // =========================================================================
  // 4. Properties
  // =========================================================================
  parts.push(editableProperty("scale", "Weight:", "weight", item.weight != null ? String(item.weight) : ""));
  parts.push(editableProperty("coins", "Value:", "value", item.value != null ? String(item.value) : ""));
  parts.push(editableProperty("swords", "Damage:", "damage", item.damage ?? ""));
  parts.push(editableProperty("swords", "Damage Type:", "damage_type", item.damage_type ?? ""));
  parts.push(editableProperty("shield", "Properties:", "properties", (item.properties ?? []).join(", ")));
  parts.push(editableProperty("zap", "Charges:", "charges", item.charges != null ? String(item.charges) : ""));
  parts.push(editableProperty("refresh-cw", "Recharge:", "recharge", item.recharge ?? ""));

  // Cursed checkbox
  parts.push('<div class="archivist-property-line">');
  parts.push(`<div class="archivist-property-icon">${lucideIcon("skull")}</div>`);
  parts.push('<div class="archivist-property-name">Cursed:</div>');
  parts.push(
    `<input type="checkbox" class="archivist-edit-checkbox" data-field="curse"${item.curse ? " checked" : ""} />`
  );
  parts.push("</div>"); // property-line

  parts.push("</div>"); // archivist-item-properties

  // =========================================================================
  // 5. SVG Bar
  // =========================================================================
  parts.push(createSvgBar());

  // =========================================================================
  // 6. Entries (description)
  // =========================================================================
  parts.push('<div class="archivist-item-description">');
  parts.push('<div class="higher-levels-header">Description</div>');

  const descEntries = item.entries && item.entries.length > 0
    ? item.entries
    : [""];

  for (let i = 0; i < descEntries.length; i++) {
    parts.push(
      `<textarea class="archivist-feat-text-input" data-field="entries" data-index="${i}" rows="3">${escapeHtml(descEntries[i])}</textarea>`
    );
  }

  // Add entry button
  parts.push(
    `<div class="archivist-side-btn archivist-edit-add-btn" data-add="entries" aria-label="Add entry">${lucideIcon("plus")}</div>`
  );

  parts.push("</div>"); // archivist-item-description

  // Close block + wrapper
  parts.push("</div>"); // archivist-item-block editing
  parts.push("</div>"); // archivist-item-block-wrapper

  return parts.join("");
}

// ---------------------------------------------------------------------------
// Wire events
// ---------------------------------------------------------------------------

export function wireItemEditEvents(
  container: HTMLElement,
  item: Item,
  compendiumContext: CompendiumContext | null,
  callbacks: EditCallbacks,
): void {
  // Mutable working copy
  const draft: Item = JSON.parse(JSON.stringify(item));

  // -- Wire name input --
  const nameInput = container.querySelector<HTMLInputElement>('[data-field="name"]');
  if (nameInput) {
    nameInput.addEventListener("input", () => { draft.name = nameInput.value; });
  }

  // -- Wire type select --
  const typeSelect = container.querySelector<HTMLSelectElement>('[data-field="type"]');
  if (typeSelect) {
    typeSelect.addEventListener("change", () => { draft.type = typeSelect.value || undefined; });
  }

  // -- Wire rarity select --
  const raritySelect = container.querySelector<HTMLSelectElement>('[data-field="rarity"]');
  if (raritySelect) {
    raritySelect.addEventListener("change", () => { draft.rarity = raritySelect.value || undefined; });
  }

  // -- Wire attunement checkbox + condition input --
  const attuneCheck = container.querySelector<HTMLInputElement>('[data-field="attunement"]');
  const attuneCondInput = container.querySelector<HTMLInputElement>('[data-field="attunement_condition"]');
  if (attuneCheck && attuneCondInput) {
    attuneCheck.addEventListener("change", () => {
      if (!attuneCheck.checked) {
        draft.attunement = undefined;
        attuneCondInput.value = "";
        attuneCondInput.style.display = "none";
      } else {
        draft.attunement = true;
        attuneCondInput.style.display = "";
      }
    });
    attuneCondInput.addEventListener("input", () => {
      const val = attuneCondInput.value.trim();
      draft.attunement = val ? val : true;
    });
  }

  // -- Wire numeric property inputs --
  wirePropertyInput(container, "weight", (val) => { draft.weight = val ? Number(val) : undefined; });
  wirePropertyInput(container, "value", (val) => { draft.value = val ? Number(val) : undefined; });
  wirePropertyInput(container, "charges", (val) => { draft.charges = val ? Number(val) : undefined; });

  // -- Wire string property inputs --
  wirePropertyInput(container, "damage", (val) => { draft.damage = val || undefined; });
  wirePropertyInput(container, "damage_type", (val) => { draft.damage_type = val || undefined; });
  wirePropertyInput(container, "recharge", (val) => { draft.recharge = val || undefined; });

  // -- Wire properties (comma-separated) --
  wirePropertyInput(container, "properties", (val) => {
    draft.properties = val ? val.split(",").map(s => s.trim()).filter(Boolean) : undefined;
  });

  // -- Wire curse checkbox --
  const curseCheck = container.querySelector<HTMLInputElement>('[data-field="curse"]');
  if (curseCheck) {
    curseCheck.addEventListener("change", () => { draft.curse = curseCheck.checked || undefined; });
  }

  // -- Wire entries textareas --
  const descEntries = draft.entries && draft.entries.length > 0
    ? [...draft.entries]
    : [""];
  wireTextareaArray(container, "entries", descEntries, (entries) => {
    draft.entries = entries.filter(e => e.trim().length > 0);
  });

  // -- Wire add entry button --
  const addDescBtn = container.querySelector<HTMLElement>('[data-add="entries"]');
  if (addDescBtn) {
    addDescBtn.addEventListener("click", () => {
      descEntries.push("");
      const section = container.querySelector<HTMLElement>(".archivist-item-description");
      if (!section) return;
      const ta = document.createElement("textarea");
      ta.className = "archivist-feat-text-input";
      ta.setAttribute("data-field", "entries");
      ta.setAttribute("data-index", String(descEntries.length - 1));
      ta.rows = 3;
      section.insertBefore(ta, addDescBtn);
      const idx = descEntries.length - 1;
      ta.addEventListener("input", () => {
        descEntries[idx] = ta.value;
        draft.entries = descEntries.filter(e => e.trim().length > 0);
      });
      ta.focus();
    });
  }

  // -- Wire save button (from side buttons) --
  const saveBtn = container.querySelector<HTMLElement>('[data-action="save"]');
  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      const clean = buildCleanItem(draft);
      const yamlStr = yaml.dump(clean, {
        lineWidth: -1,
        quotingType: "\"",
        forceQuotes: false,
        sortKeys: false,
        noRefs: true,
      });
      callbacks.onSave(yamlStr);
    });
  }

  // -- Wire save-as-new button --
  const saveAsNewBtn = container.querySelector<HTMLElement>('[data-action="save-as-new"]');
  if (saveAsNewBtn) {
    saveAsNewBtn.addEventListener("click", () => {
      const clean = buildCleanItem(draft);
      const yamlStr = yaml.dump(clean, {
        lineWidth: -1,
        quotingType: "\"",
        forceQuotes: false,
        sortKeys: false,
        noRefs: true,
      });
      callbacks.onSaveAsNew(yamlStr, draft.name);
    });
  }

  // -- Wire cancel button --
  const cancelBtn = container.querySelector<HTMLElement>('[data-action="cancel"]');
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => { callbacks.onCancel(); });
  }
}

// ---------------------------------------------------------------------------
// Internal wiring helpers
// ---------------------------------------------------------------------------

function wirePropertyInput(
  container: HTMLElement,
  field: string,
  onChange: (value: string) => void,
): void {
  const input = container.querySelector<HTMLInputElement>(`[data-field="${field}"]`);
  if (input) {
    input.addEventListener("input", () => onChange(input.value));
  }
}

function wireTextareaArray(
  container: HTMLElement,
  field: string,
  entries: string[],
  onUpdate: (entries: string[]) => void,
): void {
  const textareas = container.querySelectorAll<HTMLTextAreaElement>(`textarea[data-field="${field}"]`);
  textareas.forEach((ta, i) => {
    ta.addEventListener("input", () => {
      entries[i] = ta.value;
      onUpdate(entries);
    });
  });
}
