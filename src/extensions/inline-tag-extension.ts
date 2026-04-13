import { parseInlineTag } from "../parsers/inline-tag-parser";
import { renderInlineTag } from "../renderers/inline-tag-renderer";

// ---------------------------------------------------------------------------
// Testable range finder (no CM6 dependency)
// ---------------------------------------------------------------------------

export interface InlineTagRange {
  from: number;
  to: number;
  tagText: string;
}

/**
 * Scan text for backtick-delimited inline tags and return their positions.
 * `offset` is added to all positions (for use with visible ranges).
 */
export function findInlineTagRanges(text: string, offset: number): InlineTagRange[] {
  const ranges: InlineTagRange[] = [];
  const regex = /`([^`]+)`/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const content = match[1];
    const parsed = parseInlineTag(content);
    if (parsed) {
      ranges.push({
        from: offset + match.index,
        to: offset + match.index + match[0].length,
        tagText: content,
      });
    }
  }

  return ranges;
}

// ---------------------------------------------------------------------------
// CM6 Widget & Plugin (constructed at runtime from host CM6 module)
// ---------------------------------------------------------------------------

/**
 * Factory that receives the host CM6 module and returns an Extension.
 * The CM6 types (ViewPlugin, Decoration, WidgetType, EditorView) come from
 * the host Logseq instance -- we cannot import them at build time.
 */
export function createInlineTagExtension(cm: any): any {
  const { ViewPlugin, Decoration, WidgetType } = cm;

  class InlineTagWidget extends WidgetType {
    constructor(private tagText: string) {
      super();
    }

    toDOM(): HTMLElement {
      const parsed = parseInlineTag(this.tagText);
      const wrapper = document.createElement("span");
      wrapper.className = "archivist-inline-tag-widget";
      // Safe: renderInlineTag escapes all user content via escapeHtml.
      // Defensive: parsed is always non-null here (findInlineTagRanges pre-filters),
      // but we guard anyway to prevent blank widgets if the invariant is broken.
      if (parsed) {
        wrapper.innerHTML = renderInlineTag(parsed);
      } else {
        const code = document.createElement("code");
        code.textContent = this.tagText;
        wrapper.appendChild(code);
      }
      return wrapper;
    }

    eq(other: InlineTagWidget): boolean {
      return this.tagText === other.tagText;
    }

    ignoreEvent(): boolean {
      return true;
    }
  }

  function buildDecorations(view: any): any {
    const decorations: Array<{ from: number; to: number; deco: any }> = [];
    const cursorPos = view.state.selection.main.head;

    for (const { from, to } of view.visibleRanges) {
      const text = view.state.doc.sliceString(from, to);
      const ranges = findInlineTagRanges(text, from);

      for (const range of ranges) {
        // Skip when cursor is inside the tag (let user edit raw text)
        if (cursorPos > range.from && cursorPos < range.to) continue;

        decorations.push({
          from: range.from,
          to: range.to,
          deco: Decoration.replace({
            widget: new InlineTagWidget(range.tagText),
          }),
        });
      }
    }

    // Sort by from position (required by CM6)
    decorations.sort((a, b) => a.from - b.from);

    if (decorations.length === 0) return Decoration.none;
    return Decoration.set(
      decorations.map((d) => d.deco.range(d.from, d.to)),
    );
  }

  return ViewPlugin.fromClass(
    class {
      decorations: any;

      constructor(view: any) {
        this.decorations = buildDecorations(view);
      }

      update(update: any) {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = buildDecorations(update.view);
        }
      }
    },
    {
      decorations: (v: any) => v.decorations,
    },
  );
}
