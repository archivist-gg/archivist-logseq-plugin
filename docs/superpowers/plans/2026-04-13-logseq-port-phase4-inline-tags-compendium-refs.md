# Phase 4: Inline Tags & Compendium Refs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CM6 editor extensions to Logseq that render inline formula tags as styled pills and `{{monster:goblin}}` compendium references as full stat blocks in regular text blocks.

**Architecture:** Three independent CM6 extensions (inline tag ViewPlugin, compendium ref ViewPlugin, compendium completion source) registered via `logseq.Experiments.registerExtensionsEnhancer('codemirror', ...)`. Each extension factory receives the host CM6 module and returns Extension objects. All extensions access the existing `EntityRegistry` and `CompendiumManager` via module-level refs already established in Phase 2/3.

**Tech Stack:** TypeScript, CodeMirror 6 (from Logseq host), Vitest, `@logseq/libs` Experiments API

---

### Task 1: CM6 Compatibility Spike

**Files:**
- Modify: `src/index.ts`

This task validates that `registerExtensionsEnhancer('codemirror', ...)` works and that `{{monster:goblin}}` raw text is accessible to a ViewPlugin. Build and test manually in Logseq.

- [ ] **Step 1: Add a minimal CM6 extension registration to index.ts**

Add this after the console.log at the end of `main()` in `src/index.ts`:

```typescript
  // --- Phase 4: CM6 Extensions (spike) ---
  logseq.Experiments.registerExtensionsEnhancer("codemirror", async (cm: any) => {
    console.log("[archivist] CM6 enhancer called, received:", Object.keys(cm));

    const { ViewPlugin, Decoration, EditorView } = cm;
    console.log("[archivist] ViewPlugin:", !!ViewPlugin);
    console.log("[archivist] Decoration:", !!Decoration);
    console.log("[archivist] EditorView:", !!EditorView);

    const spikePlugin = ViewPlugin.fromClass(
      class {
        constructor(view: any) {
          const text = view.state.doc.toString();
          const has = text.includes("{{");
          console.log("[archivist] spike plugin init, doc has {{:", has);
          if (has) {
            const match = text.match(/\{\{[^}]+\}\}/);
            console.log("[archivist] first {{ match:", match?.[0]);
          }
        }
        update() {}
      },
    );

    return [spikePlugin];
  });
```

- [ ] **Step 2: Build and load in Logseq**

Run: `cd ~/w/archivist-logseq && npm run build`

Load the plugin in Logseq. Open developer tools (Cmd+Shift+I). Type `{{monster:goblin}}` in a block. Check the console for:
1. What keys the `cm` object has (tells us which CM6 exports are available)
2. Whether `ViewPlugin`, `Decoration`, `EditorView` are present
3. Whether the `{{monster:goblin}}` text is visible in `view.state.doc`
4. What Logseq does with `{{monster:goblin}}` in reading mode

- [ ] **Step 3: Document findings and remove spike code**

Record which CM6 exports are available and whether `{{...}}` syntax works. Remove the spike code from `index.ts`. If `{{...}}` doesn't work, note the fallback needed (this plan assumes it works; if not, adapt the compendium ref extension to use an alternative syntax or hybrid approach as described in spec Section 6).

- [ ] **Step 4: Commit**

```bash
cd ~/w/archivist-logseq && git add src/index.ts
git commit -m "spike: validate CM6 registerExtensionsEnhancer API and syntax"
```

---

### Task 2: Inline Tag Extension — Tests

**Files:**
- Create: `tests/extensions/inline-tag-extension.test.ts`

We can't unit-test the actual CM6 ViewPlugin (needs a running CM6 editor), but we can test the core logic: the `findInlineTagRanges` function that scans text for backtick inline-code tags and returns decoration ranges.

- [ ] **Step 1: Write tests for the inline tag decoration builder**

Create `tests/extensions/inline-tag-extension.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { findInlineTagRanges } from "@/extensions/inline-tag-extension";

describe("findInlineTagRanges", () => {
  it("finds a dice tag in text", () => {
    const text = "Roll `dice:2d6+3` for damage";
    const ranges = findInlineTagRanges(text, 0);
    expect(ranges).toEqual([
      { from: 5, to: 17, tagText: "dice:2d6+3" },
    ]);
  });

  it("finds multiple tags in text", () => {
    const text = "`atk:+7` to hit, `damage:2d6+4` slashing";
    const ranges = findInlineTagRanges(text, 0);
    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toEqual({ from: 0, to: 8, tagText: "atk:+7" });
    expect(ranges[1]).toEqual({ from: 18, to: 31, tagText: "damage:2d6+4" });
  });

  it("ignores regular code spans that are not inline tags", () => {
    const text = "`const x = 5` and `dice:1d6`";
    const ranges = findInlineTagRanges(text, 0);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].tagText).toBe("dice:1d6");
  });

  it("applies offset to positions", () => {
    const text = "`dc:15`";
    const ranges = findInlineTagRanges(text, 100);
    expect(ranges).toEqual([
      { from: 100, to: 107, tagText: "dc:15" },
    ]);
  });

  it("returns empty for text with no tags", () => {
    const text = "No tags here, just `regular code`";
    const ranges = findInlineTagRanges(text, 0);
    expect(ranges).toEqual([]);
  });

  it("handles all supported tag types", () => {
    const text = "`dice:1d20` `atk:+5` `dc:14` `damage:3d8` `mod:+3` `check:Perception`";
    const ranges = findInlineTagRanges(text, 0);
    expect(ranges).toHaveLength(6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/w/archivist-logseq && npx vitest run tests/extensions/inline-tag-extension.test.ts`

