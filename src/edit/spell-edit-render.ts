// src/edit/spell-edit-render.ts
// Spell edit form renderer — converts Obsidian DOM manipulation to HTML string output.

import * as yaml from "js-yaml";
import { escapeHtml, createSvgBar, lucideIcon } from "../renderers/renderer-utils";
import type { Spell } from "../types/spell";
import type { CompendiumContext } from "./block-utils";
import type { EditCallbacks } from "../index";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SPELL_LEVELS = [
  "Cantrip", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th",
];

const SPELL_SCHOOLS = [
  "Abjuration", "Conjuration", "Divination", "Enchantment",
  "Evocation", "Illusion", "Necromancy", "Transmutation",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function selectOptions(values: string[], selectedValue: string, numericValues = false): string {
  return values.map((v, i) => {
    const optValue = numericValues ? String(i) : v;
    const selected = numericValues
      ? (i === Number(selectedValue))
      : (v.toLowerCase() === selectedValue.toLowerCase());
    return `<option value="${escapeHtml(optValue)}"${selected ? " selected" : ""}>${escapeHtml(v)}</option>`;
  }).join("");
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
function buildCleanSpell(draft: Spell): Record<string, unknown> {
  const clean: Record<string, unknown> = { name: draft.name };
  if (draft.level !== undefined && draft.level !== 0) clean.level = draft.level;
  if (draft.level === 0) clean.level = 0;
  if (draft.school) clean.school = draft.school;
  if (draft.casting_time) clean.casting_time = draft.casting_time;
  if (draft.range) clean.range = draft.range;
  if (draft.components) clean.components = draft.components;
  if (draft.duration) clean.duration = draft.duration;
  if (draft.concentration) clean.concentration = true;
  if (draft.ritual) clean.ritual = true;
  if (draft.description && draft.description.length > 0) clean.description = draft.description;
  if (draft.at_higher_levels && draft.at_higher_levels.length > 0) clean.at_higher_levels = draft.at_higher_levels;
  if (draft.classes && draft.classes.length > 0) clean.classes = draft.classes;
  return clean;
}

// ---------------------------------------------------------------------------
// Main export: render HTML string
// ---------------------------------------------------------------------------

export function renderSpellEditMode(
  spell: Spell,
  compendiumContext: CompendiumContext | null,
): string {
  const parts: string[] = [];

  // Open wrapper + block with editing class
  parts.push('<div class="archivist-spell-block-wrapper">');
  parts.push('<div class="archivist-spell-block editing">');

  // =========================================================================
  // 1. HEADER
  // =========================================================================
  parts.push('<div class="spell-block-header">');

  // Name input
  parts.push(
    `<input class="archivist-edit-input-name" type="text" data-field="name" value="${escapeHtml(spell.name)}" placeholder="Spell Name" />`
  );

  // Level + School row
  parts.push('<div class="spell-school">');
  parts.push(
    `<select class="archivist-edit-select" data-field="level">${selectOptions(SPELL_LEVELS, String(spell.level ?? 0), true)}</select>`
  );
  parts.push(
    `<select class="archivist-edit-select" data-field="school">${selectOptions(SPELL_SCHOOLS, spell.school ?? "")}</select>`
  );
  parts.push("</div>"); // spell-school

  parts.push("</div>"); // spell-block-header

  // =========================================================================
  // 2. SVG Bar
  // =========================================================================
  parts.push(createSvgBar());

  // =========================================================================
  // 3. Properties
  // =========================================================================
  parts.push('<div class="spell-properties">');
  parts.push(editableProperty("clock", "Casting Time:", "casting_time", spell.casting_time ?? ""));
  parts.push(editableProperty("target", "Range:", "range", spell.range ?? ""));
  parts.push(editableProperty("box", "Components:", "components", spell.components ?? ""));
  parts.push(editableProperty("sparkles", "Duration:", "duration", spell.duration ?? ""));
  parts.push("</div>"); // spell-properties

  // =========================================================================
  // 4. Tags (Concentration & Ritual)
  // =========================================================================
  parts.push('<div class="spell-tags">');

  // Concentration toggle
  parts.push(
    '<label class="archivist-edit-toggle-label">' +
    `<input type="checkbox" class="archivist-edit-checkbox" data-field="concentration"${spell.concentration ? " checked" : ""} />` +
    "<span>Concentration</span>" +
    "</label>"
  );

  // Ritual toggle
  parts.push(
    '<label class="archivist-edit-toggle-label">' +
    `<input type="checkbox" class="archivist-edit-checkbox" data-field="ritual"${spell.ritual ? " checked" : ""} />` +
    "<span>Ritual</span>" +
    "</label>"
  );

  parts.push("</div>"); // spell-tags

  // =========================================================================
  // 5. SVG Bar
  // =========================================================================
  parts.push(createSvgBar());

  // =========================================================================
  // 6. Description
  // =========================================================================
  parts.push('<div class="spell-description">');
  parts.push('<div class="higher-levels-header">Description</div>');

  const descEntries = spell.description && spell.description.length > 0
    ? spell.description
    : [""];

  for (let i = 0; i < descEntries.length; i++) {
    parts.push(
      `<textarea class="archivist-feat-text-input" data-field="description" data-index="${i}" rows="3">${escapeHtml(descEntries[i])}</textarea>`
    );
  }

  // Add description paragraph button
  parts.push(
    `<div class="archivist-side-btn archivist-edit-add-btn" data-add="description" aria-label="Add paragraph">${lucideIcon("plus")}</div>`
  );

  parts.push("</div>"); // spell-description

  // =========================================================================
  // 7. At Higher Levels
  // =========================================================================
  parts.push('<div class="spell-higher-levels">');
  parts.push('<div class="higher-levels-header">At Higher Levels</div>');

  const higherEntries = spell.at_higher_levels && spell.at_higher_levels.length > 0
    ? spell.at_higher_levels
    : [""];

  for (let i = 0; i < higherEntries.length; i++) {
    parts.push(
      `<textarea class="archivist-feat-text-input" data-field="at_higher_levels" data-index="${i}" rows="2">${escapeHtml(higherEntries[i])}</textarea>`
    );
  }

  parts.push("</div>"); // spell-higher-levels

  // =========================================================================
  // 8. Classes
  // =========================================================================
  parts.push('<div class="spell-classes archivist-property-line">');
  parts.push(`<div class="archivist-property-icon">${lucideIcon("book-open")}</div>`);
  parts.push(
    `<input class="archivist-edit-input wide" type="text" data-field="classes" value="${escapeHtml((spell.classes ?? []).join(", "))}" placeholder="Classes (comma-separated)" />`
  );
  parts.push("</div>"); // spell-classes

  // Close block + wrapper
  parts.push("</div>"); // archivist-spell-block editing
  parts.push("</div>"); // archivist-spell-block-wrapper

  return parts.join("");
}

// ---------------------------------------------------------------------------
// Wire events
// ---------------------------------------------------------------------------

export function wireSpellEditEvents(
  container: HTMLElement,
  spell: Spell,
  compendiumContext: CompendiumContext | null,
  callbacks: EditCallbacks,
): void {
  // Mutable working copy
  const draft: Spell = JSON.parse(JSON.stringify(spell));

  // -- Wire name input --
  const nameInput = container.querySelector<HTMLInputElement>('[data-field="name"]');
  if (nameInput) {
    nameInput.addEventListener("input", () => { draft.name = nameInput.value; });
  }

  // -- Wire level select --
  const levelSelect = container.querySelector<HTMLSelectElement>('[data-field="level"]');
  if (levelSelect) {
    levelSelect.addEventListener("change", () => { draft.level = Number(levelSelect.value); });
  }

  // -- Wire school select --
  const schoolSelect = container.querySelector<HTMLSelectElement>('[data-field="school"]');
  if (schoolSelect) {
    schoolSelect.addEventListener("change", () => { draft.school = schoolSelect.value; });
  }

  // -- Wire property inputs --
  wirePropertyInput(container, "casting_time", (val) => { draft.casting_time = val || undefined; });
  wirePropertyInput(container, "range", (val) => { draft.range = val || undefined; });
  wirePropertyInput(container, "components", (val) => { draft.components = val || undefined; });
  wirePropertyInput(container, "duration", (val) => { draft.duration = val || undefined; });

  // -- Wire concentration checkbox --
  const concCheck = container.querySelector<HTMLInputElement>('[data-field="concentration"]');
  if (concCheck) {
    concCheck.addEventListener("change", () => { draft.concentration = concCheck.checked || undefined; });
  }

  // -- Wire ritual checkbox --
  const ritCheck = container.querySelector<HTMLInputElement>('[data-field="ritual"]');
  if (ritCheck) {
    ritCheck.addEventListener("change", () => { draft.ritual = ritCheck.checked || undefined; });
  }

  // -- Wire description textareas --
  const descEntries = draft.description && draft.description.length > 0
    ? [...draft.description]
    : [""];
  wireTextareaArray(container, "description", descEntries, (entries) => {
    draft.description = entries.filter(e => e.trim().length > 0);
  });

  // -- Wire add description button --
  const addDescBtn = container.querySelector<HTMLElement>('[data-add="description"]');
  if (addDescBtn) {
    addDescBtn.addEventListener("click", () => {
      descEntries.push("");
      const section = container.querySelector<HTMLElement>(".spell-description");
      if (!section) return;
      const ta = document.createElement("textarea");
      ta.className = "archivist-feat-text-input";
      ta.setAttribute("data-field", "description");
      ta.setAttribute("data-index", String(descEntries.length - 1));
      ta.rows = 3;
      section.insertBefore(ta, addDescBtn);
      const idx = descEntries.length - 1;
      ta.addEventListener("input", () => {
        descEntries[idx] = ta.value;
        draft.description = descEntries.filter(e => e.trim().length > 0);
      });
      ta.focus();
    });
  }

  // -- Wire at_higher_levels textareas --
  const higherEntries = draft.at_higher_levels && draft.at_higher_levels.length > 0
    ? [...draft.at_higher_levels]
    : [""];
  wireTextareaArray(container, "at_higher_levels", higherEntries, (entries) => {
    draft.at_higher_levels = entries.filter(e => e.trim().length > 0);
  });

  // -- Wire classes input --
  const classesInput = container.querySelector<HTMLInputElement>('[data-field="classes"]');
  if (classesInput) {
    classesInput.addEventListener("input", () => {
      const val = classesInput.value.trim();
      draft.classes = val ? val.split(",").map(s => s.trim()).filter(Boolean) : undefined;
    });
  }

  // -- Wire save button (from side buttons) --
  const saveBtn = container.querySelector<HTMLElement>('[data-action="save"]');
  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      const clean = buildCleanSpell(draft);
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
      const clean = buildCleanSpell(draft);
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
