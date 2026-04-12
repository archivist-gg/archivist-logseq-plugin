import type { Item } from "../types/item";
import {
  el,
  escapeHtml,
  createIconProperty,
  renderTextWithInlineTags,
} from "./renderer-utils";

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

function capitalizeWords(str: string): string {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatAttunement(attunement: Item["attunement"]): string {
  if (attunement === true) return "Required";
  if (typeof attunement === "string") return attunement;
  return "Not Required";
}

function buildSubtitle(item: Item): string {
  const parts: string[] = [];

  if (item.type) {
    parts.push(capitalizeWords(item.type));
  }

  if (item.rarity && item.rarity !== "unknown") {
    parts.push(capitalizeWords(item.rarity));
  }

  if (item.attunement) {
    if (typeof item.attunement === "string") {
      parts.push(`(requires attunement by ${item.attunement})`);
    } else {
      parts.push("(requires attunement)");
    }
  }

  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// Exported: renderItemBlock
// ---------------------------------------------------------------------------

export function renderItemBlock(item: Item): string {
  // 1. Header (name + subtitle)
  const headerParts: string[] = [
    el("h3", "archivist-item-name", escapeHtml(item.name)),
  ];
  const subtitle = buildSubtitle(item);
  if (subtitle) {
    headerParts.push(el("div", "archivist-item-subtitle", escapeHtml(subtitle)));
  }
  const header = el("div", "archivist-item-block-header", headerParts);

  // 2. Properties with icons
  const propParts: string[] = [];

  if (item.attunement !== undefined) {
    propParts.push(
      createIconProperty("sparkles", "Attunement:", formatAttunement(item.attunement)),
    );
  }

  if (item.weight) {
    propParts.push(createIconProperty("scale", "Weight:", `${item.weight} lb.`));
  }

  if (item.value) {
    propParts.push(createIconProperty("coins", "Value:", `${item.value} gp`));
  }

  if (item.damage) {
    const damageStr = item.damage_type
      ? `${item.damage} ${item.damage_type}`
      : item.damage;
    propParts.push(createIconProperty("swords", "Damage:", damageStr));
  }

  if (item.properties && item.properties.length > 0) {
    propParts.push(
      createIconProperty(
        "shield",
        "Properties:",
        item.properties.map(capitalizeWords).join(", "),
      ),
    );
  }

  const props = el("div", "archivist-item-properties", propParts);

  // 3. Description paragraphs with inline tag support
  let descHtml = "";
  if (item.entries && item.entries.length > 0) {
    const paragraphs = item.entries.map((entry) =>
      el("div", "description-paragraph", renderTextWithInlineTags(entry)),
    );
    descHtml = el("div", "archivist-item-description", paragraphs);
  }

  // 4. Charges section (with recharge)
  let chargesHtml = "";
  if (item.charges) {
    let chargesText = `${item.charges} charges`;
    if (item.recharge) {
      chargesText += `. Recharge: ${item.recharge}`;
    }
    chargesHtml = el("div", "archivist-item-charges", escapeHtml(chargesText));
  }

  // 5. Curse tag
  let curseHtml = "";
  if (item.curse) {
    curseHtml = el("div", "archivist-item-curse", "Cursed");
  }

  // Assemble block
  const blockContent = [header, props, descHtml, chargesHtml, curseHtml].filter(Boolean);
  const block = el("div", "archivist-item-block", blockContent);
  return el("div", "archivist-item-block-wrapper", block);
}