Expected: FAIL with module not found or function not defined.

---

### Task 3: Inline Tag Extension — Implementation

**Files:**
- Create: `src/extensions/inline-tag-extension.ts`

- [ ] **Step 1: Write the inline tag extension**

Create `src/extensions/inline-tag-extension.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd ~/w/archivist-logseq && npx vitest run tests/extensions/inline-tag-extension.test.ts`

Expected: All 6 tests PASS.

- [ ] **Step 3: Commit**

```bash
cd ~/w/archivist-logseq && git add src/extensions/inline-tag-extension.ts tests/extensions/inline-tag-extension.test.ts
git commit -m "feat: add inline tag CM6 extension with range finder tests"
```

---

### Task 4: Compendium Ref Extension — Tests

**Files:**
- Create: `tests/extensions/compendium-ref-extension.test.ts`

Test the regex-based range finder that locates `{{...}}` patterns in text.

- [ ] **Step 1: Write tests for the compendium ref range finder**

Create `tests/extensions/compendium-ref-extension.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { findCompendiumRefRanges } from "@/extensions/compendium-ref-extension";

describe("findCompendiumRefRanges", () => {
  it("finds a typed ref", () => {
    const text = "See {{monster:goblin}} for stats";
    const ranges = findCompendiumRefRanges(text, 0);
    expect(ranges).toEqual([
      { from: 4, to: 21, refText: "{{monster:goblin}}", entityType: "monster", slug: "goblin" },
    ]);
  });

  it("finds an untyped ref", () => {
    const text = "Check {{goblin}} here";
    const ranges = findCompendiumRefRanges(text, 0);
    expect(ranges).toEqual([
      { from: 6, to: 16, refText: "{{goblin}}", entityType: null, slug: "goblin" },
    ]);
  });

  it("finds multiple refs in text", () => {
    const text = "{{monster:goblin}} and {{spell:fireball}}";
    const ranges = findCompendiumRefRanges(text, 0);
    expect(ranges).toHaveLength(2);
    expect(ranges[0].slug).toBe("goblin");
    expect(ranges[1].slug).toBe("fireball");
  });

  it("applies offset to positions", () => {
    const text = "{{monster:goblin}}";
    const ranges = findCompendiumRefRanges(text, 50);
    expect(ranges[0].from).toBe(50);
    expect(ranges[0].to).toBe(68);
  });

  it("returns empty for text with no refs", () => {
    const text = "No refs here";
    const ranges = findCompendiumRefRanges(text, 0);
    expect(ranges).toEqual([]);
  });

  it("handles refs with spaces inside", () => {
    const text = "{{ monster : goblin }}";
    const ranges = findCompendiumRefRanges(text, 0);
    // parseCompendiumRef handles trimming internally
    expect(ranges).toHaveLength(1);
    expect(ranges[0].slug).toBe("goblin");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/w/archivist-logseq && npx vitest run tests/extensions/compendium-ref-extension.test.ts`

Expected: FAIL with module not found or function not defined.

---

### Task 5: Compendium Ref Extension — Core Implementation

**Files:**
- Create: `src/extensions/compendium-ref-extension.ts`

This task implements the range finder and the core widget (view-only stat block rendering). Side buttons, edit mode, and save flows come in Task 7.

- [ ] **Step 1: Write the compendium ref extension core**

Create `src/extensions/compendium-ref-extension.ts`:

