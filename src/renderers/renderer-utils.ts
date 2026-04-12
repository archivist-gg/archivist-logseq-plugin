import { parseInlineTag } from "../parsers/inline-tag-parser";
import type { MonsterAbilities } from "../types/monster";
import { detectFormula, resolveFormulaTag } from "../dnd/formula-tags";

// ---------------------------------------------------------------------------
// HTML Escaping
// ---------------------------------------------------------------------------

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// Element Builder
// ---------------------------------------------------------------------------

/**
 * Build an HTML element string. Content is NOT escaped (may contain child HTML).
 * Attribute values ARE escaped.
 */
export function el(
  tag: string,
  className: string,
  content: string | string[],
  attrs?: Record<string, string>,
): string {
  const body = Array.isArray(content) ? content.join("") : content;
  let attrStr = "";
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      attrStr += ` ${key}="${escapeHtml(value)}"`;
    }
  }
  return `<${tag} class="${className}"${attrStr}>${body}</${tag}>`;
}

// ---------------------------------------------------------------------------
// SVG Separator Bar
// ---------------------------------------------------------------------------

export function createSvgBar(): string {
  return '<svg class="stat-block-bar" height="5" width="100%" preserveAspectRatio="none" viewBox="0 0 400 5"><polyline points="0,0 400,2.5 0,5"></polyline></svg>';
}

// ---------------------------------------------------------------------------
// Property Lines
// ---------------------------------------------------------------------------

export function createPropertyLine(
  label: string,
  value: string,
  isLast?: boolean,
): string {
  const cls = isLast ? "property-line last" : "property-line";
  return `<div class="${cls}"><h4>${escapeHtml(label)}</h4><p>${escapeHtml(value)}</p></div>`;
}

export function createRichPropertyLine(
  label: string,
  valueHtml: string,
  isLast?: boolean,
): string {
  const cls = isLast ? "property-line last" : "property-line";
  return `<div class="${cls}"><h4>${escapeHtml(label)}</h4><p>${valueHtml}</p></div>`;
}

export function createIconProperty(
  iconName: string,
  label: string,
  value: string,
): string {
  const iconSvg = lucideIcon(iconName);
  return (
    '<div class="archivist-property-line-icon">' +
    `<span class="archivist-property-icon">${iconSvg}</span>` +
    `<span class="archivist-property-label">${escapeHtml(label)}</span>` +
    `<span class="archivist-property-value">${escapeHtml(value)}</span>` +
    "</div>"
  );
}

// ---------------------------------------------------------------------------
// Lucide Icons (inline SVG)
// ---------------------------------------------------------------------------

