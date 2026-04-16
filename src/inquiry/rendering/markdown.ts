import MarkdownIt from 'markdown-it';

// Configured markdown-it instance
const md = new MarkdownIt({
  html: false,      // Don't allow raw HTML
  linkify: true,    // Auto-detect URLs
  typographer: false,
});

// Custom fence rule for D&D code fences (monster, spell, item)
// Wrap in <div class="archivist-dnd-fence" data-lang="monster|spell|item">
// so DndEntityRenderer can post-process them
const dndLanguages = new Set(['monster', 'spell', 'item']);

// Override the fence renderer
const defaultFenceRenderer = md.renderer.rules.fence;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const lang = token.info.trim().toLowerCase();

  if (dndLanguages.has(lang)) {
    const content = md.utils.escapeHtml(token.content);
    return `<div class="archivist-dnd-fence" data-lang="${lang}"><pre><code>${content}</code></pre></div>`;
  }

  // Default fence rendering for other languages
  if (defaultFenceRenderer) {
    return defaultFenceRenderer(tokens, idx, options, env, self);
  }
  return self.renderToken(tokens, idx, options);
};

// Custom inline rule for [[wikilink]] -> clickable page link
// Renders as: <a class="archivist-page-link" data-page="PageName">PageName</a>
md.inline.ruler.push('wikilink', (state, silent) => {
  const src = state.src;
  const pos = state.pos;

  if (src.charCodeAt(pos) !== 0x5B || src.charCodeAt(pos + 1) !== 0x5B) return false; // [[

  const closePos = src.indexOf(']]', pos + 2);
  if (closePos === -1) return false;

  if (!silent) {
    const pageName = src.slice(pos + 2, closePos).trim();
    const token = state.push('wikilink', 'a', 0);
    token.content = pageName;
  }

  state.pos = closePos + 2;
  return true;
});

md.renderer.rules.wikilink = (tokens, idx) => {
  const pageName = tokens[idx].content;
  const escaped = md.utils.escapeHtml(pageName);
  return `<a class="archivist-page-link" data-page="${escaped}">${escaped}</a>`;
};

/** Render markdown source to HTML string */
export function renderMarkdown(source: string): string {
  return md.render(source);
}

/** Render markdown into a DOM element, wiring page link click handlers */
export function renderMarkdownToEl(
  doc: Document,
  el: HTMLElement,
  source: string,
  onPageClick?: (pageName: string) => void,
): void {
  // markdown-it is configured with html:false, so raw HTML tags are escaped.
  // Content is sanitized markdown output, not raw user HTML.
  el.innerHTML = renderMarkdown(source);

  // Wire up page link click handlers
  if (onPageClick) {
    const links = el.querySelectorAll('.archivist-page-link');
    for (const link of links) {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const page = (link as HTMLElement).dataset.page;
        if (page) onPageClick(page);
      });
    }
  }
}