```typescript
import * as yaml from "js-yaml";
import { parseCompendiumRef } from "./compendium-ref-parser";
import { parseMonster } from "../parsers/monster-parser";
import { parseSpell } from "../parsers/spell-parser";
import { parseItem } from "../parsers/item-parser";
import { renderMonsterBlock } from "../renderers/monster-renderer";
import { renderSpellBlock } from "../renderers/spell-renderer";
import { renderItemBlock } from "../renderers/item-renderer";
import { escapeHtml, lucideIcon } from "../renderers/renderer-utils";
import type { EntityRegistry, RegisteredEntity } from "../entities/entity-registry";
import type { CompendiumManager } from "../entities/compendium-manager";

// ---------------------------------------------------------------------------
// Module-level refs (set by index.ts at plugin load)
// ---------------------------------------------------------------------------

let registryRef: EntityRegistry | null = null;
let managerRef: CompendiumManager | null = null;

export function setCompendiumRefRegistry(registry: EntityRegistry): void {
  registryRef = registry;
}

export function setCompendiumRefManager(manager: CompendiumManager): void {
  managerRef = manager;
}

// ---------------------------------------------------------------------------
// Testable range finder (no CM6 dependency)
// ---------------------------------------------------------------------------

export interface CompendiumRefRange {
  from: number;
  to: number;
  refText: string;
  entityType: string | null;
  slug: string;
}

const COMPENDIUM_REF_RE = /\{\{[^}]+\}\}/g;

/**
 * Scan text for {{type:slug}} patterns and return their positions.
 * `offset` is added to all positions (for use with visible ranges).
 */
export function findCompendiumRefRanges(text: string, offset: number): CompendiumRefRange[] {
  const ranges: CompendiumRefRange[] = [];
  COMPENDIUM_REF_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = COMPENDIUM_REF_RE.exec(text)) !== null) {
    const parsed = parseCompendiumRef(match[0]);
    if (!parsed) continue;

    ranges.push({
      from: offset + match.index,
      to: offset + match.index + match[0].length,
      refText: match[0],
      entityType: parsed.entityType,
      slug: parsed.slug,
    });
  }

  return ranges;
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function renderEntityHtml(entity: RegisteredEntity, columns?: number): string {
  const yamlStr = yaml.dump(entity.data, { lineWidth: -1, noRefs: true });
  const type = entity.entityType;

  if (type === "monster") {
    const result = parseMonster(yamlStr);
    if (result.success) return renderMonsterBlock(result.data, columns ?? 1);
  } else if (type === "spell") {
    const result = parseSpell(yamlStr);
    if (result.success) return renderSpellBlock(result.data);
  } else if (type === "item") {
    const result = parseItem(yamlStr);
    if (result.success) return renderItemBlock(result.data);
  }

  return `<div class="archivist-compendium-ref-error">Cannot render ${escapeHtml(type)}: ${escapeHtml(entity.slug)}</div>`;
}

function renderNotFound(refText: string, entityType: string | null, slug: string): string {
  const iconSvg = lucideIcon("alert-triangle");
  const refLabel = entityType ? `${entityType}:${slug}` : slug;
  return [
    '<div class="archivist-compendium-ref-error">',
    `<div class="archivist-not-found-icon">${iconSvg}</div>`,
    '<div class="archivist-not-found-text">',
    '<div class="archivist-not-found-label">Entity not found</div>',
    `<div class="archivist-not-found-ref">${escapeHtml(refLabel)}</div>`,
    '</div></div>',
  ].join("");
}

function renderBadge(compendium: string): string {
  return `<div class="archivist-compendium-badge">${escapeHtml(compendium)}</div>`;
}

// ---------------------------------------------------------------------------
// CM6 Widget & Plugin (constructed at runtime from host CM6 module)
// ---------------------------------------------------------------------------

/**
 * Factory that receives the host CM6 module and returns an Extension
 * and the refresh StateEffect.
 */
export function createCompendiumRefExtension(cm: any): { plugin: any; compendiumRefreshEffect: any } {
  const { ViewPlugin, Decoration, WidgetType, StateEffect } = cm;

  // Refresh effect -- dispatch to force decoration rebuild
  const compendiumRefreshEffect = StateEffect.define();

  class CompendiumRefWidget extends WidgetType {
    constructor(
      private refText: string,
      private entityType: string | null,
      private slug: string,
    ) {
      super();
    }

    toDOM(): HTMLElement {
      const container = document.createElement("div");
      container.className = "archivist-compendium-ref archivist-block";

      if (!registryRef) {
        container.innerHTML = renderNotFound(this.refText, this.entityType, this.slug);
        return container;
      }

      const entity = registryRef.getBySlug(this.slug);

      if (!entity) {
        container.innerHTML = renderNotFound(this.refText, this.entityType, this.slug);
        return container;
      }

      // Type mismatch check
      if (this.entityType && entity.entityType !== this.entityType) {
        container.innerHTML = renderNotFound(this.refText, this.entityType, this.slug);
        return container;
      }

      // Render stat block + badge
      const blockHtml = renderEntityHtml(entity);
      container.innerHTML = blockHtml + renderBadge(entity.compendium);

      // Prevent Logseq click-through
      container.addEventListener("mousedown", (e: MouseEvent) => e.stopPropagation());
      container.addEventListener("click", (e: MouseEvent) => e.stopPropagation());

      return container;
    }

    eq(other: CompendiumRefWidget): boolean {
      return this.refText === other.refText;
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
      const ranges = findCompendiumRefRanges(text, from);

      for (const range of ranges) {
        // Skip when cursor is inside the ref (let user edit)
        if (cursorPos > range.from && cursorPos < range.to) continue;

        decorations.push({
          from: range.from,
          to: range.to,
          deco: Decoration.replace({
            widget: new CompendiumRefWidget(range.refText, range.entityType, range.slug),
          }),
        });
      }
    }

    decorations.sort((a, b) => a.from - b.from);

    if (decorations.length === 0) return Decoration.none;
    return Decoration.set(
      decorations.map((d) => d.deco.range(d.from, d.to)),
    );
  }

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: any;

      constructor(view: any) {
        this.decorations = buildDecorations(view);
      }

      update(update: any) {
        const hasRefresh = update.transactions.some((tr: any) =>
          tr.effects.some((e: any) => e.is(compendiumRefreshEffect)),
        );
        if (hasRefresh || update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = buildDecorations(update.view);
        }
      }
    },
    {
      decorations: (v: any) => v.decorations,
    },
  );

  return { plugin, compendiumRefreshEffect };
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd ~/w/archivist-logseq && npx vitest run tests/extensions/compendium-ref-extension.test.ts`

