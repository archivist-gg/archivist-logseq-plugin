import "@logseq/libs";
import { parseMonster } from "./parsers/monster-parser";
import { parseSpell } from "./parsers/spell-parser";
import { parseItem } from "./parsers/item-parser";
import {
  renderMonsterBlock,
  initMonsterTabs,
} from "./renderers/monster-renderer";
import { renderSpellBlock } from "./renderers/spell-renderer";
import { renderItemBlock } from "./renderers/item-renderer";
import { renderErrorBlock } from "./renderers/renderer-utils";
import css from "./styles/archivist-dnd.css?raw";

type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * Creates a fenced code renderer for Logseq's Experiments API.
 *
 * The `render` callback is a React functional component that receives
 * `{ content }` props from Logseq. It uses the host React instance
 * (logseq.Experiments.React) with useRef + useEffect to parse YAML
 * and inject rendered HTML into the DOM.
 *
 * Note: innerHTML is used intentionally here -- the HTML comes from our own
 * renderer pipeline (parser -> type -> renderer), not from untrusted input.
 */
function createBlockRenderer(
  parser: (source: string) => ParseResult<any>,
  renderer: (data: any, columns?: number) => string,
  postRender?: (container: HTMLElement) => void,
) {
  return (props: { content: string }) => {
    const React = logseq.Experiments.React! as any;
    const containerRef = React.useRef(null) as { current: HTMLDivElement | null };

    React.useEffect(() => {
      if (!containerRef.current) return;
      const result = parser(props.content);
      if (result.success) {
        const columns = result.data.columns ?? 1;
        // Safe: HTML is produced by our own renderer from parsed YAML data
        containerRef.current.innerHTML = renderer(result.data, columns);
        if (postRender) postRender(containerRef.current);
      } else {
        // Safe: renderErrorBlock escapes user input via escapeHtml
        containerRef.current.innerHTML = renderErrorBlock(result.error);
      }
    }, [props.content]);

    return React.createElement("div", {
      ref: containerRef,
      className: "archivist-block",
    });
  };
}

async function main() {
  // Inject parchment CSS
  logseq.provideStyle(css);

  // Register fenced code block renderers
  logseq.Experiments.registerFencedCodeRenderer("monster", {
    render: createBlockRenderer(
      parseMonster,
      renderMonsterBlock,
      initMonsterTabs,
    ),
  });

  logseq.Experiments.registerFencedCodeRenderer("spell", {
    render: createBlockRenderer(parseSpell, renderSpellBlock),
  });

  logseq.Experiments.registerFencedCodeRenderer("item", {
    render: createBlockRenderer(parseItem, renderItemBlock),
  });

  // Slash commands for quick templates
  logseq.Editor.registerSlashCommand("Monster Block", async () => {
    await logseq.Editor.insertAtEditingCursor(`\`\`\`monster
name: Monster Name
size: Medium
type: humanoid
alignment: neutral
cr: "1"
ac:
  - ac: 13
hp:
  average: 22
  formula: 4d8+4
speed:
  walk: 30
abilities:
  str: 14
  dex: 12
  con: 13
  int: 10
  wis: 11
  cha: 10
\`\`\``);
  });

  logseq.Editor.registerSlashCommand("Spell Block", async () => {
    await logseq.Editor.insertAtEditingCursor(`\`\`\`spell
name: Spell Name
level: 1
school: evocation
casting_time: 1 action
range: 60 feet
components: V, S
duration: Instantaneous
description:
  - "Spell description here."
\`\`\``);
  });

  logseq.Editor.registerSlashCommand("Item Block", async () => {
    await logseq.Editor.insertAtEditingCursor(`\`\`\`item
name: Item Name
type: wondrous item
rarity: uncommon
attunement: true
entries:
  - "Item description here."
\`\`\``);
  });

  console.log("Archivist TTRPG Blocks loaded");
}

logseq.ready(main).catch(console.error);
