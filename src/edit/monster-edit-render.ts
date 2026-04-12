// src/edit/monster-edit-render.ts
// Monster edit form renderer — converts Obsidian DOM manipulation to HTML string output.

import { escapeHtml, createSvgBar, lucideIcon } from "../renderers/renderer-utils";
import type { Monster, MonsterAbilities, MonsterFeature } from "../types/monster";
import { monsterToEditable } from "../dnd/editable-monster";
import type { EditableMonster } from "../dnd/editable-monster";
import { MonsterEditState } from "./edit-state";
import { createSearchableTagSelect } from "./searchable-tag-select";
import { attachTagAutocomplete } from "./tag-autocomplete";
import type { CompendiumContext } from "./block-utils";
import type { EditCallbacks } from "../index";
import {
  ABILITY_KEYS, ABILITY_NAMES, ALL_SIZES, ALL_SKILLS, SKILL_ABILITY,
  STANDARD_SENSES, ALL_SECTIONS, ALIGNMENT_ETHICAL, ALIGNMENT_MORAL,
  ALL_CR_VALUES, DAMAGE_TYPES, DAMAGE_NONMAGICAL_VARIANTS, CONDITIONS,
} from "../dnd/constants";
import {
  abilityModifier, formatModifier,
  savingThrow, skillBonus, passivePerception,
} from "../dnd/math";

// ---------------------------------------------------------------------------
// Section label / key maps
// ---------------------------------------------------------------------------

type SectionKey = "traits" | "actions" | "reactions" | "legendary" | "bonus_actions" | "lair_actions" | "mythic_actions";

const SECTION_LABELS: Record<string, string> = {
  traits: "Traits", actions: "Actions", reactions: "Reactions",
  legendary: "Legendary Actions", bonus_actions: "Bonus Actions",
  lair_actions: "Lair Actions", mythic_actions: "Mythic Actions",
};

const SECTION_SINGULAR: Record<string, string> = {
  traits: "Trait", actions: "Action", reactions: "Reaction",
  legendary: "Legendary Action", bonus_actions: "Bonus Action",
  lair_actions: "Lair Action", mythic_actions: "Mythic Action",
};

