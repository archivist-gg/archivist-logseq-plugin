import type { Monster, MonsterFeature } from "../types/monster";
import { abilityModifier, formatModifier } from "../parsers/yaml-utils";
import {
  el,
  escapeHtml,
  createSvgBar,
  createPropertyLine,
  createRichPropertyLine,
  renderTextWithInlineTags,
  MonsterFormulaContext,
} from "./renderer-utils";
import { proficiencyBonusFromCR } from "../dnd/math";

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

function capitalizeWords(str: string): string {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatSpeed(speed: Monster["speed"]): string {
  if (!speed) return "0 ft.";
  return Object.entries(speed)
    .filter(([_, v]) => v)
    .map(([type, value]) => `${capitalizeWords(type)} ${value} ft.`)
    .join(", ");
}

function formatAC(monster: Monster): string {
  if (!monster.ac || monster.ac.length === 0) return "10";
  const primary = monster.ac[0];
  let result = String(primary.ac);
  if (primary.from && primary.from.length > 0) {
    result += ` (${primary.from.map((f) => capitalizeWords(f)).join(", ")})`;
  }
  return result;
}

function renderFeatureBlock(
  features: MonsterFeature[],
  monsterCtx?: MonsterFormulaContext,
): string {
  return features
    .map((feature) => {
      const entryText = feature.entries.join(" ");
      const renderedEntry = renderTextWithInlineTags(entryText, true, monsterCtx);
      return (
        '<div class="archivist-feature">' +
        `<span class="archivist-feature-name">${escapeHtml(feature.name)}.</span>` +
        `<span class="archivist-feature-entry">${renderedEntry}</span>` +
        "</div>"
      );
    })
    .join("");
}

function renderLegendaryBoxes(count: number): string {
  let boxes = "";
  for (let i = 0; i < count; i++) {
    boxes += '<div class="archivist-legendary-box"></div>';
  }
  return `<div class="archivist-legendary-box-row">${boxes}</div>`;
}

function renderLegendarySection(monster: Monster): string {
  const legendaryCount = monster.legendary_actions ?? 3;
  const monsterName = monster.name.toLowerCase();
  let html = "";

  // Intro text
  const introText =
    `The ${monsterName} can take ${legendaryCount} legendary actions, ` +
    `choosing from the options below. Only one legendary action option can be used at a time ` +
    `and only at the end of another creature's turn. The ${monsterName} regains spent legendary ` +
    `actions at the start of its turn.`;
  html += `<p class="archivist-legendary-intro">${escapeHtml(introText)}</p>`;
  html += renderLegendaryBoxes(legendaryCount);

  // Legendary resistance
  if (monster.legendary_resistance && monster.legendary_resistance > 0) {
    const resCount = monster.legendary_resistance;
    html +=
      '<div class="archivist-legendary-resistance">' +
      '<p class="archivist-legendary-resistance-text">' +
      `<strong>Legendary Resistance (${resCount}/Day). </strong>` +
      `If the ${monsterName} fails a saving throw, it can choose to succeed instead.` +
      "</p>" +
      renderLegendaryBoxes(resCount) +
      "</div>";
  }

  return html;
}

// ---------------------------------------------------------------------------
// Exported: renderMonsterBlock
// ---------------------------------------------------------------------------

export function renderMonsterBlock(monster: Monster, columns?: number): string {
  const isTwoCol = columns === 2;

  // Build formula resolution context for inline tags (e.g. `atk:DEX` -> `+4`)
  const monsterCtx: MonsterFormulaContext | undefined = monster.abilities
    ? { abilities: monster.abilities, proficiencyBonus: proficiencyBonusFromCR(monster.cr ?? "0") }
    : undefined;

  const parts: string[] = [];

  // 1. Header
  const typeText = [
    monster.size ? capitalizeWords(monster.size) : "",
    monster.type ? capitalizeWords(monster.type) : "",
  ]
    .filter(Boolean)
    .join(" ");
  const fullType = monster.alignment
    ? `${typeText}, ${capitalizeWords(monster.alignment)}`
    : typeText;

  parts.push(
    '<div class="stat-block-header">' +
    `<div class="monster-name">${escapeHtml(monster.name)}</div>` +
    `<p class="monster-type">${escapeHtml(fullType)}</p>` +
    "</div>",
  );

  // 2. SVG Bar
  parts.push(createSvgBar());

  // 3. Core properties (AC, HP, Speed)
  let coreLines = "";
  coreLines += createPropertyLine("Armor Class", formatAC(monster));

  // HP with dice pill
  if (monster.hp) {
    let hpValueHtml = escapeHtml(String(monster.hp.average));
    if (monster.hp.formula) {
      hpValueHtml += " (" + renderTextWithInlineTags(monster.hp.formula, true, monsterCtx) + ")";
    }
    coreLines += createRichPropertyLine("Hit Points", hpValueHtml);
  } else {
    coreLines += createPropertyLine("Hit Points", "0");
  }

  coreLines += createPropertyLine("Speed", formatSpeed(monster.speed), true);
  parts.push(el("div", "property-block", coreLines));

  // 4. SVG Bar
  parts.push(createSvgBar());

  // 5. Abilities table
  if (monster.abilities) {
    const abilityNames = ["STR", "DEX", "CON", "INT", "WIS", "CHA"] as const;
    const abilityKeys = ["str", "dex", "con", "int", "wis", "cha"] as const;

    let headerCells = "";
    for (const name of abilityNames) {
      headerCells += `<th>${name}</th>`;
    }

    let valueCells = "";
    for (const key of abilityKeys) {
      const score = monster.abilities[key];
      const mod = abilityModifier(score);
      valueCells +=
        `<td><span class="ability-score">${score}</span> (${formatModifier(mod)})</td>`;
    }

    parts.push(
      '<div class="abilities-block">' +
      '<table class="abilities-table">' +
      `<thead><tr>${headerCells}</tr></thead>` +
      `<tbody><tr>${valueCells}</tr></tbody>` +
      "</table></div>",
    );
  }

  // 6. SVG Bar
  parts.push(createSvgBar());

  // 7. Secondary properties
  let secondaryLines = "";
  let hasSecondary = false;

  if (monster.saves && Object.keys(monster.saves).length > 0) {
    const savesStr = Object.entries(monster.saves)
      .map(([k, v]) => `${capitalizeWords(k)} ${formatModifier(v as number)}`)
      .join(", ");
    secondaryLines += createPropertyLine("Saving Throws", savesStr);
    hasSecondary = true;
  }

  if (monster.skills && Object.keys(monster.skills).length > 0) {
    const skillsStr = Object.entries(monster.skills)
      .map(([k, v]) => `${capitalizeWords(k)} ${formatModifier(v)}`)
      .join(", ");
    secondaryLines += createPropertyLine("Skills", skillsStr);
    hasSecondary = true;
  }

  if (monster.damage_vulnerabilities && monster.damage_vulnerabilities.length > 0) {
    secondaryLines += createPropertyLine(
      "Damage Vulnerabilities",
      monster.damage_vulnerabilities.map(capitalizeWords).join(", "),
    );
    hasSecondary = true;
  }

  if (monster.damage_resistances && monster.damage_resistances.length > 0) {
    secondaryLines += createPropertyLine(
      "Damage Resistances",
      monster.damage_resistances.map(capitalizeWords).join(", "),
    );
    hasSecondary = true;
  }

  if (monster.damage_immunities && monster.damage_immunities.length > 0) {
    secondaryLines += createPropertyLine(
      "Damage Immunities",
      monster.damage_immunities.map(capitalizeWords).join(", "),
    );
    hasSecondary = true;
  }

  if (monster.condition_immunities && monster.condition_immunities.length > 0) {
    secondaryLines += createPropertyLine(
      "Condition Immunities",
      monster.condition_immunities.map(capitalizeWords).join(", "),
    );
    hasSecondary = true;
  }

  if (monster.senses && monster.senses.length > 0) {
    let sensesStr = monster.senses.join(", ");
    if (monster.passive_perception) {
      sensesStr += `, passive Perception ${monster.passive_perception}`;
    }
    secondaryLines += createPropertyLine("Senses", sensesStr);
    hasSecondary = true;
  } else if (monster.passive_perception) {
    secondaryLines += createPropertyLine(
      "Senses",
      `passive Perception ${monster.passive_perception}`,
    );
    hasSecondary = true;
  }

  if (monster.languages && monster.languages.length > 0) {
    secondaryLines += createPropertyLine(
      "Languages",
      monster.languages.map(capitalizeWords).join(", "),
    );
    hasSecondary = true;
  }

  if (monster.cr) {
    secondaryLines += createPropertyLine("Challenge", monster.cr);
    hasSecondary = true;
  }

  if (hasSecondary) {
    parts.push(el("div", "property-block", secondaryLines));
  }

  // 8. SVG Bar (only if secondary props exist)
  if (hasSecondary) {
    parts.push(createSvgBar());
  }

  // 9. Sections (traits, actions, reactions, legendary)
  const sectionDefs: {
    id: string;
    label: string;
    features: MonsterFeature[] | undefined;
  }[] = [
    { id: "traits", label: "Traits", features: monster.traits },
    { id: "actions", label: "Actions", features: monster.actions },
    { id: "reactions", label: "Reactions", features: monster.reactions },
    { id: "legendary", label: "Legendary Actions", features: monster.legendary },
  ];

  const activeSections = sectionDefs.filter(
    (s) => s.features && s.features.length > 0,
  );

  if (activeSections.length > 0 && isTwoCol) {
    // Two-column mode: render all sections sequentially with headers (no tabs)
    for (const section of activeSections) {
      let sectionHtml = "";

      // Traits render inline without a section header (PHB-style)
      if (section.id !== "traits") {
        sectionHtml += `<div class="actions-header">${escapeHtml(section.label)}</div>`;
      }

      if (section.id === "legendary") {
        sectionHtml += renderLegendarySection(monster);
      }

      if (section.features) {
        sectionHtml += renderFeatureBlock(section.features, monsterCtx);
      }

      parts.push(el("div", "archivist-monster-section", sectionHtml));
    }
  } else if (activeSections.length > 0) {
    // Single-column mode: tabbed navigation
    let navButtons = "";
    for (let i = 0; i < activeSections.length; i++) {
      const tab = activeSections[i];
      const btnClass = i === 0
        ? "original-tab-button active"
        : "original-tab-button";
      navButtons += `<button class="${btnClass}">${escapeHtml(tab.label)}</button>`;
    }
    parts.push(
      '<div class="original-tab-navigation-wrapper">' +
      `<div class="original-tab-navigation">${navButtons}</div>` +
      "</div>",
    );

    // Tab content
    for (let i = 0; i < activeSections.length; i++) {
      const tab = activeSections[i];
      const displayStyle = i === 0 ? "" : ' style="display:none"';
      let tabContent = "";

      if (tab.id === "legendary") {
        tabContent += renderLegendarySection(monster);
      }

      if (tab.features) {
        tabContent += renderFeatureBlock(tab.features, monsterCtx);
      }

      parts.push(
        `<div class="original-tab-content" data-tab-id="${escapeHtml(tab.id)}"${displayStyle}>${tabContent}</div>`,
      );
    }
  }

  // Assemble: content target wraps inner parts
  const innerContent = parts.join("");
  const contentTarget = isTwoCol
    ? `<div class="archivist-monster-two-col-flow">${innerContent}</div>`
    : innerContent;

  const block = `<div class="archivist-monster-block">${contentTarget}</div>`;
  const wrapperClass = isTwoCol
    ? "archivist-monster-block-wrapper archivist-monster-two-col"
    : "archivist-monster-block-wrapper";

  return `<div class="${wrapperClass}">${block}</div>`;
}

// ---------------------------------------------------------------------------
// Exported: initMonsterTabs (post-injection DOM wiring)
// ---------------------------------------------------------------------------

export function initMonsterTabs(container: HTMLElement): void {
  const buttons = container.querySelectorAll<HTMLElement>(".original-tab-button");
  const contents = container.querySelectorAll<HTMLElement>(".original-tab-content");

  if (buttons.length === 0 || contents.length === 0) return;

  buttons.forEach((btn, index) => {
    btn.addEventListener("click", () => {
      // Deactivate all buttons
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      // Show matching content, hide others
      contents.forEach((content, contentIndex) => {
        content.style.display = contentIndex === index ? "" : "none";
      });
    });
  });

  // Wire legendary action/resistance checkbox rows
  const CHECKED = "archivist-legendary-box-checked";
  container.querySelectorAll<HTMLElement>(".archivist-legendary-box-row").forEach((row) => {
    const boxes = Array.from(row.querySelectorAll<HTMLElement>(".archivist-legendary-box"));
    boxes.forEach((box, i) => {
      box.addEventListener("click", () => {
        const isChecked = box.classList.contains(CHECKED);
        const currentCount = boxes.filter((b) => b.classList.contains(CHECKED)).length;
        const newCount = isChecked ? currentCount - 1 : i + 1;
        boxes.forEach((b, j) => {
          b.classList.toggle(CHECKED, j < newCount);
        });
      });
    });
  });
}
