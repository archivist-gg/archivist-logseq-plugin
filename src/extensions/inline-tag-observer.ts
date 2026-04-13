import { parseInlineTag } from "../parsers/inline-tag-parser";
import { renderInlineTag } from "../renderers/inline-tag-renderer";

const PROCESSED_ATTR = "data-archivist-tag";

/**
 * Scan a container for <code> elements whose text matches an inline tag
 * pattern and replace them with styled pill widgets.
 *
 * Logseq renders backtick inline code as <code>dice:2d6</code> in read mode.
 * Since there's no plugin API to intercept this rendering, we post-process
 * the DOM after Logseq has rendered blocks.
 */
function processCodeElements(root: Element): void {
  const codeElements = root.querySelectorAll("code:not([data-archivist-tag])");

  for (const code of codeElements) {
    const text = code.textContent?.trim();
    if (!text) continue;

    const parsed = parseInlineTag(text);
    if (!parsed) continue;

    // Mark as processed to avoid re-processing
    code.setAttribute(PROCESSED_ATTR, "true");

    // Replace the <code> element with the rendered pill
    const wrapper = document.createElement("span");
    wrapper.className = "archivist-inline-tag-widget";
    // Safe: renderInlineTag escapes all user content via escapeHtml
    wrapper.insertAdjacentHTML("afterbegin", renderInlineTag(parsed));

    code.replaceWith(wrapper);
  }
}

/**
 * Set up a MutationObserver on the Logseq app container to automatically
 * process inline tags as blocks are rendered/re-rendered.
 *
 * Must be called from the host scope (not the plugin iframe).
 * Returns a cleanup function to disconnect the observer.
 */
export function startInlineTagObserver(hostDocument: Document): () => void {
  const appContainer =
    hostDocument.getElementById("app-container") ||
    hostDocument.getElementById("main-content-container") ||
    hostDocument.body;

  // Initial scan
  processCodeElements(appContainer);

  // Observe for new content
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof Element) {
          processCodeElements(node);
        }
      }
    }
  });

  observer.observe(appContainer, {
    childList: true,
    subtree: true,
  });

  return () => observer.disconnect();
}