const ICON_PATHS: Record<string, string> = {
  dices:
    '<rect width="12" height="12" x="2" y="10" rx="2" ry="2"/>' +
    '<path d="m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6.08"/>' +
    '<path d="M6 18h.01"/><path d="M10 14h.01"/>' +
    '<path d="M15 6h.01"/><path d="M18 9h.01"/>',
  swords:
    '<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/>' +
    '<line x1="13" x2="19" y1="19" y2="13"/>' +
    '<line x1="16" x2="20" y1="16" y2="20"/>' +
    '<line x1="19" x2="21" y1="21" y2="19"/>' +
    '<polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"/>' +
    '<line x1="5" x2="9" y1="14" y2="18"/>' +
    '<line x1="7" x2="4" y1="17" y2="20"/>' +
    '<line x1="3" x2="5" y1="19" y2="21"/>',
  shield:
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  clock:
    '<circle cx="12" cy="12" r="10"/>' +
    '<polyline points="12 6 12 12 16 14"/>',
  target:
    '<circle cx="12" cy="12" r="10"/>' +
    '<circle cx="12" cy="12" r="6"/>' +
    '<circle cx="12" cy="12" r="2"/>',
  box:
    '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>' +
    '<path d="m3.3 7 8.7 5 8.7-5"/>' +
    '<path d="M12 22V12"/>',
  sparkles:
    '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>' +
    '<path d="M20 3v4"/><path d="M22 5h-4"/>' +
    '<path d="M4 17v2"/><path d="M5 18H3"/>',
  scale:
    '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/>' +
    '<path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/>' +
    '<path d="M7 21h10"/>' +
    '<path d="M12 3v18"/>' +
    '<path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
  coins:
    '<circle cx="8" cy="8" r="6"/>' +
    '<path d="M18.09 10.37A6 6 0 1 1 10.34 18"/>' +
    '<path d="M7 6h1v4"/>' +
    '<path d="m16.71 13.88.7.71-2.82 2.82"/>',
  "book-open":
    '<path d="M12 7v14"/>' +
    '<path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  "alert-triangle":
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/>' +
    '<path d="M12 9v4"/>' +
    '<path d="M12 17h.01"/>',
  // -- Edit mode icons --
  code:
    '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  "columns-2":
    '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18"/>',
  pencil:
    '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>' +
    '<path d="m15 5 4 4"/>',
  "trash-2":
    '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>' +
    '<path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>' +
    '<line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  "file-x":
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>' +
    '<path d="M14 2v4a2 2 0 0 0 2 2h4"/>' +
    '<path d="m14.5 12.5-5 5"/><path d="m9.5 12.5 5 5"/>',
  "book-x":
    '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/>' +
    '<path d="m14.5 7-5 5"/><path d="m9.5 7 5 5"/>',
  x:
    '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  check:
    '<path d="M20 6 9 17l-5-5"/>',
  plus:
    '<path d="M5 12h14"/><path d="M12 5v14"/>',
  minus:
    '<path d="M5 12h14"/>',
  "chevron-down":
    '<path d="m6 9 6 6 6-6"/>',
  "chevron-right":
    '<path d="m9 18 6-6-6-6"/>',
  "chevron-up":
    '<path d="m18 15-6-6-6 6"/>',
  "refresh-cw":
    '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>' +
    '<path d="M21 3v5h-5"/>' +
    '<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>' +
    '<path d="M3 21v-5h5"/>',
  skull:
    '<circle cx="9" cy="12" r="1"/>' +
    '<circle cx="15" cy="12" r="1"/>' +
    '<path d="M8 20v2h8v-2"/>' +
    '<path d="m12.5 17-.5-1-.5 1h1z"/>' +
    '<path d="M16 20a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20"/>',
  zap:
    '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  "pen-line":
    '<path d="M12 20h9"/>' +
    '<path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/>',
  save:
    '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/>' +
    '<path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/>' +
    '<path d="M7 3v4a1 1 0 0 0 1 1h7"/>',
};

export function lucideIcon(name: string): string {
  const paths = ICON_PATHS[name];
  if (!paths) return "";
  return (
    '<span class="archivist-icon">' +
    '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    paths +
    "</svg></span>"
  );
}

// ---------------------------------------------------------------------------
// Monster Formula Context
// ---------------------------------------------------------------------------

export interface MonsterFormulaContext {
  abilities: MonsterAbilities;
  proficiencyBonus: number;
}

// ---------------------------------------------------------------------------
// Stat Tag Configuration
// ---------------------------------------------------------------------------

interface StatTagConfig {
  iconName: string;
  cssClass: string;
  format: (content: string) => string;
  rollable: boolean;
}

const STAT_TAG_CONFIGS: Record<string, StatTagConfig> = {
  dice: { iconName: "dices", cssClass: "archivist-stat-tag-dice", format: (c) => c, rollable: true },
  roll: { iconName: "dices", cssClass: "archivist-stat-tag-dice", format: (c) => c, rollable: true },
  d: { iconName: "dices", cssClass: "archivist-stat-tag-dice", format: (c) => c, rollable: true },
  damage: { iconName: "dices", cssClass: "archivist-stat-tag-damage", format: (c) => c, rollable: true },
  atk: { iconName: "swords", cssClass: "archivist-stat-tag-atk", format: (c) => `${c} to hit`, rollable: true },
  dc: { iconName: "shield", cssClass: "archivist-stat-tag-dc", format: (c) => `DC ${c}`, rollable: false },
  mod: { iconName: "dices", cssClass: "archivist-stat-tag-dice", format: (c) => c, rollable: true },
  check: { iconName: "shield", cssClass: "archivist-stat-tag-dc", format: (c) => c, rollable: false },
};

// ---------------------------------------------------------------------------
// 5e Tools Tag Conversion
// ---------------------------------------------------------------------------

