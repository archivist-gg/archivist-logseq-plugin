# Logseq Port Phase 1: Core Stat Block Rendering -- Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render D&D 5e monster, spell, and item stat blocks from YAML fenced code blocks in Logseq, visually identical to the Obsidian plugin.

**Architecture:** Logseq plugin using `registerFencedCodeRenderer` API. YAML is parsed by portable parsers (copied from Obsidian), rendered to HTML strings by new renderers, injected into the DOM via React wrapper components using the host React instance. CSS adapted from the Obsidian version.

**Tech Stack:** TypeScript, Vite + `vite-plugin-logseq`, `@logseq/libs`, `js-yaml`, host React via `logseq.Experiments.React`

**Source project:** `~/w/archivist-obsidian` (the Obsidian plugin being ported)
**Target project:** `~/w/archivist-logseq` (this project)

---

## File Structure

```
~/w/archivist-logseq/
  package.json                          # CREATE - logseq plugin manifest + vite build
  tsconfig.json                         # CREATE - path aliases, ES2020 target
  vite.config.ts                        # CREATE - vite + vite-plugin-logseq + aliases
  index.html                            # CREATE - plugin iframe shell
  src/
    index.ts                            # CREATE - entry: logseq.ready(), renderers, slash commands
    react-shim.ts                       # CREATE - documents host React usage

    renderers/
      renderer-utils.ts                 # CREATE - el() HTML builder, escapeHtml, SVG bars, icons, inline tag text
      monster-renderer.ts               # CREATE - renderMonsterBlock() -> string
      spell-renderer.ts                 # CREATE - renderSpellBlock() -> string
      item-renderer.ts                  # CREATE - renderItemBlock() -> string
      inline-tag-renderer.ts            # CREATE - renderInlineTag() -> string

    parsers/
      yaml-utils.ts                     # COPY from archivist-obsidian/src/parsers/yaml-utils.ts
      monster-parser.ts                 # COPY from archivist-obsidian/src/parsers/monster-parser.ts
      spell-parser.ts                   # COPY from archivist-obsidian/src/parsers/spell-parser.ts
      item-parser.ts                    # COPY from archivist-obsidian/src/parsers/item-parser.ts
      inline-tag-parser.ts              # COPY from archivist-obsidian/src/parsers/inline-tag-parser.ts

    types/
      monster.ts                        # COPY from archivist-obsidian/src/types/monster.ts
      spell.ts                          # COPY from archivist-obsidian/src/types/spell.ts
      item.ts                           # COPY from archivist-obsidian/src/types/item.ts
      settings.ts                       # COPY from archivist-obsidian/src/types/settings.ts

    dnd/
      constants.ts                      # COPY from archivist-obsidian/src/dnd/constants.ts
      math.ts                           # COPY from archivist-obsidian/src/dnd/math.ts
      formula-tags.ts                   # COPY from archivist-obsidian/src/dnd/formula-tags.ts
      editable-monster.ts               # COPY from archivist-obsidian/src/dnd/editable-monster.ts
      recalculate.ts                    # COPY from archivist-obsidian/src/dnd/recalculate.ts
      yaml-serializer.ts               # COPY from archivist-obsidian/src/dnd/yaml-serializer.ts

    styles/
      archivist-dnd.css                 # CREATE (adapted from archivist-obsidian/src/styles/archivist-dnd.css)

  tests/
    renderers/
      renderer-utils.test.ts            # CREATE - test el(), escapeHtml, SVG bar, inline tags
      monster-renderer.test.ts          # CREATE - test monster HTML output
      spell-renderer.test.ts            # CREATE - test spell HTML output
      item-renderer.test.ts             # CREATE - test item HTML output
      inline-tag-renderer.test.ts       # CREATE - test tag pill HTML output
    parsers/
      parsers.test.ts                   # CREATE - verify copied parsers work in new project
```

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/react-shim.ts`
- Create: `.gitignore`

- [ ] **Step 1: Create package.json**

Create `~/w/archivist-logseq/package.json`:

```json
{
  "name": "logseq-plugin-archivist",
  "version": "0.1.0",
  "description": "D&D 5e stat blocks, spells, and magic items for Logseq",
  "main": "dist/index.html",
  "logseq": {
    "id": "archivist-ttrpg",
    "title": "Archivist TTRPG Blocks",
    "icon": "icon.png"
  },
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@logseq/libs": "^0.0.17",
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "vite-plugin-logseq": "^1.1.2",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

Create `~/w/archivist-logseq/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "strict": true,
    "strictNullChecks": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": false,
    "outDir": "dist",
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src/**/*", "tests/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create vite.config.ts**

Create `~/w/archivist-logseq/vite.config.ts`:

```typescript
import { defineConfig } from "vite";
import logseqPlugin from "vite-plugin-logseq";
import { resolve } from "path";

export default defineConfig({
  plugins: [logseqPlugin()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    target: "es2020",
    minify: "esbuild",
  },
});
```

- [ ] **Step 4: Create index.html**

Create `~/w/archivist-logseq/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Archivist TTRPG Blocks</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/index.ts"></script>
  </body>
</html>
```

- [ ] **Step 5: Create react-shim.ts**

Create `~/w/archivist-logseq/src/react-shim.ts`:

```typescript
// Logseq's registerFencedCodeRenderer requires React components.
// We must use the host's React instance, not a bundled one.
// Access via: const React = logseq.Experiments.React
// This file exists as documentation and for potential future aliasing.
export {};
```

- [ ] **Step 6: Create .gitignore**

Create `~/w/archivist-logseq/.gitignore`:

```
node_modules/
dist/
*.js.map
.DS_Store
```

- [ ] **Step 7: Install dependencies**

```bash
cd ~/w/archivist-logseq && npm install
```

- [ ] **Step 8: Commit**

```bash
cd ~/w/archivist-logseq
git add package.json tsconfig.json vite.config.ts index.html src/react-shim.ts .gitignore
git commit -m "feat: scaffold Logseq plugin project with Vite + TypeScript"
```

---

## Task 2: Copy Portable Layer (Types, Parsers, D&D Math)

**Files:**
- Copy 15 files from `~/w/archivist-obsidian/src/` to `~/w/archivist-logseq/src/`

- [ ] **Step 1: Create directories and copy all files**

```bash
mkdir -p ~/w/archivist-logseq/src/{types,parsers,dnd}

cp ~/w/archivist-obsidian/src/types/monster.ts ~/w/archivist-logseq/src/types/
cp ~/w/archivist-obsidian/src/types/spell.ts ~/w/archivist-logseq/src/types/
cp ~/w/archivist-obsidian/src/types/item.ts ~/w/archivist-logseq/src/types/
cp ~/w/archivist-obsidian/src/types/settings.ts ~/w/archivist-logseq/src/types/

cp ~/w/archivist-obsidian/src/parsers/yaml-utils.ts ~/w/archivist-logseq/src/parsers/
cp ~/w/archivist-obsidian/src/parsers/monster-parser.ts ~/w/archivist-logseq/src/parsers/
cp ~/w/archivist-obsidian/src/parsers/spell-parser.ts ~/w/archivist-logseq/src/parsers/
cp ~/w/archivist-obsidian/src/parsers/item-parser.ts ~/w/archivist-logseq/src/parsers/
cp ~/w/archivist-obsidian/src/parsers/inline-tag-parser.ts ~/w/archivist-logseq/src/parsers/

cp ~/w/archivist-obsidian/src/dnd/constants.ts ~/w/archivist-logseq/src/dnd/
cp ~/w/archivist-obsidian/src/dnd/math.ts ~/w/archivist-logseq/src/dnd/
cp ~/w/archivist-obsidian/src/dnd/formula-tags.ts ~/w/archivist-logseq/src/dnd/
cp ~/w/archivist-obsidian/src/dnd/editable-monster.ts ~/w/archivist-logseq/src/dnd/
cp ~/w/archivist-obsidian/src/dnd/recalculate.ts ~/w/archivist-logseq/src/dnd/
cp ~/w/archivist-obsidian/src/dnd/yaml-serializer.ts ~/w/archivist-logseq/src/dnd/
```

- [ ] **Step 2: Verify no obsidian imports leaked in**

```bash
cd ~/w/archivist-logseq && grep -r "from.*obsidian" src/types/ src/parsers/ src/dnd/
```

Expected: no output (zero matches).

- [ ] **Step 3: Commit**

```bash
cd ~/w/archivist-logseq
git add src/types/ src/parsers/ src/dnd/
git commit -m "feat: copy portable layer from archivist-obsidian (types, parsers, dnd math)"
```

---

## Task 3: Test Setup and Parser Verification

**Files:**
- Create: `vitest.config.ts`
- Create: `tests/parsers/parsers.test.ts`

- [ ] **Step 1: Create vitest config**

Create `~/w/archivist-logseq/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  test: {
    globals: true,
  },
});
```

- [ ] **Step 2: Write parser verification tests**

Create `~/w/archivist-logseq/tests/parsers/parsers.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseMonster } from "@/parsers/monster-parser";
import { parseSpell } from "@/parsers/spell-parser";
import { parseItem } from "@/parsers/item-parser";
import { parseInlineTag } from "@/parsers/inline-tag-parser";
import { abilityModifier, formatModifier } from "@/parsers/yaml-utils";