const SECTION_KEY_MAP: Record<string, SectionKey> = {
  "Traits": "traits", "Actions": "actions", "Reactions": "reactions",
  "Legendary Actions": "legendary", "Bonus Actions": "bonus_actions",
  "Lair Actions": "lair_actions", "Mythic Actions": "mythic_actions",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAbilityScore(m: EditableMonster | Monster, key: string): number {
  if (!m.abilities) return 10;
  return m.abilities[key as keyof MonsterAbilities] ?? 10;
}

function getFeatures(m: EditableMonster, key: string): MonsterFeature[] | undefined {
  const featureMap: Record<string, MonsterFeature[] | undefined> = {
    traits: m.traits, actions: m.actions,
    reactions: m.reactions, legendary: m.legendary,
  };
  const result = featureMap[key] ?? (m as Record<string, unknown>)[key] as MonsterFeature[] | undefined;
  if (!result && m.activeSections?.includes(key)) return [];
  return result;
}

function formatXP(xp: number): string {
  return xp.toLocaleString();
}

function parseAlignment(alignment: string | undefined, axis: "ethical" | "moral"): string {
  if (!alignment) return axis === "ethical" ? "neutral" : "neutral";
  const lower = alignment.toLowerCase();
  if (axis === "ethical") {
    if (lower === "unaligned" || lower === "any") return lower;
    const parts = lower.split(" ");
    return parts[0] ?? "neutral";
  } else {
    const parts = lower.split(" ");
    if (parts.length >= 2) return parts[1];
    if (["good", "neutral", "evil"].includes(parts[0])) return parts[0];
    return "neutral";
  }
}

// ---------------------------------------------------------------------------
// HTML building helpers
// ---------------------------------------------------------------------------

function numSpinner(field: string, value: number, min?: number, max?: number): string {
  return (
    `<div class="archivist-num-wrap">` +
    `<input type="number" class="archivist-num-in" data-field="${escapeHtml(field)}" value="${value}"` +
    `${min != null ? ` min="${min}"` : ""}${max != null ? ` max="${max}"` : ""} />` +
    `<div class="archivist-num-spin">` +
    `<button class="archivist-spin-up" data-spin-for="${escapeHtml(field)}">\u25B2</button>` +
    `<button class="archivist-spin-down" data-spin-for="${escapeHtml(field)}">\u25BC</button>` +
    `</div></div>`
  );
}

function selectOptions(values: string[], selectedValue: string, lowercase = false): string {
  return values.map(v => {
    const val = lowercase ? v.toLowerCase() : v;
    const sel = val === selectedValue ? " selected" : "";
    return `<option value="${escapeHtml(val)}"${sel}>${escapeHtml(v)}</option>`;
  }).join("");
}

function collapsible(id: string, title: string, count: number | null, startOpen: boolean, contentHtml: string): string {
  const chevronCls = startOpen ? "archivist-coll-chevron open" : "archivist-coll-chevron";
  const bodyDisplay = startOpen ? "" : ' style="display:none"';
  const countStr = count !== null ? `<span class="archivist-collapse-count" data-collapse-count="${escapeHtml(id)}">(${count})</span>` : "";
  return (
    `<div class="property-block" data-collapsible="${escapeHtml(id)}">` +
    `<div class="archivist-coll-header" data-collapse-toggle="${escapeHtml(id)}">` +
    `<span class="${chevronCls}">${lucideIcon("chevron-down")}</span>` +
    `<h4>${escapeHtml(title)}</h4>${countStr}` +
    `</div>` +
    `<div class="archivist-collapse-body" data-collapse-body="${escapeHtml(id)}"${bodyDisplay}>` +
    contentHtml +
    `</div></div>`
  );
}

function featureCard(sectionKey: string, index: number, feature: MonsterFeature): string {
  const nameVal = escapeHtml(feature.name ?? "");
  const textVal = escapeHtml(feature.entries?.join("\n") ?? "");
  const rows = Math.max(2, (feature.entries?.join("\n") ?? "").split("\n").length);
  return (
    `<div class="archivist-feat-card" data-section="${escapeHtml(sectionKey)}" data-index="${index}">` +
    `<button class="archivist-feat-card-x" data-action="remove-feature" data-section="${escapeHtml(sectionKey)}" data-index="${index}" title="Remove">${lucideIcon("x")}</button>` +
    `<input class="archivist-feat-name-input" type="text" data-field="feature-name" data-section="${escapeHtml(sectionKey)}" data-index="${index}" value="${nameVal}" placeholder="Feature name" />` +
    `<textarea class="archivist-feat-text-input" data-field="feature-text" data-section="${escapeHtml(sectionKey)}" data-index="${index}" rows="${rows}" placeholder="Feature description...">${textVal}</textarea>` +
    `</div>`
  );
}

// ---------------------------------------------------------------------------
// renderMonsterEditMode — HTML string builder
// ---------------------------------------------------------------------------

export function renderMonsterEditMode(
  monster: Monster,
  compendiumContext: CompendiumContext | null,
): string {
  const m = monsterToEditable(monster);
  const parts: string[] = [];

  // Open wrapper + block with editing class
  parts.push('<div class="archivist-monster-block-wrapper">');
  parts.push('<div class="archivist-monster-block editing">');

  // =========================================================================
  // 1. HEADER
  // =========================================================================
  parts.push('<div class="stat-block-header">');

  // Name input
  parts.push(
    `<input class="archivist-edit-input-name" type="text" data-field="name" value="${escapeHtml(m.name)}" />`
  );

  // Type line: Size + Type + Alignment
  parts.push('<div class="monster-type">');

  // Size select
  parts.push(
    `<select class="archivist-edit-select" data-field="size">${selectOptions(ALL_SIZES, (m.size ?? "medium").toLowerCase(), true)}</select>`
  );

  // Type input
  const typeVal = m.type ? m.type.charAt(0).toUpperCase() + m.type.slice(1) : "";
  parts.push(
    `<input class="archivist-edit-input" type="text" data-field="type" value="${escapeHtml(typeVal)}" placeholder="Type" />`
  );

  // Alignment: ethical + moral
  const ethicalVal = parseAlignment(m.alignment, "ethical");
  const moralVal = parseAlignment(m.alignment, "moral");
  parts.push(
    `<select class="archivist-edit-select" data-field="alignment-ethical">${selectOptions(ALIGNMENT_ETHICAL, ethicalVal, true)}</select>`
  );
  parts.push(
    `<select class="archivist-edit-select" data-field="alignment-moral">${selectOptions(ALIGNMENT_MORAL, moralVal, true)}</select>`
  );

  parts.push('</div>'); // monster-type
  parts.push('</div>'); // stat-block-header

  // =========================================================================
  // 2. SVG Bar
  // =========================================================================
  parts.push(createSvgBar());

  // =========================================================================
  // 3. Core Properties (AC, HP, Speed)
  // =========================================================================
  parts.push('<div class="property-block">');

  // -- AC --
  parts.push('<div class="property-line">');
  parts.push('<h4>Armor Class</h4> ');
  parts.push(numSpinner("ac.ac", m.ac?.[0]?.ac ?? 10));
  const acSourceVal = m.ac?.[0]?.from?.join(", ") ?? "";
  parts.push(
    `<input class="archivist-edit-input wide" type="text" data-field="ac.source" value="${escapeHtml(acSourceVal)}" placeholder="(source)" />`
  );
  parts.push('</div>');

  // -- HP --
  parts.push('<div class="property-line">');
  parts.push('<h4>Hit Points</h4> ');
  parts.push(`<span class="archivist-auto-value" data-display="hp">${m.hp?.average ?? 0}</span>`);
  parts.push('<span class="archivist-auto-label">(auto)</span> ');
  const hpFormula = m.hp?.formula ?? "";
  parts.push(
    `<input class="archivist-edit-input formula" type="text" data-field="hp.formula" value="${escapeHtml(hpFormula)}" placeholder="e.g. 4d8" />`
  );
  parts.push('</div>');

  // -- Speed --
  parts.push('<div class="property-line">');
  parts.push('<h4>Speed</h4> ');
  parts.push(numSpinner("speed.walk", m.speed?.walk ?? 30));
  parts.push(' ft.');
  parts.push('</div>');

  // Extra speed modes
  const extraModeKeys: Array<"fly" | "swim" | "climb" | "burrow"> = ["fly", "swim", "climb", "burrow"];
  parts.push('<div class="archivist-speed-extra-section">');
  parts.push('<div class="archivist-speed-extra-rows">');
  for (const key of extraModeKeys) {
    const speedVal = m.speed?.[key] ?? 0;
    if (speedVal > 0) {
      parts.push(
        `<div class="archivist-speed-extra-row" data-speed-mode="${key}">` +
        `<span class="archivist-speed-extra-label">${key.charAt(0).toUpperCase() + key.slice(1)}</span>` +
        numSpinner(`speed.${key}`, speedVal) +
        `<span class="archivist-speed-extra-ft">ft.</span>` +
        `<button class="archivist-speed-extra-x" data-action="remove-speed" data-speed-key="${key}">${lucideIcon("x")}</button>` +
        `</div>`
      );
    }
  }
  parts.push('</div>'); // speed-extra-rows
  const allSpeedsAdded = extraModeKeys.every(k => (m.speed?.[k] ?? 0) > 0);
  parts.push(
    `<div class="archivist-speed-add-wrap"${allSpeedsAdded ? ' style="display:none"' : ""}>` +
    `<button class="archivist-add-btn" data-action="add-speed">+ Add Speed</button>` +
    `</div>`
  );
  parts.push('</div>'); // speed-extra-section

  parts.push('</div>'); // property-block (AC/HP/Speed)

  // =========================================================================
  // 4. SVG Bar
  // =========================================================================
  parts.push(createSvgBar());

  // =========================================================================
  // 5. Ability Scores
  // =========================================================================
  parts.push('<div class="abilities-block">');
  parts.push('<table class="abilities-table"><thead><tr>');
  for (const key of ABILITY_KEYS) {
    parts.push(`<th>${ABILITY_NAMES[key]}</th>`);
  }
  parts.push('</tr></thead><tbody><tr>');
  for (const key of ABILITY_KEYS) {
    const score = getAbilityScore(m, key);
    const mod = abilityModifier(score);
    parts.push(
      `<td>${numSpinner(`abilities.${key}`, score)}` +
      `<div class="archivist-ability-mod" data-display="mod.${key}">(${formatModifier(mod)})</div></td>`
    );
  }
  parts.push('</tr></tbody></table>');
  parts.push('</div>'); // abilities-block

  // =========================================================================
  // 6. SVG Bar
  // =========================================================================
  parts.push(createSvgBar());

  // =========================================================================
  // 7. Saving Throws (collapsible)
  // =========================================================================
  {
    let savesHtml = '<div class="archivist-saves-grid">';
    for (const key of ABILITY_KEYS) {
      const isProficient = m.saveProficiencies[key];
      const toggleCls = `archivist-prof-toggle${isProficient ? " proficient" : ""}`;
      const score = getAbilityScore(m, key);
      const saveVal = savingThrow(score, isProficient, m.proficiencyBonus);
      const valCls = `archivist-auto-value${isProficient ? " proficient-value" : ""}`;
      savesHtml +=
        `<div class="archivist-save-item">` +
        `<div class="${toggleCls}" data-toggle="save" data-ability="${key}"></div>` +
        `<span class="archivist-save-ability">${ABILITY_NAMES[key]}</span>` +
        `<span class="${valCls}" data-display="save.${key}">${formatModifier(saveVal)}</span>` +
        `<span class="archivist-auto-label"></span>` +
        `</div>`;
    }
    savesHtml += '</div>';
    parts.push(collapsible("saves", "Saving Throws", null, false, savesHtml));
  }

  // =========================================================================
  // 8. Skills (collapsible)
  // =========================================================================
  {
    let skillsHtml = '<div class="archivist-skills-grid">';
    for (const skill of ALL_SKILLS) {
      const skillLower = skill.toLowerCase();
      const abilityKey = SKILL_ABILITY[skillLower];
      const profLevel = m.skillProficiencies[skillLower] ?? "none";
      const toggleCls = `archivist-prof-toggle${profLevel !== "none" ? ` ${profLevel}` : ""}`;
      const score = getAbilityScore(m, abilityKey);
      const bonus = skillBonus(score, profLevel, m.proficiencyBonus);
      const valCls = `archivist-skill-value archivist-auto-value${profLevel !== "none" ? " proficient-value" : ""}`;
      skillsHtml +=
        `<div class="archivist-skill-item">` +
        `<div class="${toggleCls}" data-toggle="skill" data-skill="${escapeHtml(skillLower)}"></div>` +
        `<span class="archivist-skill-name">${escapeHtml(skill)}</span>` +
        `<span class="${valCls}" data-display="skill.${escapeHtml(skillLower)}">${formatModifier(bonus)}</span>` +
        `<span class="archivist-auto-label"></span>` +
        `</div>`;
    }
    skillsHtml += '</div>';
    parts.push(collapsible("skills", "Skills", null, false, skillsHtml));
  }

  // =========================================================================
  // 9. Damage & Condition Immunities (4 collapsible tag-select containers)
  // =========================================================================
  const damagePresets = [...DAMAGE_TYPES, ...DAMAGE_NONMAGICAL_VARIANTS];

  interface CollapseField {
    id: string;
    title: string;
    selected: string[];
    field: string;
  }

  const collapseFields: CollapseField[] = [
    { id: "damage_vulnerabilities", title: "Damage Vulnerabilities", selected: [...(m.damage_vulnerabilities ?? [])], field: "damage_vulnerabilities" },
    { id: "damage_resistances", title: "Damage Resistances", selected: [...(m.damage_resistances ?? [])], field: "damage_resistances" },
    { id: "damage_immunities", title: "Damage Immunities", selected: [...(m.damage_immunities ?? [])], field: "damage_immunities" },
    { id: "condition_immunities", title: "Condition Immunities", selected: [...(m.condition_immunities ?? [])], field: "condition_immunities" },
  ];

  for (const cf of collapseFields) {
    // The body is an empty container; createSearchableTagSelect will be called in wireMonsterEditEvents
    const bodyHtml = `<div class="archivist-tag-select-container" data-tag-field="${escapeHtml(cf.field)}"></div>`;
    parts.push(collapsible(cf.id, cf.title, cf.selected.length, false, bodyHtml));
  }

  // =========================================================================
  // 10. Senses (collapsible)
  // =========================================================================
  {
    let sensesHtml = '<div class="archivist-senses-grid">';
    for (const sense of STANDARD_SENSES) {
      const senseKey = sense.toLowerCase();
      const hasValue = !!m.activeSenses[senseKey];
      const toggleCls = `archivist-prof-toggle${hasValue ? " proficient" : ""}`;
      const rangeVal = m.activeSenses[senseKey] ?? "";
      sensesHtml +=
        `<div class="archivist-sense-item">` +
        `<div class="${toggleCls}" data-toggle="sense" data-sense="${escapeHtml(senseKey)}"></div>` +
        `<span class="archivist-sense-name">${escapeHtml(sense)}</span>` +
        `<input class="archivist-sense-range" type="text" data-field="sense.${escapeHtml(senseKey)}" value="${escapeHtml(rangeVal)}" placeholder="-- ft." />` +
        `</div>`;
    }

    // Custom senses
    for (let i = 0; i < m.customSenses.length; i++) {
      const raw = m.customSenses[i] ?? "";
      const rangeMatch = raw.match(/(\d+\s*ft\.?\s*)$/i);
      const parsedName = rangeMatch ? raw.slice(0, raw.length - rangeMatch[0].length).trim() : raw;
      const parsedRange = rangeMatch ? rangeMatch[1].trim() : "60 ft.";
      sensesHtml +=
        `<div class="archivist-sense-custom" data-custom-sense-index="${i}">` +
        `<div class="archivist-prof-toggle proficient"></div>` +
        `<input class="archivist-sense-custom-name" type="text" data-field="custom-sense-name" data-index="${i}" value="${escapeHtml(parsedName)}" placeholder="Sense name" />` +
        `<input class="archivist-sense-range" type="text" data-field="custom-sense-range" data-index="${i}" value="${escapeHtml(parsedRange)}" placeholder="-- ft." />` +
        `<button class="archivist-sense-custom-x" data-action="remove-custom-sense" data-index="${i}">${lucideIcon("x")}</button>` +
        `</div>`;
    }

    // Passive Perception
    const wisScore = getAbilityScore(m, "wis");
    const percProf = m.skillProficiencies["perception"] ?? "none";
    const ppVal = passivePerception(wisScore, percProf, m.proficiencyBonus);
    const ppCls = `archivist-auto-value${percProf !== "none" ? " proficient-value" : ""}`;
    sensesHtml +=
      `<div class="archivist-sense-pp">` +
      `<span class="archivist-sense-pp-label">Passive Perception</span>` +
      `<span class="${ppCls}" data-display="pp">${ppVal}</span>` +
      `</div>`;

    // Add custom sense button
    sensesHtml += `<button class="archivist-add-btn" data-action="add-custom-sense">+ Add Custom Sense</button>`;

    sensesHtml += '</div>'; // senses-grid
    parts.push(collapsible("senses", "Senses", null, false, sensesHtml));
  }

  // =========================================================================
  // 11. Languages
  // =========================================================================
  parts.push('<div class="property-block">');
  parts.push('<div class="property-line">');
  parts.push('<h4>Languages</h4> ');
  const langVal = m.languages?.join(", ") ?? "";
  parts.push(
    `<input class="archivist-edit-input lang" type="text" data-field="languages" value="${escapeHtml(langVal)}" placeholder="Common, Draconic, ..." />`
  );
  parts.push('</div>');

  // =========================================================================
  // 12. Challenge Rating
  // =========================================================================
  parts.push('<div class="property-line">');
  parts.push('<h4>Challenge</h4> ');
  parts.push(
    `<select class="archivist-edit-select" data-field="cr">${selectOptions(ALL_CR_VALUES, m.cr ?? "0")}</select>`
  );
  parts.push(` (<span class="archivist-auto-value" data-display="xp">${formatXP(m.xp)}</span> XP)`);
  parts.push('<span class="archivist-auto-label">(auto)</span>');
  parts.push('</div>');
  parts.push('</div>'); // property-block (languages + CR)

  // =========================================================================
  // 13. SVG Bar
  // =========================================================================
  parts.push(createSvgBar());

  // =========================================================================
  // 14. Section Tabs + Feature Cards
  // =========================================================================
  parts.push('<div class="archivist-section-tabs">');

  // Tab bar
  parts.push('<div class="archivist-tab-wrap">');
  parts.push(`<button class="archivist-tab-scroll archivist-tab-scroll-left">${lucideIcon("chevron-down")}</button>`);
  parts.push('<div class="archivist-tabs">');

  const activeSections = m.activeSections;
  const activeTabKey = activeSections.length > 0 ? activeSections[0] : null;

  for (const sectionKey of activeSections) {
    const label = SECTION_LABELS[sectionKey] ?? sectionKey;
    const activeCls = sectionKey === activeTabKey ? " active" : "";
    parts.push(
      `<button class="archivist-tab${activeCls}" data-tab="${escapeHtml(sectionKey)}">` +
      `<span class="archivist-tab-inner">` +
      `<span>${escapeHtml(label)}</span>` +
      `<span class="archivist-tab-close" data-action="remove-section" data-section="${escapeHtml(sectionKey)}">${lucideIcon("x")}</span>` +
      `</span></button>`
    );
  }

  parts.push('</div>'); // archivist-tabs
  parts.push(`<button class="archivist-tab-scroll archivist-tab-scroll-right">${lucideIcon("chevron-down")}</button>`);
  parts.push('<button class="archivist-tab add-tab" data-action="add-section">+</button>');
  parts.push('</div>'); // tab-wrap

  // Tab content — render a panel per section; only the active one is visible
  parts.push('<div class="archivist-tab-content">');
  if (!activeTabKey) {
    parts.push('<div class="archivist-auto-label">Click + to add a section</div>');
  } else {
    for (const sectionKey of activeSections) {
      const isActive = sectionKey === activeTabKey;
      parts.push(`<div class="archivist-tab-panel" data-panel="${escapeHtml(sectionKey)}"${isActive ? "" : ' style="display:none"'}>`);

      // Legendary checkboxes
      if (sectionKey === "legendary") {
        parts.push(renderLegendaryCheckboxesHtml(m));
      }

      const features = getFeatures(m, sectionKey);
      if (features) {
        for (let i = 0; i < features.length; i++) {
          parts.push(featureCard(sectionKey, i, features[i]));
        }
      }

      const singular = SECTION_SINGULAR[sectionKey] ?? "Feature";
      parts.push(
        `<button class="archivist-add-btn" data-action="add-feature" data-section="${escapeHtml(sectionKey)}">+ Add ${escapeHtml(singular)}</button>`
      );
      parts.push('</div>'); // tab-panel
    }
  }
  parts.push('</div>'); // tab-content

  parts.push('</div>'); // archivist-section-tabs

  // Close wrapper + block
  parts.push('</div>'); // archivist-monster-block editing
  parts.push('</div>'); // archivist-monster-block-wrapper

  return parts.join("");
}

function renderLegendaryCheckboxesHtml(m: EditableMonster): string {
  return (
    `<div class="archivist-legendary-counts">` +
    `<div class="archivist-legendary-count-field">` +
    `<span class="archivist-legendary-count-label">Actions:</span>` +
    numSpinner("legendary_actions", m.legendary_actions ?? 3) +
    `</div>` +
    `<div class="archivist-legendary-count-field">` +
    `<span class="archivist-legendary-count-label">Resistance:</span>` +
    numSpinner("legendary_resistance", m.legendary_resistance ?? 0) +
    `</div></div>` +
    createSvgBar()
  );
}

// ---------------------------------------------------------------------------
// wireMonsterEditEvents — attach event handlers to rendered HTML
// ---------------------------------------------------------------------------

export function wireMonsterEditEvents(
  container: HTMLElement,
  monster: Monster,
  compendiumContext: CompendiumContext | null,
  callbacks: EditCallbacks,
): void {
  let activeTabKey: string | null = null;

  const state = new MonsterEditState(monster, () => {
    updateDom(container, state);
  });

  // Determine initial active tab
  if (state.current.activeSections.length > 0) {
    activeTabKey = state.current.activeSections[0];
  }

  // -- Wire spinners --
  wireSpinners(container, state);

  // -- Wire name input --
  wireInput(container, '[data-field="name"]', (val) => state.updateField("name", val));

  // -- Wire type input --
  wireInput(container, '[data-field="type"]', (val) => state.updateField("type", val));

  // -- Wire size select --
  wireSelect(container, '[data-field="size"]', (val) => state.updateField("size", val));

  // -- Wire alignment selects --
  const ethSelect = container.querySelector<HTMLSelectElement>('[data-field="alignment-ethical"]');
  const morSelect = container.querySelector<HTMLSelectElement>('[data-field="alignment-moral"]');
  function updateAlignment(): void {
    const eth = ethSelect?.value ?? "neutral";
    const mor = morSelect?.value ?? "neutral";
    if (eth === "unaligned" || eth === "any") {
      state.updateField("alignment", eth);
    } else {
      const combo = eth === mor ? eth : `${eth} ${mor}`;
      state.updateField("alignment", combo);
    }
  }
  ethSelect?.addEventListener("change", updateAlignment);
  morSelect?.addEventListener("change", updateAlignment);

  // -- Wire AC spinner + source --
  const acInput = container.querySelector<HTMLInputElement>('[data-field="ac.ac"]');
  if (acInput) {
    acInput.addEventListener("input", () => {
      const acArr = state.current.ac ? [...state.current.ac] : [{ ac: 10 }];
      acArr[0] = { ...acArr[0], ac: parseInt(acInput.value) || 10 };
      state.updateField("ac", acArr);
    });
  }
  const acSourceInput = container.querySelector<HTMLInputElement>('[data-field="ac.source"]');
  if (acSourceInput) {
    acSourceInput.addEventListener("input", () => {
      const acArr = state.current.ac ? [...state.current.ac] : [{ ac: 10 }];
      const fromArr = acSourceInput.value.trim() ? acSourceInput.value.split(",").map(s => s.trim()) : undefined;
      acArr[0] = { ...acArr[0], from: fromArr };
      state.updateField("ac", acArr);
    });
  }

  // -- Wire HP formula --
  const hpFormulaInput = container.querySelector<HTMLInputElement>('[data-field="hp.formula"]');
  if (hpFormulaInput) {
    hpFormulaInput.addEventListener("input", () => {
      const hp = { ...(state.current.hp ?? { average: 0 }), formula: hpFormulaInput.value };
      state.updateField("hp.formula", hpFormulaInput.value);
      state.updateField("hp", hp);
    });
  }

  // -- Wire Speed walk --
  const walkInput = container.querySelector<HTMLInputElement>('[data-field="speed.walk"]');
  if (walkInput) {
    walkInput.addEventListener("input", () => {
      const speed = { ...state.current.speed, walk: parseInt(walkInput.value) || 0 };
      state.updateField("speed", speed);
    });
  }

  // -- Wire extra speed modes --
  wireExtraSpeedRows(container, state);
  wireAddSpeedButton(container, state);

  // -- Wire ability score inputs --
  for (const key of ABILITY_KEYS) {
    const input = container.querySelector<HTMLInputElement>(`[data-field="abilities.${key}"]`);
    if (input) {
      input.addEventListener("input", () => {
        const abilities = { ...(state.current.abilities ?? { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }) };
        abilities[key as keyof MonsterAbilities] = parseInt(input.value) || 10;
        state.updateField("abilities", abilities);
      });
    }
  }

  // -- Wire collapsible toggles --
  wireCollapsibles(container);

  // -- Wire save toggles --
  wireSaveToggles(container, state);

  // -- Wire skill toggles --
  wireSkillToggles(container, state);

  // -- Wire damage/condition tag selects --
  wireDamageConditionSelects(container, state);

  // -- Wire sense toggles + inputs --
  wireSenses(container, state);

  // -- Wire languages --
  wireInput(container, '[data-field="languages"]', (val) => {
    const langs = val.split(",").map(s => s.trim()).filter(Boolean);
    state.updateField("languages", langs);
  });

  // -- Wire CR select --
  wireSelect(container, '[data-field="cr"]', (val) => state.updateField("cr", val));

  // -- Wire tab bar --
  wireTabBar(container, state, activeTabKey, (newKey) => {
    activeTabKey = newKey;
    rebuildTabContent(container, state, activeTabKey);
  });

  // -- Wire add-section button --
  wireAddSectionButton(container, state, () => {
    if (!activeTabKey && state.current.activeSections.length > 0) {
      activeTabKey = state.current.activeSections[state.current.activeSections.length - 1];
    }
    rebuildTabs(container, state, activeTabKey, (newKey) => {
      activeTabKey = newKey;
      rebuildTabContent(container, state, activeTabKey);
    });
    rebuildTabContent(container, state, activeTabKey);
  });

  // -- Wire feature cards (initial) --
  wireFeatureCards(container, state, activeTabKey, (newKey) => {
    activeTabKey = newKey;
    rebuildTabContent(container, state, activeTabKey);
  });

  // -- Attach tag autocomplete to feature textareas --
  container.querySelectorAll("textarea.archivist-feat-text-input").forEach((ta) => {
    if (ta instanceof HTMLTextAreaElement) {
      attachTagAutocomplete(ta, state);
    }
  });

  // Legendary spinners if applicable
  wireLegendarySpinners(container, state);
}

// ---------------------------------------------------------------------------
// Wire helpers
// ---------------------------------------------------------------------------

function wireInput(
  container: HTMLElement,
  selector: string,
  onUpdate: (value: string) => void,
): void {
  const el = container.querySelector<HTMLInputElement>(selector);
  if (el) el.addEventListener("input", () => onUpdate(el.value));
}

function wireSelect(
  container: HTMLElement,
  selector: string,
  onUpdate: (value: string) => void,
): void {
  const el = container.querySelector<HTMLSelectElement>(selector);
  if (el) el.addEventListener("change", () => onUpdate(el.value));
}

function wireSpinners(container: HTMLElement, state: MonsterEditState): void {
  const spinUps = container.querySelectorAll<HTMLButtonElement>(".archivist-spin-up");
  const spinDowns = container.querySelectorAll<HTMLButtonElement>(".archivist-spin-down");

  for (const btn of spinUps) {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const field = btn.dataset.spinFor;
      if (!field) return;
      const input = container.querySelector<HTMLInputElement>(`[data-field="${field}"]`);
      if (input) {
        input.value = String((parseInt(input.value) || 0) + 1);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
  }

  for (const btn of spinDowns) {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const field = btn.dataset.spinFor;
      if (!field) return;
      const input = container.querySelector<HTMLInputElement>(`[data-field="${field}"]`);
      if (input) {
        input.value = String((parseInt(input.value) || 0) - 1);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
  }
}

function wireCollapsibles(container: HTMLElement): void {
  const headers = container.querySelectorAll<HTMLElement>("[data-collapse-toggle]");
  for (const header of headers) {
    header.addEventListener("click", () => {
      const id = header.dataset.collapseToggle;
      if (!id) return;
      const body = container.querySelector<HTMLElement>(`[data-collapse-body="${id}"]`);
      const chevron = header.querySelector<HTMLElement>(".archivist-coll-chevron");
      if (body) {
        const isHidden = body.style.display === "none";
        body.style.display = isHidden ? "" : "none";
        chevron?.classList.toggle("open", isHidden);
      }
    });
  }
}

function wireSaveToggles(container: HTMLElement, state: MonsterEditState): void {
  const toggles = container.querySelectorAll<HTMLElement>('[data-toggle="save"]');
  for (const toggle of toggles) {
    toggle.addEventListener("click", () => {
      const ability = toggle.dataset.ability;
      if (!ability) return;
      state.toggleSaveProficiency(ability);
      // Update toggle visual
      toggle.classList.toggle("proficient", state.current.saveProficiencies[ability]);
      // Update value display
      const valEl = container.querySelector<HTMLElement>(`[data-display="save.${ability}"]`);
      if (valEl) {
        const score = getAbilityScore(state.current, ability);
        const sv = savingThrow(score, state.current.saveProficiencies[ability], state.current.proficiencyBonus);
        valEl.textContent = formatModifier(sv);
        valEl.classList.toggle("proficient-value", state.current.saveProficiencies[ability]);
      }
    });
  }
}

function wireSkillToggles(container: HTMLElement, state: MonsterEditState): void {
  const toggles = container.querySelectorAll<HTMLElement>('[data-toggle="skill"]');
  for (const toggle of toggles) {
    toggle.addEventListener("click", () => {
      const skillLower = toggle.dataset.skill;
      if (!skillLower) return;
      state.cycleSkillProficiency(skillLower);
      const profLevel = state.current.skillProficiencies[skillLower] ?? "none";
      // Update toggle visual
      toggle.classList.remove("proficient", "expertise");
      if (profLevel !== "none") toggle.classList.add(profLevel);
      // Update value display
      const valEl = container.querySelector<HTMLElement>(`[data-display="skill.${skillLower}"]`);
      if (valEl) {
        const abilityKey = SKILL_ABILITY[skillLower];
        const score = getAbilityScore(state.current, abilityKey);
        const bonus = skillBonus(score, profLevel, state.current.proficiencyBonus);
        valEl.textContent = formatModifier(bonus);
        valEl.classList.toggle("proficient-value", profLevel !== "none");
      }
    });
  }
}

function wireDamageConditionSelects(container: HTMLElement, state: MonsterEditState): void {
  const damagePresets = [...DAMAGE_TYPES, ...DAMAGE_NONMAGICAL_VARIANTS];

  const fieldConfigs: Array<{ field: string; presets: string[]; placeholder: string }> = [
    { field: "damage_vulnerabilities", presets: damagePresets, placeholder: "Search damage types..." },
    { field: "damage_resistances", presets: damagePresets, placeholder: "Search damage types..." },
    { field: "damage_immunities", presets: damagePresets, placeholder: "Search damage types..." },
    { field: "condition_immunities", presets: CONDITIONS, placeholder: "Search conditions..." },
  ];

  for (const config of fieldConfigs) {
    const tagContainer = container.querySelector<HTMLElement>(`[data-tag-field="${config.field}"]`);
    if (!tagContainer) continue;

    const selected = [...((state.current as Record<string, unknown>)[config.field] as string[] ?? [])];
    const countEl = container.querySelector<HTMLElement>(`[data-collapse-count="${config.field}"]`);

    createSearchableTagSelect({
      container: tagContainer,
      presets: config.presets,
      selected,
      onChange: (values) => {
        state.updateField(config.field, values);
        if (countEl) countEl.textContent = `(${values.length})`;
      },
      placeholder: config.placeholder,
    });
  }
}

function wireSenses(container: HTMLElement, state: MonsterEditState): void {
  // Standard sense toggles
  const senseToggles = container.querySelectorAll<HTMLElement>('[data-toggle="sense"]');
  for (const toggle of senseToggles) {
    toggle.addEventListener("click", () => {
      const senseKey = toggle.dataset.sense;
      if (!senseKey) return;
      const rangeInput = container.querySelector<HTMLInputElement>(`[data-field="sense.${senseKey}"]`);
      if (state.current.activeSenses[senseKey]) {
        state.current.activeSenses[senseKey] = null;
        if (rangeInput) rangeInput.value = "";
        toggle.classList.remove("proficient");
      } else {
        state.current.activeSenses[senseKey] = "60 ft.";
        if (rangeInput) rangeInput.value = "60 ft.";
        toggle.classList.add("proficient");
      }
      state.updateField("activeSenses", state.current.activeSenses);
    });
  }

  // Standard sense range inputs
  const senseInputs = container.querySelectorAll<HTMLInputElement>('[data-field^="sense."]');
  for (const input of senseInputs) {
    const field = input.dataset.field;
    if (!field || !field.startsWith("sense.")) continue;
    const senseKey = field.slice(6);
    input.addEventListener("input", () => {
      state.current.activeSenses[senseKey] = input.value || null;
      const toggle = container.querySelector<HTMLElement>(`[data-toggle="sense"][data-sense="${senseKey}"]`);
      if (toggle) toggle.classList.toggle("proficient", !!input.value);
      state.updateField("activeSenses", state.current.activeSenses);
    });
  }

  // Custom sense inputs
  wireCustomSenseInputs(container, state);

  // Remove custom sense buttons
  const removeBtns = container.querySelectorAll<HTMLElement>('[data-action="remove-custom-sense"]');
  for (const btn of removeBtns) {
    btn.addEventListener("click", () => {
      const index = parseInt(btn.dataset.index ?? "");
      if (isNaN(index)) return;
      state.current.customSenses.splice(index, 1);
      const row = btn.closest(".archivist-sense-custom");
      if (row) row.remove();
      state.updateField("customSenses", state.current.customSenses);
    });
  }

  // Add custom sense button
  const addSenseBtn = container.querySelector<HTMLElement>('[data-action="add-custom-sense"]');
  if (addSenseBtn) {
    addSenseBtn.addEventListener("click", () => {
      state.current.customSenses.push("New Sense 60 ft.");
      const idx = state.current.customSenses.length - 1;
      const rowHtml =
        `<div class="archivist-sense-custom" data-custom-sense-index="${idx}">` +
        `<div class="archivist-prof-toggle proficient"></div>` +
        `<input class="archivist-sense-custom-name" type="text" data-field="custom-sense-name" data-index="${idx}" value="New Sense" placeholder="Sense name" />` +
        `<input class="archivist-sense-range" type="text" data-field="custom-sense-range" data-index="${idx}" value="60 ft." placeholder="-- ft." />` +
        `<button class="archivist-sense-custom-x" data-action="remove-custom-sense" data-index="${idx}">${lucideIcon("x")}</button>` +
        `</div>`;
      addSenseBtn.insertAdjacentHTML("beforebegin", rowHtml);
      // Wire the new row
      const newRow = addSenseBtn.previousElementSibling as HTMLElement;
      if (newRow) {
        wireCustomSenseRow(newRow, state, idx);
      }
      state.updateField("customSenses", state.current.customSenses);
    });
  }
}

function wireCustomSenseInputs(container: HTMLElement, state: MonsterEditState): void {
  const nameInputs = container.querySelectorAll<HTMLInputElement>('[data-field="custom-sense-name"]');
  const rangeInputs = container.querySelectorAll<HTMLInputElement>('[data-field="custom-sense-range"]');

  for (const input of nameInputs) {
    const idx = parseInt(input.dataset.index ?? "");
    if (isNaN(idx)) continue;
    input.addEventListener("input", () => {
      const rangeInput = container.querySelector<HTMLInputElement>(`[data-field="custom-sense-range"][data-index="${idx}"]`);
      state.current.customSenses[idx] = `${input.value} ${rangeInput?.value ?? ""}`.trim();
      state.updateField("customSenses", state.current.customSenses);
    });
  }

  for (const input of rangeInputs) {
    const idx = parseInt(input.dataset.index ?? "");
    if (isNaN(idx)) continue;
    input.addEventListener("input", () => {
      const nameInput = container.querySelector<HTMLInputElement>(`[data-field="custom-sense-name"][data-index="${idx}"]`);
      state.current.customSenses[idx] = `${nameInput?.value ?? ""} ${input.value}`.trim();
      state.updateField("customSenses", state.current.customSenses);
    });
  }
}

function wireCustomSenseRow(row: HTMLElement, state: MonsterEditState, idx: number): void {
  const nameInput = row.querySelector<HTMLInputElement>('[data-field="custom-sense-name"]');
  const rangeInput = row.querySelector<HTMLInputElement>('[data-field="custom-sense-range"]');
  const removeBtn = row.querySelector<HTMLElement>('[data-action="remove-custom-sense"]');

  if (nameInput) {
    nameInput.addEventListener("input", () => {
      state.current.customSenses[idx] = `${nameInput.value} ${rangeInput?.value ?? ""}`.trim();
      state.updateField("customSenses", state.current.customSenses);
    });
  }
  if (rangeInput) {
    rangeInput.addEventListener("input", () => {
      state.current.customSenses[idx] = `${nameInput?.value ?? ""} ${rangeInput.value}`.trim();
      state.updateField("customSenses", state.current.customSenses);
    });
  }
  if (removeBtn) {
    removeBtn.addEventListener("click", () => {
      state.current.customSenses.splice(idx, 1);
      row.remove();
      state.updateField("customSenses", state.current.customSenses);
    });
  }
}

function wireExtraSpeedRows(container: HTMLElement, state: MonsterEditState): void {
  const rows = container.querySelectorAll<HTMLElement>(".archivist-speed-extra-row");
  for (const row of rows) {
    const key = row.dataset.speedMode as "fly" | "swim" | "climb" | "burrow" | undefined;
    if (!key) continue;

    const input = row.querySelector<HTMLInputElement>(`[data-field="speed.${key}"]`);
    if (input) {
      input.addEventListener("input", () => {
        const speed = { ...state.current.speed, [key]: parseInt(input.value) || 0 };
        state.updateField("speed", speed);
      });
    }

    const removeBtn = row.querySelector<HTMLElement>('[data-action="remove-speed"]');
    if (removeBtn) {
      removeBtn.addEventListener("click", () => {
        row.remove();
        state.updateField("speed", { ...state.current.speed, [key]: 0 });
        updateAddSpeedVisibility(container, state);
      });
    }
  }
}

function wireAddSpeedButton(container: HTMLElement, state: MonsterEditState): void {
  const addBtn = container.querySelector<HTMLElement>('[data-action="add-speed"]');
  if (!addBtn) return;

  let dropdownEl: HTMLElement | null = null;

  addBtn.addEventListener("click", () => {
    if (dropdownEl) {
      dropdownEl.remove();
      dropdownEl = null;
      return;
    }

    const extraModeKeys: Array<"fly" | "swim" | "climb" | "burrow"> = ["fly", "swim", "climb", "burrow"];
    const wrap = addBtn.closest(".archivist-speed-add-wrap");
    if (!wrap) return;

    dropdownEl = document.createElement("div");
    dropdownEl.className = "archivist-speed-dropdown";
    wrap.appendChild(dropdownEl);

    for (const key of extraModeKeys) {
      const isActive = (state.current.speed?.[key] ?? 0) > 0;
      const item = document.createElement("div");
      item.className = isActive
        ? "archivist-speed-dropdown-item archivist-speed-dropdown-item-taken"
        : "archivist-speed-dropdown-item";
      item.textContent = isActive
        ? `${key.charAt(0).toUpperCase() + key.slice(1)} (added)`
        : key.charAt(0).toUpperCase() + key.slice(1);

      if (!isActive) {
        item.addEventListener("click", () => {
          addSpeedModeRow(container, state, key);
          if (dropdownEl) { dropdownEl.remove(); dropdownEl = null; }
        });
      }
      dropdownEl.appendChild(item);
    }

    // Close on outside click
    const closeHandler = (e: MouseEvent) => {
      if (dropdownEl && !wrap.contains(e.target as Node)) {
        dropdownEl.remove();
        dropdownEl = null;
        document.removeEventListener("click", closeHandler);
      }
    };
    setTimeout(() => document.addEventListener("click", closeHandler), 0);
  });
}

function addSpeedModeRow(container: HTMLElement, state: MonsterEditState, key: "fly" | "swim" | "climb" | "burrow"): void {
  const rowsContainer = container.querySelector<HTMLElement>(".archivist-speed-extra-rows");
  if (!rowsContainer) return;

  const speed = { ...state.current.speed, [key]: 30 };
  state.updateField("speed", speed);

  const rowHtml =
    `<div class="archivist-speed-extra-row" data-speed-mode="${key}">` +
    `<span class="archivist-speed-extra-label">${key.charAt(0).toUpperCase() + key.slice(1)}</span>` +
    numSpinner(`speed.${key}`, 30) +
    `<span class="archivist-speed-extra-ft">ft.</span>` +
    `<button class="archivist-speed-extra-x" data-action="remove-speed" data-speed-key="${key}">${lucideIcon("x")}</button>` +
    `</div>`;
  rowsContainer.insertAdjacentHTML("beforeend", rowHtml);

  // Wire the new row
  const newRow = rowsContainer.lastElementChild as HTMLElement;
  if (newRow) {
    const input = newRow.querySelector<HTMLInputElement>(`[data-field="speed.${key}"]`);
    if (input) {
      input.addEventListener("input", () => {
        state.updateField("speed", { ...state.current.speed, [key]: parseInt(input.value) || 0 });
      });
    }
    wireSpinnersInElement(newRow, container, state);
    const removeBtn = newRow.querySelector<HTMLElement>('[data-action="remove-speed"]');
    if (removeBtn) {
      removeBtn.addEventListener("click", () => {
        newRow.remove();
        state.updateField("speed", { ...state.current.speed, [key]: 0 });
        updateAddSpeedVisibility(container, state);
      });
    }
  }

  updateAddSpeedVisibility(container, state);
}

function wireSpinnersInElement(el: HTMLElement, _container: HTMLElement, _state: MonsterEditState): void {
  const spinUps = el.querySelectorAll<HTMLButtonElement>(".archivist-spin-up");
  const spinDowns = el.querySelectorAll<HTMLButtonElement>(".archivist-spin-down");

  for (const btn of spinUps) {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const field = btn.dataset.spinFor;
      if (!field) return;
      const wrap = btn.closest(".archivist-num-wrap");
      const input = wrap?.querySelector<HTMLInputElement>(`[data-field="${field}"]`);
      if (input) {
        input.value = String((parseInt(input.value) || 0) + 1);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
  }

  for (const btn of spinDowns) {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const field = btn.dataset.spinFor;
      if (!field) return;
      const wrap = btn.closest(".archivist-num-wrap");
      const input = wrap?.querySelector<HTMLInputElement>(`[data-field="${field}"]`);
      if (input) {
        input.value = String((parseInt(input.value) || 0) - 1);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
  }
}

function updateAddSpeedVisibility(container: HTMLElement, state: MonsterEditState): void {
  const extraModeKeys: Array<"fly" | "swim" | "climb" | "burrow"> = ["fly", "swim", "climb", "burrow"];
  const allAdded = extraModeKeys.every(k => (state.current.speed?.[k] ?? 0) > 0);
  const addWrap = container.querySelector<HTMLElement>(".archivist-speed-add-wrap");
  if (addWrap) addWrap.style.display = allAdded ? "none" : "";
}

function wireTabBar(
  container: HTMLElement,
  state: MonsterEditState,
  activeTabKey: string | null,
  onTabChange: (key: string) => void,
): void {
  const tabs = container.querySelectorAll<HTMLElement>("[data-tab]");
  for (const tab of tabs) {
    const tabKey = tab.dataset.tab;
    if (!tabKey) continue;

    tab.addEventListener("click", (e) => {
      // Don't switch tab if clicking the close button
      if ((e.target as HTMLElement).closest("[data-action=\"remove-section\"]")) return;
      // Update active tab visual
      tabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      // Switch panel visibility
      const panels = container.querySelectorAll<HTMLElement>("[data-panel]");
      for (const panel of panels) {
        panel.style.display = panel.dataset.panel === tabKey ? "" : "none";
      }
      onTabChange(tabKey);
    });
  }

  // Wire close buttons on tabs
  const closeBtns = container.querySelectorAll<HTMLElement>('[data-action="remove-section"]');
  for (const btn of closeBtns) {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const sectionKey = btn.dataset.section;
      if (!sectionKey) return;
      const label = SECTION_LABELS[sectionKey] ?? sectionKey;
      if (confirm(`Remove "${label}" section?`)) {
        state.removeSection(sectionKey);
        const remaining = state.current.activeSections;
        const newActive = remaining.length > 0 ? remaining[0] : "";
        rebuildTabs(container, state, newActive || null, onTabChange);
        onTabChange(newActive);
      }
    });
  }

  // Scroll arrows
  const tabBarEl = container.querySelector<HTMLElement>(".archivist-tabs");
  const scrollLeft = container.querySelector<HTMLElement>(".archivist-tab-scroll-left");
  const scrollRight = container.querySelector<HTMLElement>(".archivist-tab-scroll-right");
  if (tabBarEl) {
    scrollLeft?.addEventListener("click", () => { tabBarEl.scrollLeft -= 120; });
    scrollRight?.addEventListener("click", () => { tabBarEl.scrollLeft += 120; });
  }
}

function wireAddSectionButton(
  container: HTMLElement,
  state: MonsterEditState,
  onAdd: () => void,
): void {
  const addBtn = container.querySelector<HTMLElement>('[data-action="add-section"]');
  if (!addBtn) return;

  addBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    showSectionDropdown(addBtn, container, state, onAdd);
  });
}

function showSectionDropdown(
  anchor: HTMLElement,
  container: HTMLElement,
  state: MonsterEditState,
  onAdd: () => void,
): void {
  const tabWrap = anchor.closest(".archivist-tab-wrap") ?? anchor.parentElement;
  if (!tabWrap) return;

  const existing = tabWrap.querySelector(".archivist-section-dropdown");
  if (existing) { existing.remove(); return; }

  const dropdown = document.createElement("div");
  dropdown.className = "archivist-section-dropdown";
  tabWrap.appendChild(dropdown);

  for (const section of ALL_SECTIONS) {
    const sectionKey = SECTION_KEY_MAP[section];
    if (!sectionKey) continue;

    const isActive = state.current.activeSections.includes(sectionKey);
    const item = document.createElement("button");
    item.className = `archivist-section-dropdown-item${isActive ? " disabled" : ""}`;
    item.textContent = section;
    dropdown.appendChild(item);

    if (!isActive) {
      item.addEventListener("click", () => {
        state.addSection(sectionKey);
        dropdown.remove();
        onAdd();
      });
    }
  }

  // Close on outside click
  const closeHandler = (e: MouseEvent) => {
    if (!dropdown.contains(e.target as Node) && e.target !== anchor) {
      dropdown.remove();
      document.removeEventListener("click", closeHandler);
    }
  };
  setTimeout(() => document.addEventListener("click", closeHandler), 0);
}

function wireFeatureCards(
  container: HTMLElement,
  state: MonsterEditState,
  activeTabKey: string | null,
  onTabChange: (key: string) => void,
): void {
  if (!activeTabKey) return;

  // Feature name inputs
  const nameInputs = container.querySelectorAll<HTMLInputElement>('[data-field="feature-name"]');
  for (const input of nameInputs) {
    const section = input.dataset.section;
    const index = parseInt(input.dataset.index ?? "");
    if (!section || isNaN(index)) continue;

    input.addEventListener("input", () => {
      const features = getFeatures(state.current, section);
      if (features && features[index]) {
        features[index].name = input.value;
        state.updateField(section, features);
      }
    });
  }

  // Feature text textareas
  const textAreas = container.querySelectorAll<HTMLTextAreaElement>('[data-field="feature-text"]');
  for (const textarea of textAreas) {
    const section = textarea.dataset.section;
    const index = parseInt(textarea.dataset.index ?? "");
    if (!section || isNaN(index)) continue;

    textarea.addEventListener("input", () => {
      const features = getFeatures(state.current, section);
      if (features && features[index]) {
        features[index].entries = textarea.value.split("\n");
        state.updateField(section, features);
        textarea.rows = Math.max(2, textarea.value.split("\n").length);
      }
    });
  }

  // Remove feature buttons
  const removeBtns = container.querySelectorAll<HTMLElement>('[data-action="remove-feature"]');
  for (const btn of removeBtns) {
    btn.addEventListener("click", () => {
      const section = btn.dataset.section;
      const index = parseInt(btn.dataset.index ?? "");
      if (!section || isNaN(index)) return;
      state.removeFeature(section, index);
      rebuildTabContent(container, state, activeTabKey);
      wireFeatureCards(container, state, activeTabKey, onTabChange);
    });
  }

  // Add feature button
  const addBtns = container.querySelectorAll<HTMLElement>('[data-action="add-feature"]');
  for (const btn of addBtns) {
    btn.addEventListener("click", () => {
      const section = btn.dataset.section;
      if (!section) return;
      state.addFeature(section);
      rebuildTabContent(container, state, activeTabKey);
      wireFeatureCards(container, state, activeTabKey, onTabChange);
    });
  }

  // Attach tag autocomplete to all feature textareas
  container.querySelectorAll("textarea.archivist-feat-text-input").forEach((ta) => {
    if (ta instanceof HTMLTextAreaElement) {
      attachTagAutocomplete(ta, state);
    }
  });
}

function wireLegendarySpinners(container: HTMLElement, state: MonsterEditState): void {
  const actionsInput = container.querySelector<HTMLInputElement>('[data-field="legendary_actions"]');
  if (actionsInput) {
    actionsInput.addEventListener("input", () => {
      state.updateField("legendary_actions", parseInt(actionsInput.value) || 0);
    });
  }

  const resistInput = container.querySelector<HTMLInputElement>('[data-field="legendary_resistance"]');
  if (resistInput) {
    resistInput.addEventListener("input", () => {
      state.updateField("legendary_resistance", parseInt(resistInput.value) || 0);
    });
  }
}

// ---------------------------------------------------------------------------
// Rebuild helpers (for dynamic tab/section changes)
// ---------------------------------------------------------------------------

function rebuildTabs(
  container: HTMLElement,
  state: MonsterEditState,
  activeTabKey: string | null,
  onTabChange: (key: string) => void,
): void {
  const tabBarEl = container.querySelector<HTMLElement>(".archivist-tabs");
  if (!tabBarEl) return;

  tabBarEl.textContent = "";

  for (const sectionKey of state.current.activeSections) {
    const label = SECTION_LABELS[sectionKey] ?? sectionKey;
    const activeCls = sectionKey === activeTabKey ? " active" : "";
    const tabHtml =
      `<button class="archivist-tab${activeCls}" data-tab="${escapeHtml(sectionKey)}">` +
      `<span class="archivist-tab-inner">` +
      `<span>${escapeHtml(label)}</span>` +
      `<span class="archivist-tab-close" data-action="remove-section" data-section="${escapeHtml(sectionKey)}">${lucideIcon("x")}</span>` +
      `</span></button>`;
    tabBarEl.insertAdjacentHTML("beforeend", tabHtml);
  }

  // Re-wire tab events
  wireTabBar(container, state, activeTabKey, onTabChange);
}

function rebuildTabContent(
  container: HTMLElement,
  state: MonsterEditState,
  activeTabKey: string | null,
): void {
  const contentEl = container.querySelector<HTMLElement>(".archivist-tab-content");
  if (!contentEl) return;

  contentEl.textContent = "";

  if (!activeTabKey) {
    contentEl.insertAdjacentHTML("beforeend", '<div class="archivist-auto-label">Click + to add a section</div>');
    return;
  }

  // Rebuild all panels, show only the active one
  for (const sectionKey of state.current.activeSections) {
    const isActive = sectionKey === activeTabKey;
    let panelHtml = `<div class="archivist-tab-panel" data-panel="${escapeHtml(sectionKey)}"${isActive ? "" : ' style="display:none"'}>`;

    // Legendary checkboxes
    if (sectionKey === "legendary") {
      panelHtml += renderLegendaryCheckboxesHtml(state.current);
    }

    const features = getFeatures(state.current, sectionKey);
    if (features) {
      for (let i = 0; i < features.length; i++) {
        panelHtml += featureCard(sectionKey, i, features[i]);
      }
    }

    const singular = SECTION_SINGULAR[sectionKey] ?? "Feature";
    panelHtml += `<button class="archivist-add-btn" data-action="add-feature" data-section="${escapeHtml(sectionKey)}">+ Add ${escapeHtml(singular)}</button>`;
    panelHtml += '</div>';
    contentEl.insertAdjacentHTML("beforeend", panelHtml);
  }

  // Wire legendary spinners if legendary panel exists
  if (state.current.activeSections.includes("legendary")) {
    wireLegendarySpinners(container, state);
    wireSpinnersInElement(contentEl, container, state);
  }

  // Wire feature cards for all panels
  wireFeatureCards(container, state, activeTabKey, (newKey) => {
    rebuildTabContent(container, state, newKey);
  });
}

// ---------------------------------------------------------------------------
// updateDom — refresh computed values after state changes
// ---------------------------------------------------------------------------

function updateDom(container: HTMLElement, state: MonsterEditState): void {
  const m = state.current;
  const abilities = m.abilities ?? { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  const profBonus = m.proficiencyBonus;

  // HP
  const hpEl = container.querySelector<HTMLElement>('[data-display="hp"]');
  if (hpEl) hpEl.textContent = String(m.hp?.average ?? 0);

  // XP
  const xpEl = container.querySelector<HTMLElement>('[data-display="xp"]');
  if (xpEl) xpEl.textContent = formatXP(m.xp);

  // Ability modifiers
  for (const key of ABILITY_KEYS) {
    const modEl = container.querySelector<HTMLElement>(`[data-display="mod.${key}"]`);
    if (modEl) {
      const score = abilities[key as keyof MonsterAbilities];
      modEl.textContent = `(${formatModifier(abilityModifier(score))})`;
    }
  }

  // Saves
  for (const key of ABILITY_KEYS) {
    const valEl = container.querySelector<HTMLElement>(`[data-display="save.${key}"]`);
    if (valEl && !m.overrides.has(`saves.${key}`)) {
      const score = abilities[key as keyof MonsterAbilities];
      const sv = savingThrow(score, m.saveProficiencies[key], profBonus);
      valEl.textContent = formatModifier(sv);
    }
    if (valEl) {
      valEl.classList.toggle("proficient-value", m.saveProficiencies[key]);
    }
  }

  // Skills
  for (const skill of ALL_SKILLS) {
    const skillLower = skill.toLowerCase();
    const abilityKey = SKILL_ABILITY[skillLower];
    const valEl = container.querySelector<HTMLElement>(`[data-display="skill.${skillLower}"]`);
    if (valEl && !m.overrides.has(`skills.${skillLower}`)) {
      const score = abilities[abilityKey as keyof MonsterAbilities];
      const prof = m.skillProficiencies[skillLower] ?? "none";
      valEl.textContent = formatModifier(skillBonus(score, prof, profBonus));
    }
    if (valEl) {
      const prof = m.skillProficiencies[skillLower] ?? "none";
      valEl.classList.toggle("proficient-value", prof !== "none");
    }
  }

  // Passive Perception
  const ppEl = container.querySelector<HTMLElement>('[data-display="pp"]');
  if (ppEl) {
    const wisScore = abilities.wis;
    const percProf = m.skillProficiencies["perception"] ?? "none";
    ppEl.textContent = String(passivePerception(wisScore, percProf, profBonus));
    ppEl.classList.toggle("proficient-value", percProf !== "none");
  }
}