export function convert5eToolsTags(text: string): string {
  const rewritten = text
    // Attack type labels (order matters: compound first)
    .replace(/\{@atk\s+mw,rw\}/gi, "Melee or Ranged Weapon Attack:")
    .replace(/\{@atk\s+mws\}/gi, "Melee or Ranged Weapon Attack:")
    .replace(/\{@atk\s+msw\}/gi, "Melee or Ranged Spell Attack:")
    .replace(/\{@atk\s+mw\}/gi, "Melee Weapon Attack:")
    .replace(/\{@atk\s+rw\}/gi, "Ranged Weapon Attack:")
    .replace(/\{@atk\s+ms\}/gi, "Melee Spell Attack:")
    .replace(/\{@atk\s+rs\}/gi, "Ranged Spell Attack:")
    // Hit bonus -> `atk:+N`
    .replace(/\{@hit\s+(\d+)\}/gi, "`atk:+$1`")
    // Hit label
    .replace(/\{@h\}/gi, "Hit:")
    // Damage -> `damage:XdY+Z type`
    .replace(/\{@damage\s+([^}]+)\}/gi, "`damage:$1`")
    // Dice -> `roll:XdY+Z`
    .replace(/\{@dice\s+([^}]+)\}/gi, "`roll:$1`")
    .replace(/\{@d20\s+([^}]+)\}/gi, "`roll:d20$1`")
    // DC -> `dc:N`
    .replace(/\{@dc\s+(\d+)\}/gi, "`dc:$1`")
    // Recharge -> "(Recharge X-6)" or "(Recharge)"
    .replace(/\{@recharge\s+(\d)\}/gi, "(Recharge $1-6)")
    .replace(/\{@recharge\}/gi, "(Recharge)")
    // Chance -> "N% chance"
    .replace(/\{@chance\s+(\d+)\}/gi, "$1% chance")
    // Formatting
    .replace(/\{@b(?:old)?\s+([^}]+)\}/gi, "**$1**")
    .replace(/\{@i(?:talic)?\s+([^}]+)\}/gi, "_$1_")
    .replace(/\{@s(?:trike)?\s+([^}]+)\}/gi, "~~$1~~")
    .replace(/\{@note\s+([^}]+)\}/gi, "($1)")
    // Entity references -- extract display name (first part before |)
    .replace(/\{@spell\s+([^|}]+)[^}]*\}/gi, "_$1_")
    .replace(/\{@item\s+([^|}]+)[^}]*\}/gi, "$1")
    .replace(/\{@creature\s+([^|}]+)[^}]*\}/gi, "$1")
    .replace(/\{@condition\s+([^|}]+)[^}]*\}/gi, "$1")
    .replace(/\{@skill\s+([^|}]+)[^}]*\}/gi, "$1")
    .replace(/\{@sense\s+([^|}]+)[^}]*\}/gi, "$1")
    .replace(/\{@action\s+([^|}]+)[^}]*\}/gi, "**$1**")
    .replace(/\{@status\s+([^|}]+)[^}]*\}/gi, "**$1**")
    .replace(/\{@ability\s+([^|}]+)[^}]*\}/gi, "**$1**")
    .replace(/\{@class\s+([^|}]+)[^}]*\}/gi, "$1")
    .replace(/\{@feat\s+([^|}]+)[^}]*\}/gi, "**$1**")
    .replace(/\{@background\s+([^|}]+)[^}]*\}/gi, "$1")
    .replace(/\{@race\s+([^|}]+)[^}]*\}/gi, "$1")
    .replace(/\{@disease\s+([^|}]+)[^}]*\}/gi, "**$1**")
    .replace(/\{@hazard\s+([^|}]+)[^}]*\}/gi, "**$1**")
    .replace(/\{@plane\s+([^|}]+)[^}]*\}/gi, "$1")
    .replace(/\{@language\s+([^|}]+)[^}]*\}/gi, "$1")
    .replace(/\{@book\s+([^|}]+)[^}]*\}/gi, "_$1_")
    .replace(/\{@adventure\s+([^|}]+)[^}]*\}/gi, "_$1_")
    // Catch-all: any remaining {@tag content} -> just content
    .replace(/\{@\w+\s+([^}]+)\}/g, "$1");

  // decorateProseDice inlined
  return rewritten.replace(
    /`[^`]*`|(?<!\w)(\d+d\d+(?:\s*[+-]\s*\d+)?)(?!\w)/g,
    (match, dice) => {
      if (dice) return `\`dice:${dice.replace(/\s+/g, "")}\``;
      return match;
    },
  );
}

// ---------------------------------------------------------------------------
// Markdown Text -> HTML
// ---------------------------------------------------------------------------

/**
 * Convert inline markdown to HTML string.
 * Supports: ***bold italic***, **bold**, *italic*, _italic_, ~~strikethrough~~, [text](url)
 * Plain text segments are escaped.
 */