describe("parseMonster", () => {
  it("parses a minimal monster", () => {
    const result = parseMonster("name: Goblin");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Goblin");
    }
  });

  it("parses a full monster with all fields", () => {
    const yaml = `
name: Adult Red Dragon
size: Huge
type: dragon
alignment: chaotic evil
cr: "17"
ac:
  - ac: 19
    from:
      - natural armor
hp:
  average: 256
  formula: 19d12+133
speed:
  walk: 40
  fly: 80
  climb: 40
abilities:
  str: 27
  dex: 10
  con: 25
  int: 16
  wis: 13
  cha: 21
saves:
  dex: 6
  con: 13
  wis: 7
  cha: 11
skills:
  perception: 13
  stealth: 6
senses:
  - blindsight 60 ft.
  - darkvision 120 ft.
passive_perception: 23
languages:
  - Common
  - Draconic
damage_immunities:
  - fire
condition_immunities:
  - frightened
traits:
  - name: Legendary Resistance (3/Day)
    entries:
      - "If the dragon fails a saving throw, it can choose to succeed instead."
actions:
  - name: Multiattack
    entries:
      - "The dragon makes three attacks: one with its bite and two with its claws."
legendary:
  - name: Detect
    entries:
      - "The dragon makes a Wisdom (Perception) check."
legendary_actions: 3
legendary_resistance: 3
columns: 2
`;
    const result = parseMonster(yaml);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const m = result.data;
    expect(m.name).toBe("Adult Red Dragon");
    expect(m.size).toBe("Huge");
    expect(m.cr).toBe("17");
    expect(m.ac?.[0].ac).toBe(19);
    expect(m.hp?.average).toBe(256);
    expect(m.speed?.fly).toBe(80);
    expect(m.abilities?.str).toBe(27);
    expect(m.saves?.con).toBe(13);
    expect(m.damage_immunities).toEqual(["fire"]);
    expect(m.traits).toHaveLength(1);
    expect(m.actions).toHaveLength(1);
    expect(m.legendary).toHaveLength(1);
    expect(m.columns).toBe(2);
  });

  it("fails on missing name", () => {
    const result = parseMonster("size: Medium");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("name");
    }
  });
});