Expected: All 6 tests PASS.

- [ ] **Step 3: Commit**

```bash
cd ~/w/archivist-logseq && git add src/extensions/compendium-ref-extension.ts tests/extensions/compendium-ref-extension.test.ts
git commit -m "feat: add compendium ref CM6 extension with range finder and view-only widget"
```

---

### Task 6: Compendium Suggest — Tests & Implementation

**Files:**
- Create: `tests/extensions/compendium-suggest.test.ts`
- Create: `src/extensions/compendium-suggest.ts`

- [ ] **Step 1: Write tests for the completion trigger detection**

Create `tests/extensions/compendium-suggest.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { detectCompendiumTrigger } from "@/extensions/compendium-suggest";

describe("detectCompendiumTrigger", () => {
  it("detects {{ trigger", () => {
    const result = detectCompendiumTrigger("Some text {{gob", 15);
    expect(result).toEqual({ from: 10, query: "gob", entityType: undefined });
  });

  it("detects typed prefix", () => {
    const result = detectCompendiumTrigger("{{monster:gob", 13);
    expect(result).toEqual({ from: 0, query: "gob", entityType: "monster" });
  });

  it("returns null when no {{ found", () => {
    const result = detectCompendiumTrigger("just text", 9);
    expect(result).toBeNull();
  });

  it("returns null when {{ is already closed", () => {
    const result = detectCompendiumTrigger("{{monster:goblin}} more", 23);
    expect(result).toBeNull();
  });

  it("handles spell prefix", () => {
    const result = detectCompendiumTrigger("{{spell:fire", 12);
    expect(result).toEqual({ from: 0, query: "fire", entityType: "spell" });
  });

  it("handles item prefix", () => {
    const result = detectCompendiumTrigger("{{item:sword", 12);
    expect(result).toEqual({ from: 0, query: "sword", entityType: "item" });
  });

  it("handles unknown prefix as untyped query", () => {
    const result = detectCompendiumTrigger("{{dragon:fire", 13);
    expect(result).toEqual({ from: 0, query: "dragon:fire", entityType: undefined });
  });

  it("handles empty query after {{", () => {
    const result = detectCompendiumTrigger("{{", 2);
    expect(result).toEqual({ from: 0, query: "", entityType: undefined });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/w/archivist-logseq && npx vitest run tests/extensions/compendium-suggest.test.ts`

Expected: FAIL with module not found or function not defined.

- [ ] **Step 3: Write the compendium suggest extension**

Create `src/extensions/compendium-suggest.ts`:

