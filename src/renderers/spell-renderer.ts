import type { Spell } from "../types/spell";
import {
  el,
  escapeHtml,
  createIconProperty,
  renderTextWithInlineTags,
  lucideIcon,
} from "./renderer-utils";

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

function getSpellHeader(spell: Spell): string {
  const level = spell.level ?? 0;
  const school = spell.school ?? "Unknown";
  if (level === 0) {
    return `${school} cantrip`;
  }
  const ordinal =
    level === 1 ? "1st" : level === 2 ? "2nd" : level === 3 ? "3rd" : `${level}th`;
  return `${ordinal}-level ${school.toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Exported: renderSpellBlock
// ---------------------------------------------------------------------------

export function renderSpellBlock(spell: Spell): string {
  // 1. Header
  const header = el("div", "spell-block-header", [
    el("h3", "spell-name", escapeHtml(spell.name)),
    el("div", "spell-school", escapeHtml(getSpellHeader(spell))),
  ]);

  // 2. Properties with icons
  const propParts: string[] = [];
  if (spell.casting_time)
    propParts.push(createIconProperty("clock", "Casting Time:", spell.casting_time));
  if (spell.range)
    propParts.push(createIconProperty("target", "Range:", spell.range));
  if (spell.components)
    propParts.push(createIconProperty("box", "Components:", spell.components));
  if (spell.duration)
    propParts.push(createIconProperty("sparkles", "Duration:", spell.duration));
  const props = el("div", "spell-properties", propParts);

  // 3. Description
  let descHtml = "";
  if (spell.description && spell.description.length > 0) {
    const paragraphs = spell.description.map((p) =>
      el("div", "description-paragraph", renderTextWithInlineTags(p)),
    );
    descHtml = el("div", "spell-description", paragraphs);
  }

  // 4. At Higher Levels
  let higherHtml = "";
  if (spell.at_higher_levels && spell.at_higher_levels.length > 0) {
    const higherParts = [
      el("div", "higher-levels-header", "At Higher Levels."),
      ...spell.at_higher_levels.map((t) =>
        el("div", "description-paragraph", renderTextWithInlineTags(t)),
      ),
    ];
    higherHtml = el("div", "spell-higher-levels", higherParts);
  }

  // 5. Classes
  let classesHtml = "";
  if (spell.classes && spell.classes.length > 0) {
    const formatted = spell.classes
      .map((c) => c.charAt(0).toUpperCase() + c.slice(1).toLowerCase())
      .join(", ");
    classesHtml = el("div", "spell-classes", [
      `<span class="archivist-property-icon">${lucideIcon("book-open")}</span>`,
      el("span", "classes-list", escapeHtml(formatted)),
    ]);
  }

  // 6. Tags (concentration, ritual)
  const tagParts: string[] = [];
  if (spell.concentration) {
    tagParts.push(el("span", "spell-tag concentration", "Concentration"));
  }
  if (spell.ritual) {
    tagParts.push(el("span", "spell-tag ritual", "Ritual"));
  }
  const tagsHtml = tagParts.length > 0 ? el("div", "spell-tags", tagParts) : "";

  // Assemble block
  const blockContent = [header, props, descHtml, higherHtml, classesHtml, tagsHtml].filter(
    Boolean,
  );
  const block = el("div", "archivist-spell-block", blockContent);
  return el("div", "archivist-spell-block-wrapper", block);
}