describe("parseSpell", () => {
  it("parses a full spell", () => {
    const yaml = `
name: Fireball
level: 3
school: evocation
casting_time: 1 action
range: 150 feet
components: V, S, M (a tiny ball of bat guano and sulfur)
duration: Instantaneous
classes:
  - sorcerer
  - wizard
description:
  - "A bright streak flashes from your pointing finger."
at_higher_levels:
  - "The damage increases by 1d6 for each slot level above 3rd."
`;
    const result = parseSpell(yaml);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.name).toBe("Fireball");
    expect(result.data.level).toBe(3);
    expect(result.data.classes).toEqual(["sorcerer", "wizard"]);
  });
});

describe("parseItem", () => {
  it("parses a full item", () => {
    const yaml = `
name: Flame Tongue
type: weapon (any sword)
rarity: rare
attunement: true
damage: 2d6
damage_type: fire
entries:
  - "While ablaze, it deals an extra 2d6 fire damage."
`;
    const result = parseItem(yaml);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.name).toBe("Flame Tongue");
    expect(result.data.attunement).toBe(true);
    expect(result.data.damage).toBe("2d6");
  });
});

describe("parseInlineTag", () => {
  it("parses dice tag", () => {
    const tag = parseInlineTag("dice:2d6+3");
    expect(tag).not.toBeNull();
    expect(tag!.type).toBe("dice");
    expect(tag!.content).toBe("2d6+3");
  });

  it("parses atk tag", () => {
    const tag = parseInlineTag("atk:+7");
    expect(tag!.type).toBe("atk");
    expect(tag!.content).toBe("+7");
  });

  it("parses dc tag", () => {
    const tag = parseInlineTag("dc:15");
    expect(tag!.type).toBe("dc");
  });

  it("aliases roll to dice", () => {
    const tag = parseInlineTag("roll:1d20");
    expect(tag!.type).toBe("dice");
  });

  it("returns null for invalid tags", () => {
    expect(parseInlineTag("hello world")).toBeNull();
    expect(parseInlineTag("unknown:value")).toBeNull();
    expect(parseInlineTag("dice:")).toBeNull();
  });
});

describe("abilityModifier", () => {
  it("calculates modifiers correctly", () => {
    expect(abilityModifier(10)).toBe(0);
    expect(abilityModifier(20)).toBe(5);
    expect(abilityModifier(8)).toBe(-1);
    expect(abilityModifier(1)).toBe(-5);
  });
});