```typescript
import type { EntityRegistry, RegisteredEntity } from "../entities/entity-registry";

// ---------------------------------------------------------------------------
// Module-level registry ref (set by index.ts at plugin load)
// ---------------------------------------------------------------------------

let registryRef: EntityRegistry | null = null;

export function setCompendiumSuggestRegistry(registry: EntityRegistry): void {
  registryRef = registry;
}

// ---------------------------------------------------------------------------
// Trigger detection (testable, no CM6 dependency)
// ---------------------------------------------------------------------------

const VALID_PREFIXES = new Set(["monster", "spell", "item"]);

export interface CompendiumTrigger {
  from: number;
  query: string;
  entityType: string | undefined;
}

/**
 * Detect {{ compendium trigger in text before cursor.
 * `cursorPos` is unused but kept for API symmetry -- the function operates
 * entirely on `textBeforeCursor`.
 */
export function detectCompendiumTrigger(
  textBeforeCursor: string,
  _cursorPos: number,
): CompendiumTrigger | null {
  const lastOpen = textBeforeCursor.lastIndexOf("{{");
  if (lastOpen === -1) return null;

  const afterOpen = textBeforeCursor.substring(lastOpen + 2);
  // Already closed -- no trigger
  if (afterOpen.includes("}}")) return null;

  // Check for type prefix
  const colonIdx = afterOpen.indexOf(":");
  let entityType: string | undefined;
  let query: string;

  if (colonIdx !== -1) {
    const prefix = afterOpen.substring(0, colonIdx).toLowerCase().trim();
    if (VALID_PREFIXES.has(prefix)) {
      entityType = prefix;
      query = afterOpen.substring(colonIdx + 1).trim();
    } else {
      // Unknown prefix -- treat entire thing as query
      entityType = undefined;
      query = afterOpen;
    }
  } else {
    query = afterOpen;
  }

  return { from: lastOpen, query, entityType };
}

// ---------------------------------------------------------------------------
// CM6 Completion Source (constructed at runtime from host CM6 module)
// ---------------------------------------------------------------------------

/**
 * Factory that receives the host CM6 module and returns an Extension
 * providing autocompletion for {{type:slug}} references.
 */
export function createCompendiumCompletion(cm: any): any {
  // autocompletion may come from @codemirror/autocomplete
  const autocompletion = cm.autocompletion;
  if (!autocompletion) {
    console.warn("[archivist] autocompletion not available from CM6 host module");
    return [];
  }

  function completionSource(context: any): any {
    if (!registryRef) return null;

    const line = context.state.doc.lineAt(context.pos);
    const textBefore = line.text.substring(0, context.pos - line.from);

    const trigger = detectCompendiumTrigger(textBefore, context.pos);
    if (!trigger) return null;

    const results = registryRef.search(trigger.query, trigger.entityType, 20);
    if (results.length === 0) return null;

    const from = line.from + trigger.from;

    return {
      from,
      to: context.pos,
      options: results.map((entity: RegisteredEntity) => ({
        label: entity.name,
        detail: entity.entityType,
        info: entity.compendium,
        apply: `{{${entity.entityType}:${entity.slug}}}`,
      })),
    };
  }

  return autocompletion({
    override: [completionSource],
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/w/archivist-logseq && npx vitest run tests/extensions/compendium-suggest.test.ts`

Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/w/archivist-logseq && git add src/extensions/compendium-suggest.ts tests/extensions/compendium-suggest.test.ts
git commit -m "feat: add compendium autocomplete CM6 extension with trigger detection tests"
```

---

### Task 7: Compendium Ref — Side Buttons, Source Toggle, Edit & Delete

**Files:**
- Modify: `src/extensions/compendium-ref-extension.ts`

Extend the `CompendiumRefWidget` with side buttons, source toggle, edit mode (reusing Phase 3 renderers), and delete flows. This is the largest single task.

- [ ] **Step 1: Add edit mode imports to compendium-ref-extension.ts**

Add these imports at the top of `src/extensions/compendium-ref-extension.ts`:

```typescript
import { renderSideButtons, wireSideButtonEvents } from "../edit/side-buttons";
import type { SideButtonCallbacks } from "../edit/side-buttons";
import { renderMonsterEditMode, wireMonsterEditEvents } from "../edit/monster-edit-render";
import { renderSpellEditMode, wireSpellEditEvents } from "../edit/spell-edit-render";
import { renderItemEditMode, wireItemEditEvents } from "../edit/item-edit-render";
import { showCompendiumPicker } from "../edit/compendium-picker";
```

- [ ] **Step 2: Replace CompendiumRefWidget.toDOM with stateful version**

Replace the `toDOM()` method in `CompendiumRefWidget` with the full version that supports side buttons, source toggle, edit mode, and delete flows. The widget tracks its own mode (`view` | `source` | `edit`) via closure state:

```typescript
    toDOM(view: any): HTMLElement {
      const container = document.createElement("div");
      container.className = "archivist-compendium-ref archivist-block";

      if (!registryRef) {
        container.innerHTML = renderNotFound(this.refText, this.entityType, this.slug);
        return container;
      }

      const entity = registryRef.getBySlug(this.slug);

      if (!entity) {
        container.innerHTML = renderNotFound(this.refText, this.entityType, this.slug);
        return container;
      }

      if (this.entityType && entity.entityType !== this.entityType) {
        container.innerHTML = renderNotFound(this.refText, this.entityType, this.slug);
        return container;
      }

      let currentColumns = 1;
      const isMonster = entity.entityType === "monster";
      const refText = this.refText;
      const compCtx = {
        slug: entity.slug,
        compendium: entity.compendium,
        entityType: entity.entityType as "monster" | "spell" | "item",
        readonly: entity.readonly,
      };

      const doRenderView = () => {
        container.innerHTML = "";
        const blockHtml = renderEntityHtml(entity, currentColumns);
        const sideHtml = renderSideButtons({
          state: "default",
          showColumnToggle: isMonster,
          isColumnActive: currentColumns > 1,
          compendiumContext: compCtx,
        });
        container.innerHTML = blockHtml + renderBadge(entity.compendium) + sideHtml;
        wireSideButtonEvents(container, buildCbs());
      };

      const doRenderSource = () => {
        container.innerHTML = "";
        const yamlStr = yaml.dump(entity.data, { lineWidth: -1, noRefs: true });
        const sideHtml = renderSideButtons({
          state: "default",
          showColumnToggle: isMonster,
          isColumnActive: currentColumns > 1,
          compendiumContext: compCtx,
        });
        container.innerHTML =
          `<div class="archivist-source-view"><pre class="archivist-source-pre">${escapeHtml(yamlStr)}</pre>${sideHtml}</div>`;
        wireSideButtonEvents(container, buildCbs());
      };

      const doRenderEdit = () => {
        container.innerHTML = "";
        const editCbs = {
          onSave: async (yamlStr: string) => {
            if (!managerRef) return;
            try {
              const data = yaml.load(yamlStr) as Record<string, unknown>;
              if (data && typeof data === "object") {
                await managerRef.updateEntity(entity.slug, data);
              }
            } catch { /* ignore parse errors */ }
            doRenderView();
          },
          onSaveAsNew: async (yamlStr: string, entityName: string) => {
            if (!managerRef) return;
            const writable = managerRef.getWritable();
            if (writable.length === 0) return;
            try {
              const data = yaml.load(yamlStr) as Record<string, unknown>;
              if (!data || typeof data !== "object") return;
              data.name = entityName;
              if (writable.length === 1) {
                await managerRef.saveEntity(writable[0].name, entity.entityType, data);
              } else {
                showCompendiumPicker(container, writable, async (comp) => {
                  await managerRef!.saveEntity(comp.name, entity.entityType, data);
                  doRenderView();
                });
                return;
              }
            } catch { /* ignore */ }
            doRenderView();
          },
          onCancel: () => doRenderView(),
        };

        const yamlStr = yaml.dump(entity.data, { lineWidth: -1, noRefs: true });
        const type = entity.entityType;

        if (type === "monster") {
          const result = parseMonster(yamlStr);
          if (result.success) {
            const editHtml = renderMonsterEditMode(result.data, compCtx);
            const sideHtml = renderSideButtons({ state: "editing", showColumnToggle: false, isColumnActive: false, compendiumContext: compCtx });
            container.innerHTML = editHtml + sideHtml;
            wireMonsterEditEvents(container, result.data, compCtx, editCbs);
            wireSideButtonEvents(container, buildCbs());
          }
        } else if (type === "spell") {
          const result = parseSpell(yamlStr);
          if (result.success) {
            const editHtml = renderSpellEditMode(result.data, compCtx);
            const sideHtml = renderSideButtons({ state: "editing", showColumnToggle: false, isColumnActive: false, compendiumContext: compCtx });
            container.innerHTML = editHtml + sideHtml;
            wireSpellEditEvents(container, result.data, compCtx, editCbs);
            wireSideButtonEvents(container, buildCbs());
          }
        } else if (type === "item") {
          const result = parseItem(yamlStr);
          if (result.success) {
            const editHtml = renderItemEditMode(result.data, compCtx);
            const sideHtml = renderSideButtons({ state: "editing", showColumnToggle: false, isColumnActive: false, compendiumContext: compCtx });
            container.innerHTML = editHtml + sideHtml;
            wireItemEditEvents(container, result.data, compCtx, editCbs);
            wireSideButtonEvents(container, buildCbs());
          }
        }
      };

      let currentMode: "view" | "source" | "edit" = "view";

      const buildCbs = (): SideButtonCallbacks => ({
        onSource: () => {
          currentMode = currentMode === "source" ? "view" : "source";
          if (currentMode === "source") doRenderSource();
          else doRenderView();
        },
        onColumnToggle: () => {
          currentColumns = currentColumns > 1 ? 1 : 2;
          doRenderView();
        },
        onEdit: () => {
          currentMode = "edit";
          doRenderEdit();
        },
        onSave: () => {},
        onSaveAsNew: () => {},
        onCancel: () => {
          currentMode = "view";
          doRenderView();
        },
        onDeleteBlock: () => {
          // Delete the {{ref}} text from the document
          try {
            const pos = view.posAtDOM(container);
            if (pos !== undefined) {
              view.dispatch({
                changes: { from: pos, to: pos + refText.length, insert: "" },
              });
            }
          } catch { /* widget may no longer be in doc */ }
        },
        onDeleteEntity: async () => {
          if (!managerRef) return;
          const count = await managerRef.countReferences(entity.slug);
          let msg = `Delete "${entity.name}" from ${entity.compendium}?`;
          if (count > 0) {
            msg += `\n\n${count} reference${count === 1 ? "" : "s"} will break.`;
          }
          if (confirm(msg)) {
            try {
              const pos = view.posAtDOM(container);
              if (pos !== undefined) {
                view.dispatch({
                  changes: { from: pos, to: pos + refText.length, insert: "" },
                });
              }
            } catch { /* ignore */ }
            await managerRef.deleteEntity(entity.slug);
          }
        },
      });

      // Initial render
      doRenderView();

      // Prevent Logseq click-through
      container.addEventListener("mousedown", (e: MouseEvent) => e.stopPropagation());
      container.addEventListener("click", (e: MouseEvent) => e.stopPropagation());

      return container;
    }