export function appendMarkdownText(text: string): string {
  const regex =
    /\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|(?<![a-zA-Z0-9])_([^_]+)_(?![a-zA-Z0-9])|~~(.+?)~~|\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let result = "";

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result += escapeHtml(text.slice(lastIndex, match.index));
    }

    if (match[1] !== undefined) {
      result += `<strong><em>${escapeHtml(match[1])}</em></strong>`;
    } else if (match[2] !== undefined) {
      result += `<strong>${escapeHtml(match[2])}</strong>`;
    } else if (match[3] !== undefined) {
      result += `<em>${escapeHtml(match[3])}</em>`;
    } else if (match[4] !== undefined) {
      result += `<em>${escapeHtml(match[4])}</em>`;
    } else if (match[5] !== undefined) {
      result += `<del>${escapeHtml(match[5])}</del>`;
    } else if (match[6] !== undefined) {
      result += `<a href="${escapeHtml(match[7])}" target="_blank" rel="noopener">${escapeHtml(match[6])}</a>`;
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    result += escapeHtml(text.slice(lastIndex));
  }

  return result;
}

// ---------------------------------------------------------------------------
// Resolve Tag Content (formula tags)
// ---------------------------------------------------------------------------

function resolveTagContent(
  tagType: string,
  content: string,
  monsterCtx?: MonsterFormulaContext,
): string {
  if (!monsterCtx) return content;
  const formula = detectFormula(tagType, content);
  if (!formula) return content;
  const resolved = resolveFormulaTag(
    tagType,
    content,
    monsterCtx.abilities,
    monsterCtx.proficiencyBonus,
  );
  // resolveFormulaTag for dc returns "DC N" but STAT_TAG_CONFIGS.dc.format already prepends "DC ",
  // so strip the prefix to avoid "DC DC N".
  if (tagType === "dc" && resolved.startsWith("DC ")) {
    return resolved.slice(3);
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Stat Block Tag Renderer (HTML string)
// ---------------------------------------------------------------------------

function renderStatBlockTag(
  tag: { type: string; content: string },
  monsterCtx?: MonsterFormulaContext,
): string {
  const config = STAT_TAG_CONFIGS[tag.type];
  if (!config) {
    return `<span>${escapeHtml(tag.content)}</span>`;
  }

  const resolvedContent = resolveTagContent(tag.type, tag.content, monsterCtx);
  const displayText = config.format(resolvedContent);
  const iconSvg = lucideIcon(config.iconName);
  const title = escapeHtml(displayText);

  return (
    `<span class="archivist-stat-tag ${config.cssClass}" title="${title}">` +
    `<span class="archivist-stat-tag-icon">${iconSvg}</span>` +
    `<span>${escapeHtml(displayText)}</span>` +
    "</span>"
  );
}

// ---------------------------------------------------------------------------
// Inline Tag Text Renderer
// ---------------------------------------------------------------------------

/**
 * Render text that may contain inline tags like `roll:2d6+3` or `dc:15`.
 * Converts 5etools tags first, then processes backtick tags.
 * Returns an HTML string.
 */
export function renderTextWithInlineTags(
  text: string,
  statBlockMode = true,
  monsterCtx?: MonsterFormulaContext,
): string {
  // Convert any 5etools {@...} tags to backtick format before processing
  const converted = convert5eToolsTags(text);

  // Match backtick-wrapped tags: `type:content`
  const regex = /`([^`]+)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let result = "";

  while ((match = regex.exec(converted)) !== null) {
    // Append any plain text (with markdown) before this match
    if (match.index > lastIndex) {
      result += appendMarkdownText(converted.slice(lastIndex, match.index));
    }

    const tagText = match[1];
    const parsed = parseInlineTag(tagText);
    if (parsed) {
      if (statBlockMode) {
        result += renderStatBlockTag(parsed, monsterCtx);
      } else {
        // Outside stat blocks, render as a simple code tag
        result += `<code>${escapeHtml(tagText)}</code>`;
      }
    } else {
      // Not a valid tag, render as code
      result += `<code>${escapeHtml(tagText)}</code>`;
    }

    lastIndex = regex.lastIndex;
  }

  // Append any remaining plain text (with markdown)
  if (lastIndex < converted.length) {
    result += appendMarkdownText(converted.slice(lastIndex));
  }

  return result;
}

// ---------------------------------------------------------------------------
// Error Block
// ---------------------------------------------------------------------------

export function renderErrorBlock(message: string): string {
  const iconSvg = lucideIcon("alert-triangle");
  return (
    '<div class="archivist-error-block">' +
    '<div class="archivist-error-banner">' +
    `<span class="archivist-error-icon">${iconSvg}</span>` +
    `<span>${escapeHtml(message)}</span>` +
    "</div></div>"
  );
}