describe("formatModifier", () => {
  it("formats with sign", () => {
    expect(formatModifier(0)).toBe("+0");
    expect(formatModifier(5)).toBe("+5");
    expect(formatModifier(-1)).toBe("-1");
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd ~/w/archivist-logseq && npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
cd ~/w/archivist-logseq
git add vitest.config.ts tests/
git commit -m "test: add parser and math verification tests"
```

---

## Task 4: Inline Tag Renderer

**Files:**
- Create: `src/renderers/inline-tag-renderer.ts`
- Create: `tests/renderers/inline-tag-renderer.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `~/w/archivist-logseq/tests/renderers/inline-tag-renderer.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { renderInlineTag } from "@/renderers/inline-tag-renderer";

describe("renderInlineTag", () => {
  it("renders a dice tag", () => {
    const html = renderInlineTag({ type: "dice", content: "2d6+3", formula: null });
    expect(html).toContain("archivist-stat-tag");
    expect(html).toContain("archivist-stat-tag-dice");
    expect(html).toContain("2d6+3");
  });

  it("renders an atk tag with 'to hit' format", () => {
    const html = renderInlineTag({ type: "atk", content: "+7", formula: null });
    expect(html).toContain("archivist-stat-tag-atk");
    expect(html).toContain("+7 to hit");
  });

  it("renders a dc tag with 'DC' prefix", () => {
    const html = renderInlineTag({ type: "dc", content: "15", formula: null });
    expect(html).toContain("archivist-stat-tag-dc");
    expect(html).toContain("DC 15");
  });

  it("renders a damage tag", () => {
    const html = renderInlineTag({ type: "damage", content: "3d8+4", formula: null });
    expect(html).toContain("archivist-stat-tag-damage");
    expect(html).toContain("3d8+4");
  });

  it("renders a mod tag", () => {
    const html = renderInlineTag({ type: "mod", content: "+5", formula: null });
    expect(html).toContain("archivist-stat-tag-dice");
    expect(html).toContain("+5");
  });

  it("renders a check tag", () => {
    const html = renderInlineTag({ type: "check", content: "Perception", formula: null });
    expect(html).toContain("archivist-stat-tag-dc");
    expect(html).toContain("Perception");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/w/archivist-logseq && npx vitest run tests/renderers/inline-tag-renderer.test.ts 2>&1 | tail -5
```

Expected: FAIL -- module not found.

- [ ] **Step 3: Write inline-tag-renderer.ts**

Create `~/w/archivist-logseq/src/renderers/inline-tag-renderer.ts`:

```typescript
import type { InlineTag, InlineTagType } from "../parsers/inline-tag-parser";
import { escapeHtml, lucideIcon } from "./renderer-utils";

interface InlineTagConfig {
  iconName: string;
  cssClass: string;
  format: (content: string) => string;
}

const INLINE_TAG_CONFIGS: Record<InlineTagType, InlineTagConfig> = {
  dice: { iconName: "dices", cssClass: "archivist-stat-tag-dice", format: (c) => c },
  roll: { iconName: "dices", cssClass: "archivist-stat-tag-dice", format: (c) => c },
  d: { iconName: "dices", cssClass: "archivist-stat-tag-dice", format: (c) => c },
  damage: { iconName: "dices", cssClass: "archivist-stat-tag-damage", format: (c) => c },
  dc: { iconName: "shield", cssClass: "archivist-stat-tag-dc", format: (c) => `DC ${c}` },
  atk: { iconName: "swords", cssClass: "archivist-stat-tag-atk", format: (c) => `${c} to hit` },
  mod: { iconName: "dices", cssClass: "archivist-stat-tag-dice", format: (c) => c },
  check: { iconName: "shield", cssClass: "archivist-stat-tag-dc", format: (c) => c },
};

export function renderInlineTag(tag: InlineTag): string {
  const config = INLINE_TAG_CONFIGS[tag.type];
  const displayText = config.format(tag.content);

  return [
    `<span class="archivist-stat-tag ${config.cssClass}" title="${escapeHtml(displayText)}">`,
    `<span class="archivist-stat-tag-icon">${lucideIcon(config.iconName)}</span>`,
    `<span>${escapeHtml(displayText)}</span>`,
    `</span>`,
  ].join("");
}
```

Note: `inline-tag-renderer.ts` imports `escapeHtml` and `lucideIcon` from `renderer-utils.ts`. These functions must exist before this file compiles. Task 5 creates `renderer-utils.ts`. **Implementation order: create `renderer-utils.ts` first (Task 5), then this file.** The test tasks are numbered for logical grouping, but the actual build dependency is: Task 5 renderer-utils -> Task 4 inline-tag-renderer -> Task 6/7/8 block renderers.

- [ ] **Step 4: Run tests**

```bash
cd ~/w/archivist-logseq && npx vitest run tests/renderers/inline-tag-renderer.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/w/archivist-logseq
git add src/renderers/inline-tag-renderer.ts tests/renderers/inline-tag-renderer.test.ts
git commit -m "feat: add inline tag renderer (HTML string output)"
```

---

## Task 5: Renderer Utilities

**Files:**
- Create: `src/renderers/renderer-utils.ts`
- Create: `tests/renderers/renderer-utils.test.ts`

**Build dependency:** This task MUST be completed before Task 4. The inline-tag-renderer and all block renderers import from this file.

- [ ] **Step 1: Write the failing tests**

Create `~/w/archivist-logseq/tests/renderers/renderer-utils.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  el,
  escapeHtml,
  createSvgBar,
  createPropertyLine,
  renderTextWithInlineTags,
  convert5eToolsTags,
  appendMarkdownText,
  renderErrorBlock,
  lucideIcon,
} from "@/renderers/renderer-utils";

describe("escapeHtml", () => {
  it("escapes dangerous characters", () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"
    );
  });

  it("escapes ampersands", () => {
    expect(escapeHtml("A & B")).toBe("A &amp; B");
  });

  it("escapes single quotes", () => {
    expect(escapeHtml("it's")).toBe("it&#39;s");
  });

  it("passes through safe strings", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });
});

describe("el", () => {
  it("creates a simple element", () => {
    expect(el("div", "my-class", "hello")).toBe('<div class="my-class">hello</div>');
  });

  it("handles array content", () => {
    expect(el("div", "wrap", ["<span>a</span>", "<span>b</span>"])).toBe(
      '<div class="wrap"><span>a</span><span>b</span></div>'
    );
  });

  it("handles attributes", () => {
    expect(el("div", "cls", "text", { "data-id": "1" })).toBe(
      '<div class="cls" data-id="1">text</div>'
    );
  });

  it("escapes attribute values", () => {
    expect(el("div", "cls", "", { title: 'a "b" c' })).toBe(
      '<div class="cls" title="a &quot;b&quot; c"></div>'
    );
  });
});

describe("createSvgBar", () => {
  it("returns an SVG string with correct structure", () => {
    const svg = createSvgBar();
    expect(svg).toContain("<svg");
    expect(svg).toContain("stat-block-bar");
    expect(svg).toContain("0,0 400,2.5 0,5");
  });
});

describe("createPropertyLine", () => {
  it("creates a property line", () => {
    const html = createPropertyLine("Armor Class", "18 (plate)");
    expect(html).toContain("property-line");
    expect(html).toContain("Armor Class");
    expect(html).toContain("18 (plate)");
  });

  it("adds 'last' class when isLast is true", () => {
    const html = createPropertyLine("Speed", "30 ft.", true);
    expect(html).toContain("property-line last");
  });
});

describe("lucideIcon", () => {
  it("returns SVG for known icons", () => {
    const svg = lucideIcon("swords");
    expect(svg).toContain("<svg");
    expect(svg).toContain("archivist-icon");
  });

  it("returns empty string for unknown icons", () => {
    expect(lucideIcon("nonexistent")).toBe("");
  });
});

describe("convert5eToolsTags", () => {
  it("converts hit tags", () => {
    expect(convert5eToolsTags("{@hit 7}")).toContain("`atk:+7`");
  });

  it("converts damage tags", () => {
    expect(convert5eToolsTags("{@damage 2d6+4}")).toContain("`damage:2d6+4`");
  });

  it("converts DC tags", () => {
    expect(convert5eToolsTags("{@dc 15}")).toContain("`dc:15`");
  });

  it("converts bold tags", () => {
    expect(convert5eToolsTags("{@b hello}")).toBe("**hello**");
  });

  it("converts attack type labels", () => {
    expect(convert5eToolsTags("{@atk mw}")).toBe("Melee Weapon Attack:");
  });
});

describe("appendMarkdownText", () => {
  it("converts bold", () => {
    expect(appendMarkdownText("**bold**")).toContain("<strong>bold</strong>");
  });

  it("converts italic", () => {
    expect(appendMarkdownText("*italic*")).toContain("<em>italic</em>");
  });

  it("converts links", () => {
    const html = appendMarkdownText("[text](https://example.com)");
    expect(html).toContain('<a href="https://example.com"');
  });

  it("escapes HTML in plain text", () => {
    expect(appendMarkdownText("a <b> c")).toContain("&lt;b&gt;");
  });
});

describe("renderTextWithInlineTags", () => {
  it("renders dice tags as styled pills", () => {
    const html = renderTextWithInlineTags("Deals `dice:2d6` damage");
    expect(html).toContain("archivist-stat-tag");
    expect(html).toContain("2d6");
  });

  it("resolves formula tags with monster context", () => {
    const ctx = {
      abilities: { str: 20, dex: 14, con: 16, int: 10, wis: 12, cha: 8 },
      proficiencyBonus: 4,
    };
    const html = renderTextWithInlineTags("`atk:STR` to hit", true, ctx);
    expect(html).toContain("+9");
  });

  it("passes plain text through", () => {
    expect(renderTextWithInlineTags("plain text")).toBe("plain text");
  });
});

describe("renderErrorBlock", () => {
  it("renders error with message", () => {
    const html = renderErrorBlock("Missing field: name");
    expect(html).toContain("archivist-error-block");
    expect(html).toContain("Missing field: name");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/w/archivist-logseq && npx vitest run tests/renderers/renderer-utils.test.ts 2>&1 | tail -5
```

Expected: FAIL -- module not found.

- [ ] **Step 3: Write renderer-utils.ts**

Create `~/w/archivist-logseq/src/renderers/renderer-utils.ts`. This is a large file (~250 lines). The complete content is provided here.

The file contains these exports:
- `escapeHtml(str)` -- HTML entity escaping for all user field values
- `el(tag, className, content, attrs?)` -- HTML string element builder
- `createSvgBar()` -- parchment divider SVG string
- `createPropertyLine(label, value, isLast?)` -- stat block property line
- `createRichPropertyLine(label, valueHtml, isLast?)` -- property line with pre-rendered HTML value
- `createIconProperty(iconName, label, value)` -- property line with Lucide icon
- `lucideIcon(name)` -- inline SVG lookup for ~11 Lucide icons used in stat blocks
- `STAT_TAG_CONFIGS` -- tag type to icon/class/format mapping
- `renderStatBlockTag(tag, monsterCtx?)` -- single inline tag as HTML
- `convert5eToolsTags(text)` -- 5etools `{@...}` tag to backtick format conversion
- `appendMarkdownText(text)` -- inline markdown (bold, italic, links) to HTML
- `renderTextWithInlineTags(text, statBlockMode?, monsterCtx?)` -- full text rendering pipeline
- `renderErrorBlock(message)` -- styled error block HTML
- `MonsterFormulaContext` interface

The content matches the Obsidian version's logic exactly, with all DOM operations replaced by string concatenation and all `setIcon()` calls replaced by `lucideIcon()`.

The inline SVG lookup table `ICON_SVGS` contains these icons (matching what the Obsidian renderers use): `dices`, `swords`, `shield`, `clock`, `target`, `box`, `sparkles`, `scale`, `coins`, `book-open`, `alert-triangle`.

See the code in the spec for the complete `renderer-utils.ts` source. Key patterns:
- `el()` builds `<tag class="cls" attrs>content</tag>` strings
- `escapeHtml()` is called on ALL user-provided field values before interpolation
- `renderStatBlockTag()` resolves formula tags via `resolveFormulaTag()` from `dnd/formula-tags.ts`
- `convert5eToolsTags()` is copied verbatim from the Obsidian version, with `decorateProseDice()` inlined
- `appendMarkdownText()` uses the same regex as Obsidian but outputs HTML strings instead of DOM nodes

- [ ] **Step 4: Run tests**

```bash
cd ~/w/archivist-logseq && npx vitest run tests/renderers/renderer-utils.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/w/archivist-logseq
git add src/renderers/renderer-utils.ts tests/renderers/renderer-utils.test.ts
git commit -m "feat: add HTML string renderer utilities (el, escapeHtml, SVG, icons, text pipeline)"
```

---

## Task 6: Monster Renderer

**Files:**
- Create: `src/renderers/monster-renderer.ts`
- Create: `tests/renderers/monster-renderer.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `~/w/archivist-logseq/tests/renderers/monster-renderer.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { renderMonsterBlock } from "@/renderers/monster-renderer";
import type { Monster } from "@/types/monster";

const GOBLIN: Monster = {
  name: "Goblin",
  size: "Small",
  type: "humanoid (goblinoid)",
  alignment: "neutral evil",
  cr: "1/4",
  ac: [{ ac: 15, from: ["leather armor", "shield"] }],
  hp: { average: 7, formula: "2d6" },
  speed: { walk: 30 },
  abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
  skills: { stealth: 6 },
  senses: ["darkvision 60 ft."],
  passive_perception: 9,
  languages: ["Common", "Goblin"],
  traits: [
    { name: "Nimble Escape", entries: ["The goblin can take the Disengage or Hide action as a bonus action on each of its turns."] },
  ],
  actions: [
    { name: "Scimitar", entries: ["Melee Weapon Attack: `atk:DEX` to hit, reach 5 ft., one target. Hit: `damage:1d6+DEX` slashing damage."] },
  ],
};

describe("renderMonsterBlock", () => {
  it("renders wrapper and block structure", () => {
    const html = renderMonsterBlock(GOBLIN);
    expect(html).toContain("archivist-monster-block-wrapper");
    expect(html).toContain("archivist-monster-block");
  });

  it("renders name and type", () => {
    const html = renderMonsterBlock(GOBLIN);
    expect(html).toContain("Goblin");
    expect(html).toContain("Small Humanoid (Goblinoid), Neutral Evil");
  });

  it("renders AC with source", () => {
    const html = renderMonsterBlock(GOBLIN);
    expect(html).toContain("Armor Class");
    expect(html).toContain("15 (Leather Armor, Shield)");
  });

  it("renders HP with dice pill", () => {
    const html = renderMonsterBlock(GOBLIN);
    expect(html).toContain("Hit Points");
    expect(html).toContain("7");
    expect(html).toContain("archivist-stat-tag");
  });

  it("renders ability scores", () => {
    const html = renderMonsterBlock(GOBLIN);
    expect(html).toContain("abilities-table");
    expect(html).toContain("STR");
    expect(html).toContain("8");
    expect(html).toContain("(-1)");
    expect(html).toContain("14");
    expect(html).toContain("(+2)");
  });

  it("renders secondary properties", () => {
    const html = renderMonsterBlock(GOBLIN);
    expect(html).toContain("Stealth +6");
    expect(html).toContain("darkvision 60 ft.");
    expect(html).toContain("passive Perception 9");
    expect(html).toContain("Common, Goblin");
    expect(html).toContain("1/4");
  });

  it("renders traits", () => {
    const html = renderMonsterBlock(GOBLIN);
    expect(html).toContain("Nimble Escape");
  });

  it("resolves formula tags in actions", () => {
    const html = renderMonsterBlock(GOBLIN);
    // DEX 14 = +2, CR 1/4 = +2 prof => atk = +4
    expect(html).toContain("+4");
  });

  it("renders SVG bars", () => {
    const html = renderMonsterBlock(GOBLIN);
    expect(html).toContain("stat-block-bar");
  });

  it("renders two-column mode", () => {
    const html = renderMonsterBlock(GOBLIN, 2);
    expect(html).toContain("archivist-monster-two-col");
  });

  it("renders legendary section", () => {
    const dragon: Monster = {
      name: "Dragon",
      legendary: [{ name: "Detect", entries: ["The dragon makes a Perception check."] }],
      legendary_actions: 3,
      legendary_resistance: 3,
    };
    const html = renderMonsterBlock(dragon);
    expect(html).toContain("Legendary Actions");
    expect(html).toContain("3 legendary actions");
    expect(html).toContain("Legendary Resistance");
  });

  it("renders minimal monster", () => {
    const html = renderMonsterBlock({ name: "Test" });
    expect(html).toContain("Test");
    expect(html).toContain("archivist-monster-block");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/w/archivist-logseq && npx vitest run tests/renderers/monster-renderer.test.ts 2>&1 | tail -5
```

Expected: FAIL.

- [ ] **Step 3: Write monster-renderer.ts**

Create `~/w/archivist-logseq/src/renderers/monster-renderer.ts`. This is the mechanical rewrite of the Obsidian version. Same layout structure, same CSS classes, but all `el()` calls produce HTML strings and `renderTextWithInlineTags()` returns strings.

The complete source is provided in the spec design section "monster-renderer.ts". Key exports:
- `renderMonsterBlock(monster: Monster, columns?: number): string`
- `initMonsterTabs(container: HTMLElement): void` (wires up tab click handlers post-injection)

Structure follows the Obsidian version exactly:
1. Header (name, size/type/alignment)
2. SVG bar
3. Core properties (AC, HP with dice pill, Speed)
4. SVG bar
5. Abilities table
6. SVG bar
7. Secondary properties (saves, skills, damage/condition immunities, senses, languages, CR)
8. SVG bar (if secondary props exist)
9. Sections: traits (no header in two-col), actions, reactions, legendary
10. Two-column mode uses `archivist-monster-two-col-flow` wrapper with sequential sections
11. Single-column mode uses tabbed navigation with `data-tab-id` attributes

- [ ] **Step 4: Run tests**

```bash
cd ~/w/archivist-logseq && npx vitest run tests/renderers/monster-renderer.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/w/archivist-logseq
git add src/renderers/monster-renderer.ts tests/renderers/monster-renderer.test.ts
git commit -m "feat: add monster stat block renderer (HTML string output)"
```

---

## Task 7: Spell Renderer

**Files:**
- Create: `src/renderers/spell-renderer.ts`
- Create: `tests/renderers/spell-renderer.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `~/w/archivist-logseq/tests/renderers/spell-renderer.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { renderSpellBlock } from "@/renderers/spell-renderer";
import type { Spell } from "@/types/spell";

const FIREBALL: Spell = {
  name: "Fireball",
  level: 3,
  school: "evocation",
  casting_time: "1 action",
  range: "150 feet",
  components: "V, S, M (a tiny ball of bat guano and sulfur)",
  duration: "Instantaneous",
  classes: ["sorcerer", "wizard"],
  description: ["A bright streak flashes from your pointing finger."],
  at_higher_levels: ["The damage increases by `damage:1d6` for each slot above 3rd."],
};

describe("renderSpellBlock", () => {
  it("renders structure", () => {
    const html = renderSpellBlock(FIREBALL);
    expect(html).toContain("archivist-spell-block-wrapper");
    expect(html).toContain("Fireball");
    expect(html).toContain("3rd-level evocation");
  });

  it("renders properties", () => {
    const html = renderSpellBlock(FIREBALL);
    expect(html).toContain("Casting Time:");
    expect(html).toContain("1 action");
    expect(html).toContain("Range:");
    expect(html).toContain("150 feet");
  });

  it("renders at higher levels with inline tags", () => {
    const html = renderSpellBlock(FIREBALL);
    expect(html).toContain("At Higher Levels.");
    expect(html).toContain("archivist-stat-tag");
  });

  it("renders classes", () => {
    const html = renderSpellBlock(FIREBALL);
    expect(html).toContain("Sorcerer, Wizard");
  });

  it("renders cantrip", () => {
    const html = renderSpellBlock({ name: "Fire Bolt", level: 0, school: "Evocation" });
    expect(html).toContain("Evocation cantrip");
  });

  it("renders concentration tag", () => {
    const html = renderSpellBlock({ name: "Bless", concentration: true });
    expect(html).toContain("Concentration");
  });

  it("renders ritual tag", () => {
    const html = renderSpellBlock({ name: "Find Familiar", ritual: true });
    expect(html).toContain("Ritual");
  });
});
```

- [ ] **Step 2: Write spell-renderer.ts**

Create `~/w/archivist-logseq/src/renderers/spell-renderer.ts`. Same structure as Obsidian version: header, icon properties, description, at higher levels, classes, tags. All using `el()` string builder and `renderTextWithInlineTags()` for description text.

- [ ] **Step 3: Run tests**

```bash
cd ~/w/archivist-logseq && npx vitest run tests/renderers/spell-renderer.test.ts
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
cd ~/w/archivist-logseq
git add src/renderers/spell-renderer.ts tests/renderers/spell-renderer.test.ts
git commit -m "feat: add spell block renderer (HTML string output)"
```

---

## Task 8: Item Renderer

**Files:**
- Create: `src/renderers/item-renderer.ts`
- Create: `tests/renderers/item-renderer.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `~/w/archivist-logseq/tests/renderers/item-renderer.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { renderItemBlock } from "@/renderers/item-renderer";

describe("renderItemBlock", () => {
  it("renders structure", () => {
    const html = renderItemBlock({ name: "Flame Tongue", type: "weapon", rarity: "rare", attunement: true });
    expect(html).toContain("archivist-item-block-wrapper");
    expect(html).toContain("Flame Tongue");
    expect(html).toContain("Weapon");
    expect(html).toContain("Rare");
    expect(html).toContain("requires attunement");
  });

  it("renders damage", () => {
    const html = renderItemBlock({ name: "Test", damage: "2d6", damage_type: "fire" });
    expect(html).toContain("Damage:");
    expect(html).toContain("2d6 fire");
  });

  it("renders weight and value", () => {
    const html = renderItemBlock({ name: "Test", weight: 3, value: 100 });
    expect(html).toContain("3 lb.");
    expect(html).toContain("100 gp");
  });

  it("renders description with inline tags", () => {
    const html = renderItemBlock({ name: "Test", entries: ["Deals `damage:2d6` fire damage."] });
    expect(html).toContain("archivist-stat-tag");
  });

  it("renders charges", () => {
    const html = renderItemBlock({ name: "Test", charges: 7, recharge: "dawn" });
    expect(html).toContain("7 charges");
    expect(html).toContain("dawn");
  });

  it("renders curse", () => {
    const html = renderItemBlock({ name: "Test", curse: true });
    expect(html).toContain("Cursed");
  });

  it("renders string attunement", () => {
    const html = renderItemBlock({ name: "Test", attunement: "a spellcaster" });
    expect(html).toContain("requires attunement by a spellcaster");
  });
});
```

- [ ] **Step 2: Write item-renderer.ts**

Create `~/w/archivist-logseq/src/renderers/item-renderer.ts`. Same structure as Obsidian: header with subtitle, icon properties, description, charges, curse. All string output.

- [ ] **Step 3: Run tests**

```bash
cd ~/w/archivist-logseq && npx vitest run tests/renderers/item-renderer.test.ts
```

Expected: all tests PASS.

- [ ] **Step 4: Run full test suite**

```bash
cd ~/w/archivist-logseq && npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/w/archivist-logseq
git add src/renderers/item-renderer.ts tests/renderers/item-renderer.test.ts
git commit -m "feat: add item block renderer (HTML string output)"
```

---

## Task 9: CSS Adaptation

**Files:**
- Create: `src/styles/archivist-dnd.css`

- [ ] **Step 1: Copy CSS from Obsidian**

```bash
mkdir -p ~/w/archivist-logseq/src/styles
cp ~/w/archivist-obsidian/src/styles/archivist-dnd.css ~/w/archivist-logseq/src/styles/
```

- [ ] **Step 2: Strip Obsidian-specific selectors**

Delete lines 47-166 from the copied file. These contain all `.cm-embed-block`, `.archivist-block-delete-btn`, `.archivist-block-column-btn`, `.archivist-side-btns`, and `.markdown-reading-view` selectors.

- [ ] **Step 3: Add Logseq reset and icon styles**

Insert after the Google Fonts `@import` line (line 8), before the `:root` block:

```css
/* Logseq reset: prevent host styles from leaking into stat blocks */
.archivist-block {
  font-family: 'Libre Baskerville', 'Georgia', serif;
  font-size: 14px;
  line-height: 1.4;
  color: var(--d5e-text-dark);
  position: relative;
}

.archivist-block * {
  box-sizing: border-box;
}

/* Inline Lucide icon base style */
.archivist-icon {
  display: inline-flex;
  align-items: center;
  vertical-align: middle;
}

.archivist-icon svg {
  width: 16px;
  height: 16px;
}
```

- [ ] **Step 4: Verify no Obsidian selectors remain**

```bash
grep -n "cm-embed-block\|markdown-reading\|markdown-rendered\|edit-block-button" ~/w/archivist-logseq/src/styles/archivist-dnd.css
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
cd ~/w/archivist-logseq
git add src/styles/archivist-dnd.css
git commit -m "feat: adapt parchment CSS from Obsidian (stripped platform selectors, added Logseq reset)"
```

---

## Task 10: Plugin Entry Point

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Write the entry point**

Create `~/w/archivist-logseq/src/index.ts`. This file:
1. Imports `@logseq/libs`
2. Imports all parsers, renderers, and CSS
3. Defines a `createBlockRenderer` factory that creates React components using `logseq.Experiments.React`
4. Each component uses `useRef` + `useEffect` to parse YAML and set rendered HTML on the ref element
5. Registers 3 fenced code renderers: `monster`, `spell`, `item`
6. Registers 3 slash commands with template YAML
7. Calls `logseq.provideStyle(css)` to inject the adapted CSS
8. Monster renderer gets a `postRender` callback that calls `initMonsterTabs` for tab interactivity

The `createBlockRenderer` factory accepts:
- `parser: (source: string) => ParseResult` -- one of `parseMonster`, `parseSpell`, `parseItem`
- `renderer: (data: any, columns?: number) => string` -- one of the HTML string renderers
- `postRender?: (container: HTMLElement) => void` -- optional DOM setup after HTML injection (used for tab click handlers)

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd ~/w/archivist-logseq && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors (CSS import types are handled by Vite, may show a warning but not an error).

- [ ] **Step 3: Build the plugin**

```bash
cd ~/w/archivist-logseq && npm run build
```

Expected: build succeeds, `dist/` directory created.

- [ ] **Step 4: Commit**

```bash
cd ~/w/archivist-logseq
git add src/index.ts
git commit -m "feat: add plugin entry point with fenced code renderers and slash commands"
```

---

## Task 11: Full Build Verification

- [ ] **Step 1: Run full test suite**

```bash
cd ~/w/archivist-logseq && npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 2: Run production build**

```bash
cd ~/w/archivist-logseq && npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Verify dist output exists**

```bash
ls -la ~/w/archivist-logseq/dist/
```

Expected: `index.html` and JS bundle file(s).

- [ ] **Step 4: Verify no obsidian imports in output**

```bash
grep -r "from.*obsidian\|require.*obsidian" ~/w/archivist-logseq/dist/ || echo "Clean: no obsidian imports"
```

Expected: "Clean: no obsidian imports"

- [ ] **Step 5: Final commit**

```bash
cd ~/w/archivist-logseq
git add -A
git status
git commit -m "chore: Phase 1 complete - core stat block rendering for Logseq"
```

---

## Execution Order

The build dependency order is:

```
Task 1 (scaffold) -> Task 2 (copy portable layer) -> Task 3 (test setup)
     |
     v
Task 5 (renderer-utils) -> Task 4 (inline-tag-renderer)
     |
     v
Task 6 (monster-renderer) -> Task 7 (spell-renderer) -> Task 8 (item-renderer)
     |
     v
Task 9 (CSS) -> Task 10 (entry point) -> Task 11 (verification)
```

Tasks 5 must come before 4 (inline-tag-renderer imports from renderer-utils). Tasks 6, 7, 8 can be done in any order after 5. Tasks 4-8 can be parallelized with Task 9.