```

- [ ] **Step 3: Run all tests to verify nothing broke**

Run: `cd ~/w/archivist-logseq && npx vitest run`

Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
cd ~/w/archivist-logseq && git add src/extensions/compendium-ref-extension.ts
git commit -m "feat: add side buttons, source toggle, edit mode, and delete to compendium ref widget"
```

---

### Task 8: CSS Additions

**Files:**
- Modify: `src/styles/archivist-dnd.css`

- [ ] **Step 1: Add inline tag, compendium ref, and completion CSS**

Append the following to the end of `src/styles/archivist-dnd.css`:

```css
/* ===========================================================================
   Phase 4: CM6 Extension Styles
   =========================================================================== */

/* --- Inline tag pills in CM6 editor --- */
.cm-editor .archivist-inline-tag-widget {
  display: inline;
  vertical-align: baseline;
}

.cm-editor .archivist-inline-tag-widget .archivist-stat-tag {
  display: inline-flex;
  align-items: center;
  vertical-align: baseline;
  font-size: 0.9em;
  line-height: 1.4;
  cursor: default;
}

/* --- Compendium ref container --- */
.archivist-compendium-ref {
  position: relative;
  margin: 8px 0;
  border-radius: 4px;
}

.archivist-compendium-badge {
  position: absolute;
  top: 4px;
  right: 40px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #922610;
  background: rgba(253, 241, 220, 0.9);
  border: 1px solid #d9c484;
  border-radius: 3px;
  padding: 1px 6px;
  pointer-events: none;
  z-index: 1;
}

/* --- Compendium ref error / not found --- */
.archivist-compendium-ref-error {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: #fdf1dc;
  border: 1px dashed #d9c484;
  border-radius: 4px;
  color: #7a200d;
  font-family: 'Noto Sans', 'Helvetica Neue', sans-serif;
  font-size: 13px;
}

.archivist-not-found-icon {
  flex-shrink: 0;
  color: #922610;
}

.archivist-not-found-icon .archivist-icon svg {
  width: 24px;
  height: 24px;
}

.archivist-not-found-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.archivist-not-found-label {
  font-weight: 600;
  color: #922610;
}

.archivist-not-found-ref {
  font-family: monospace;
  font-size: 12px;
  color: #7a200d;
  opacity: 0.7;
}

/* --- Completion dropdown parchment theme --- */
.cm-tooltip-autocomplete {
  background: #fdf1dc !important;
  border: 1px solid #d9c484 !important;
  border-radius: 4px !important;
  font-family: 'Noto Sans', 'Helvetica Neue', sans-serif !important;
  font-size: 13px !important;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) !important;
}

.cm-tooltip-autocomplete ul li {
  padding: 4px 8px !important;
  color: #7a200d !important;
}

.cm-tooltip-autocomplete ul li[aria-selected] {
  background: #922610 !important;
  color: #fdf1dc !important;
}

.cm-tooltip-autocomplete .cm-completionDetail {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  opacity: 0.7;
  margin-left: 8px;
}

.cm-tooltip-autocomplete .cm-completionInfo {
  font-size: 10px;
  opacity: 0.5;
}
```

