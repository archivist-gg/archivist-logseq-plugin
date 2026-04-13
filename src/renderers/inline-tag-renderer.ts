import type { InlineTag, InlineTagType } from "../parsers/inline-tag-parser";
import { escapeHtml, lucideIcon, isRollable, extractDiceNotation } from "./renderer-utils";

interface InlineTagConfig {
  iconName: string;
  cssClass: string;
  format: (content: string) => string;
}

const INLINE_TAG_CONFIGS: Record<InlineTagType, InlineTagConfig> = {
  dice: { iconName: "dices", cssClass: "archivist-stat-tag-dice", format: (c) => c },
  damage: { iconName: "dices", cssClass: "archivist-stat-tag-damage", format: (c) => c },
  dc: { iconName: "shield", cssClass: "archivist-stat-tag-dc", format: (c) => `DC ${c}` },
  atk: { iconName: "swords", cssClass: "archivist-stat-tag-atk", format: (c) => `${c} to hit` },
  mod: { iconName: "dices", cssClass: "archivist-stat-tag-dice", format: (c) => c },
  check: { iconName: "shield", cssClass: "archivist-stat-tag-dc", format: (c) => c },
};

export function renderInlineTag(tag: InlineTag): string {
  const config = INLINE_TAG_CONFIGS[tag.type];
  const displayText = config.format(tag.content);

  const notation = extractDiceNotation(tag);
  const dataAttrs = notation ? ` data-dice-notation="${escapeHtml(notation)}"` : "";

  return [
    `<span class="archivist-stat-tag ${config.cssClass}"${dataAttrs} title="${escapeHtml(displayText)}">`,
    `<span class="archivist-stat-tag-icon">${lucideIcon(config.iconName)}</span>`,
    `<span>${escapeHtml(displayText)}</span>`,
    `</span>`,
  ].join("");
}
