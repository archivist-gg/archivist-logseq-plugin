import { parseInlineTag } from "../parsers/inline-tag-parser";
import { renderInlineTag } from "../renderers/inline-tag-renderer";
import { isRollable, extractDiceNotation } from "../renderers/renderer-utils";
import { rollDice } from "../dice/roll";

/**
 * Scan a container for <code> elements whose text matches an inline tag
 * pattern and replace them with styled pill widgets.
 *
 * Logseq renders backtick inline code as <code>dice:2d6</code> in read mode.
 * Since there's no plugin API to intercept this rendering, we post-process
 * the DOM after Logseq has rendered blocks.
 */
function processCodeElements(root: Element | Document): void {
  const codeElements = root.querySelectorAll("code:not([data-archivist-tag])");

  for (const code of codeElements) {
    const text = code.textContent?.trim();
    if (!text) continue;

    const parsed = parseInlineTag(text);
    if (!parsed) continue;

    // Mark as processed to avoid re-processing
    code.setAttribute("data-archivist-tag", "true");

    // Replace the <code> element with the rendered pill
    const wrapper = code.ownerDocument.createElement("span");
    wrapper.className = "archivist-inline-tag-widget";
    // Safe: renderInlineTag escapes all user content via escapeHtml
    wrapper.insertAdjacentHTML("afterbegin", renderInlineTag(parsed));

    // Wire click-to-roll on rollable pills
    if (isRollable(parsed.type)) {
      const notation = extractDiceNotation(parsed);
      if (notation) {
        const pill = wrapper.querySelector(".archivist-stat-tag") as HTMLElement;
        if (pill) {
          pill.style.cursor = "pointer";
          pill.addEventListener("click", (e: Event) => {
            e.stopPropagation();
            e.preventDefault();
            rollDice(notation);
          });
        }
      }
    }

    code.replaceWith(wrapper);
  }
}

/**
 * Set up a MutationObserver on the Logseq app container to automatically
 * process inline tags as blocks are rendered/re-rendered.
 *
 * Must be called with the host document (Logseq's main frame).
 * Returns a cleanup function to disconnect the observer.
 */
export function startInlineTagObserver(hostDocument: Document): () => void {
  const appContainer =
    hostDocument.getElementById("app-container") ||
    hostDocument.getElementById("main-content-container") ||
    hostDocument.body;

  // Initial scan of all existing content
  processCodeElements(appContainer);

  // Debounced re-scan: when Logseq re-renders a block after editing,
  // it replaces the entire block DOM. We debounce to batch mutations.
  let scanTimer: ReturnType<typeof setTimeout> | null = null;

  const observer = new MutationObserver(() => {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      processCodeElements(appContainer);
    }, 100);
  });

  observer.observe(appContainer, {
    childList: true,
    subtree: true,
  });

  return () => {
    if (scanTimer) clearTimeout(scanTimer);
    observer.disconnect();
  };
}