- [ ] **Step 2: Run all tests to verify nothing broke**

Run: `cd ~/w/archivist-logseq && npx vitest run`

Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
cd ~/w/archivist-logseq && git add src/styles/archivist-dnd.css
git commit -m "feat: add Phase 4 CSS for inline tags, compendium refs, and autocomplete"
```

---

### Task 9: Wire Extensions into Plugin Entry Point

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add imports for the new extensions**

Add these imports at the top of `src/index.ts`:

```typescript
import { createInlineTagExtension } from "./extensions/inline-tag-extension";
import { createCompendiumRefExtension, setCompendiumRefRegistry, setCompendiumRefManager } from "./extensions/compendium-ref-extension";
import { createCompendiumCompletion, setCompendiumSuggestRegistry } from "./extensions/compendium-suggest";
```

- [ ] **Step 2: Wire registry/manager refs and register extensions**

At the end of `main()`, after the `initEntitySearch(registry);` line and before the console.log, add:

```typescript
  // --- Phase 4: CM6 Editor Extensions ---
  setCompendiumRefRegistry(registry);
  setCompendiumRefManager(manager);
  setCompendiumSuggestRegistry(registry);

  logseq.Experiments.registerExtensionsEnhancer("codemirror", async (cm: any) => {
    const extensions: any[] = [];

    // Inline tag pills
    extensions.push(createInlineTagExtension(cm));

    // Compendium ref stat blocks
    const { plugin: refPlugin } = createCompendiumRefExtension(cm);
    extensions.push(refPlugin);

    // Compendium autocomplete (may not be available if CM6 autocomplete module is missing)
    const completion = createCompendiumCompletion(cm);
    if (completion && (!Array.isArray(completion) || completion.length > 0)) {
      extensions.push(completion);
    }

    return extensions;
  });
```

- [ ] **Step 3: Update the console.log**

Change the existing console.log to:

```typescript
  console.log("Archivist TTRPG Blocks loaded (Phase 1 + 2 + 3 + 4 CM6 extensions)");
```

- [ ] **Step 4: Run all tests**

Run: `cd ~/w/archivist-logseq && npx vitest run`

Expected: All tests PASS.

- [ ] **Step 5: Build and verify**

Run: `cd ~/w/archivist-logseq && npm run build`

Expected: Build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
cd ~/w/archivist-logseq && git add src/index.ts
git commit -m "feat: wire Phase 4 CM6 extensions into plugin entry point"
```

---

### Task 10: Manual Integration Testing in Logseq

**Files:** None (manual testing only)

- [ ] **Step 1: Build and load in Logseq**

Run: `cd ~/w/archivist-logseq && npm run build`

Load the updated plugin in Logseq.

- [ ] **Step 2: Test inline tag pills**

In a regular Logseq block (not inside a fenced code block), type:

```
This does `dice:2d6+3` damage with `atk:+7` to hit against `dc:15`
```

Verify:
- Each backtick tag renders as a styled pill (dice, attack, DC)
- Moving cursor into a pill reveals the raw backtick text for editing
- Moving cursor away re-renders the pill
- Regular code spans (like `` `const x = 5` ``) are NOT decorated

- [ ] **Step 3: Test compendium refs (requires SRD imported)**

If SRD is not imported, import it via Cmd+Shift+P > "Archivist: Import SRD Compendium" first.

In a regular block, type:

```
{{monster:goblin}}
```

Verify:
- The `{{monster:goblin}}` text is replaced with a rendered Goblin stat block
- A compendium badge shows "SRD" in the top-right
- Side buttons appear: source toggle, column toggle, edit, trash
- Source toggle shows/hides raw YAML
- Column toggle switches between 1-column and 2-column (monsters only)
- Edit mode opens with the full edit form from Phase 3
- Trash sub-menu shows "remove ref" and "delete entity" options

- [ ] **Step 4: Test autocomplete**

In a regular block, type `{{` and then start typing a name (e.g., `gob`).

Verify:
- A completion dropdown appears with matching entities
- Arrow keys navigate, Enter selects
- Selecting inserts `{{monster:goblin}}` (or the appropriate type:slug)
- Typed prefixes work: `{{monster:gob` filters to monsters only

- [ ] **Step 5: Test edge cases**

- Type `{{nonexistent:slug}}` -- should show "Entity not found" error block
- Type `{{monster:goblin}}` then place cursor inside -- should reveal raw text
- Multiple refs on the same page -- all should render independently
- Inline tags inside fenced code blocks (Phase 1) should still work as before

- [ ] **Step 6: Document any issues found**

If the `{{...}}` syntax is intercepted by Logseq's macro system (spec Section 6 risk), document the behavior and decide on the fallback approach. If other issues arise, create follow-up tasks.

---

### Task 11: Run All Tests & Final Commit

**Files:** None

- [ ] **Step 1: Run full test suite**

Run: `cd ~/w/archivist-logseq && npx vitest run`

Expected: All tests PASS.

- [ ] **Step 2: Final status check**

```bash
cd ~/w/archivist-logseq && git status && git log --oneline -15
```

Verify all Phase 4 work is committed. If there are any uncommitted changes from integration testing fixes, stage and commit them:

```bash
cd ~/w/archivist-logseq && git add -A
git commit -m "chore: Phase 4 complete -- inline tags, compendium refs, autocomplete"
```
