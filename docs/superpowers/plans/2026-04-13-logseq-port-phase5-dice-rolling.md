# Phase 5: Dice Rolling System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add click-to-roll dice with 3D physics animation to the Logseq Archivist plugin, forked from the Obsidian dice-roller (MIT).

**Architecture:** Three layers — dice engine (moo lexer + shunting-yard parser + DiceRoller evaluation), 3D renderer (Three.js + cannon-es physics overlay on host document), click wiring (data attributes on rollable pills + click handlers). All forked code is cloned from `Obsidian-TTRPG-Community/dice-roller`, stripped of Obsidian deps, and adapted for Logseq's iframe plugin runtime.

**Tech Stack:** TypeScript, moo (tokenizer), Three.js (3D rendering), cannon-es (physics), Vitest, `@logseq/libs`

**Source repo for forking:** https://github.com/Obsidian-TTRPG-Community/dice-roller (MIT license, v11.4.2)

---

### Task 1: Install Dependencies & Clone Source Reference

**Files:**
- Modify: `~/w/archivist-logseq/package.json`

- [ ] **Step 1: Install runtime and dev dependencies**

Run:
```bash
cd ~/w/archivist-logseq && npm install moo three cannon-es && npm install -D @types/moo @types/three
```

- [ ] **Step 2: Clone the dice-roller repo for reference**

Run:
```bash
git clone --depth 1 https://github.com/Obsidian-TTRPG-Community/dice-roller.git /tmp/dice-roller-ref
```

This reference copy is used by subsequent tasks to fork source files. Do NOT modify it.

- [ ] **Step 3: Verify build still works**

Run: `cd ~/w/archivist-logseq && npm run build`

Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
cd ~/w/archivist-logseq && git add package.json package-lock.json
git commit -m "chore: add moo, three, cannon-es dependencies for Phase 5 dice rolling"
```

---

### Task 2: Types, Interfaces & Base Classes

**Files:**
- Create: `src/dice/types.ts`
- Create: `src/dice/renderable.ts`
- Create: `src/dice/roller.ts`

These are leaf files with zero internal dependencies. They define the type foundation.

- [ ] **Step 1: Create `src/dice/types.ts`**

```typescript
export enum Round {
  None = "None",
  Normal = "Normal",
  Up = "Up",
  Down = "Down",
}

export enum ExpectedValue {
  None = "None",
  Average = "Average",
  Roll = "Roll",
}

export interface RollerOptions {
  shouldRender?: boolean;
  expectedValue?: ExpectedValue;
  round?: Round;
}
```

- [ ] **Step 2: Create `src/dice/renderable.ts`**

```typescript
import type { DiceShape } from "./renderer/shapes";

export interface RenderableDice<T> {
  canRender(): boolean;
  getType(): RenderTypes;
  roll(): Promise<void>;
  rollSync(): void;
  render(abortController: AbortController): Promise<void>;
  shouldRender: boolean;
  getValue(shapes?: DiceShape[]): Promise<T>;
  getValueSync(): T;
}

export const RenderTypes = {
  NONE: "none",
  D4: "D4",
  D6: "D6",
  D8: "D8",
  D10: "D10",
  D12: "D12",
  D20: "D20",
  D100: "D100",
  FUDGE: "fudge",
  STUNT: "stunt",
} as const;
export type RenderTypes = (typeof RenderTypes)[keyof typeof RenderTypes];
```

- [ ] **Step 3: Create `src/dice/roller.ts`**

```typescript
import type { LexicalToken } from "./lexer";
import type { RenderableDice } from "./renderable";

export abstract class Roller<T> {
  abstract roll(): Promise<T>;

  getRandomBetween(min: number, max: number): number {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return Math.floor((buf[0] / (0xffffffff + 1)) * (max - min + 1)) + min;
  }
}

export abstract class RenderableRoller<T> extends Roller<T> {
  lexemes: LexicalToken[] = [];
  shouldRender = false;
  isRendering = false;
  children: RenderableDice<any>[] = [];

  abstract rollSync(): T;
  abstract get result(): T;

  async renderChildren(): Promise<void> {
    const controller = new AbortController();
    const promises = this.children
      .filter((c) => c.shouldRender && c.canRender())
      .map((c) => c.render(controller));
    await Promise.allSettled(promises);
  }
}
```

- [ ] **Step 4: Verify build**

Run: `cd ~/w/archivist-logseq && npm run build`

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
cd ~/w/archivist-logseq && git add src/dice/types.ts src/dice/renderable.ts src/dice/roller.ts
git commit -m "feat: add dice engine types, interfaces, and base roller classes"
```

---

### Task 3: Forked Lexer — Tests & Implementation

**Files:**
- Create: `tests/dice/lexer.test.ts`
- Create: `src/dice/lexer.ts`

The lexer tokenizes dice notation strings like `"2d6+3"`, `"4d6kh3"`, `"1d20+5"` into a stream of typed tokens, then converts to reverse-polish notation via shunting-yard parsing.

- [ ] **Step 1: Write lexer tests**

Create `tests/dice/lexer.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { Lexer } from "@/dice/lexer";

describe("Lexer", () => {
  describe("parse", () => {
    it("parses simple dice expression", () => {
      const result = Lexer.parse("2d6");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBe(1);
        expect(result.data[0].type).toBe("dice");
        expect(result.data[0].value).toBe("2d6");
      }
    });

    it("parses dice with addition", () => {
      const result = Lexer.parse("1d20+5");
      expect(result.success).toBe(true);
      if (result.success) {
        const types = result.data.map((t) => t.type);
        expect(types).toContain("dice");
        expect(types).toContain("math");
      }
    });

    it("parses keep-high modifier", () => {
      const result = Lexer.parse("4d6kh3");
      expect(result.success).toBe(true);
      if (result.success) {
        const diceToken = result.data.find((t) => t.type === "dice");
        expect(diceToken).toBeDefined();
      }
    });

    it("parses fudge dice", () => {
      const result = Lexer.parse("4dF");
      expect(result.success).toBe(true);
      if (result.success) {
        const fudge = result.data.find((t) => t.type === "fudge");
        expect(fudge).toBeDefined();
      }
    });

    it("parses complex expression", () => {
      const result = Lexer.parse("2d6+1d4+3");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBeGreaterThan(0);
      }
    });

    it("parses percentage dice", () => {
      const result = Lexer.parse("1d100");
      expect(result.success).toBe(true);
    });

    it("parses exploding dice", () => {
      const result = Lexer.parse("2d6!");
      expect(result.success).toBe(true);
    });

    it("parses reroll modifier", () => {
      const result = Lexer.parse("2d6r1");
      expect(result.success).toBe(true);
    });

    it("returns error for empty input", () => {
      const result = Lexer.parse("");
      expect(result.success).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/w/archivist-logseq && npx vitest run tests/dice/lexer.test.ts`

Expected: FAIL with module not found.

- [ ] **Step 3: Fork the lexer**

Read `/tmp/dice-roller-ref/src/lexer/lexer.ts` (322 lines). Create `src/dice/lexer.ts` by applying these transformations:

**Imports -- replace:**
```typescript
// REMOVE these:
import * as moo from "moo";
import { Err, Ok, type Result } from "@sniptt/monads";
import { DataviewManager } from "src/api/api.dataview";
import type { Conditional } from "src/rollers/dice/dice";

// REPLACE with:
import moo from "moo";
```

**ParseResult type -- add at top** (replaces `@sniptt/monads` Result):
```typescript
export type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };
```

**Conditional type -- add** (was imported from dice.ts):
```typescript
export interface Conditional {
  operator: string;
  comparer: string | number;
  lexemes: LexicalToken[];
  value: string;
  result?: number;
}
```

**Token grammar -- strip these token rules from the `moo.compile()` call:**
- `table` (Obsidian file link)
- `line` (Obsidian file link + `|line`)
- `section` (Obsidian file link)
- `tag` (`#tag` roller)
- `dataview` (`dv()` expression)
- `narrative` (Genesys dice)

Keep all other token rules: `WS`, `condition`, `kl`, `kh`, `dh`, `dl`, `!!`, `!`, `r`, `u`, `stunt`, `%`, `fudge`, `dice`, `sort`, `math`.

**Dice token value function -- strip DataviewManager:**
In the `dice` token definition, the `value` function calls `DataviewManager.getFieldValueFromActiveFile(match)`. Remove this branch. Unknown identifiers should remain as-is (they'll fail at roll time if not valid numbers).

**`parse()` return type -- change from `Result` to `ParseResult`:**
```typescript
// BEFORE: return Ok(tokens) / return Err("message")
// AFTER:  return { success: true, data: tokens } / return { success: false, error: "message" }
```

**Singleton export:**
```typescript
export const Lexer = new LexerClass();
```

Keep the `Parser` class (shunting-yard), `LexicalToken` interface, `LexerClass`, and `transform()` method entirely intact.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/w/archivist-logseq && npx vitest run tests/dice/lexer.test.ts`

Expected: All 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/w/archivist-logseq && git add src/dice/lexer.ts tests/dice/lexer.test.ts
git commit -m "feat: fork dice notation lexer from obsidian dice-roller (MIT)"
```

---

### Task 4: Forked DiceRoller + Small Rollers -- Tests & Implementation

**Files:**
- Create: `tests/dice/dice-roller.test.ts`
- Create: `src/dice/dice-roller.ts`
- Create: `src/dice/fudge-roller.ts`
- Create: `src/dice/percent-roller.ts`
- Create: `src/dice/stunt-roller.ts`

- [ ] **Step 1: Write DiceRoller tests**

Create `tests/dice/dice-roller.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { DiceRoller } from "@/dice/dice-roller";

describe("DiceRoller", () => {
  it("rolls a single d6", async () => {
    const roller = new DiceRoller("1d6");
    await roller.roll();
    expect(roller.result).toBeGreaterThanOrEqual(1);
    expect(roller.result).toBeLessThanOrEqual(6);
  });

  it("rolls multiple dice", async () => {
    const roller = new DiceRoller("3d6");
    await roller.roll();
    expect(roller.result).toBeGreaterThanOrEqual(3);
    expect(roller.result).toBeLessThanOrEqual(18);
  });

  it("handles a d20", async () => {
    const roller = new DiceRoller("1d20");
    await roller.roll();
    expect(roller.result).toBeGreaterThanOrEqual(1);
    expect(roller.result).toBeLessThanOrEqual(20);
  });

  it("handles static numbers", async () => {
    const roller = new DiceRoller("5");
    await roller.roll();
    expect(roller.result).toBe(5);
  });

  it("rollSync works", () => {
    const roller = new DiceRoller("2d6");
    roller.rollSync();
    expect(roller.result).toBeGreaterThanOrEqual(2);
    expect(roller.result).toBeLessThanOrEqual(12);
  });

  it("canRender returns true for standard dice", () => {
    const roller = new DiceRoller("1d20");
    expect(roller.canRender()).toBe(true);
  });

  it("canRender returns false for custom ranges", () => {
    const roller = new DiceRoller("1d[2,4,6]");
    expect(roller.canRender()).toBe(false);
  });

  it("keeps high with kh modifier", async () => {
    const roller = new DiceRoller("4d6");
    roller.modifiers.set("kh", { conditionals: [], data: 3, value: "kh3" });
    await roller.roll();
    expect(roller.result).toBeGreaterThanOrEqual(3);
    expect(roller.result).toBeLessThanOrEqual(18);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/w/archivist-logseq && npx vitest run tests/dice/dice-roller.test.ts`

Expected: FAIL with module not found.

- [ ] **Step 3: Fork the DiceRoller**

Read `/tmp/dice-roller-ref/src/rollers/dice/dice.ts` (689 lines). Create `src/dice/dice-roller.ts` by applying these transformations:

**Imports -- replace:**
```typescript
// REMOVE all obsidian and src/ imports

// REPLACE with:
import type { LexicalToken, Conditional } from "./lexer";
import type { DiceShape } from "./renderer/shapes";
import type { RenderableDice } from "./renderable";
import { RenderTypes } from "./renderable";
```

**Base class:** DiceRoller should NOT extend any Obsidian class. It implements `RenderableDice<number>` directly. Inline the crypto-secure random from Roller:

```typescript
export class DiceRoller implements RenderableDice<number> {
  protected getRandomBetween(min: number, max: number): number {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return Math.floor((buf[0] / (0xffffffff + 1)) * (max - min + 1)) + min;
  }

  // Replace Math.random() in getRandomValue():
  getRandomValue(): number {
    return this.possibilities[this.getRandomBetween(0, this.possibilities.length - 1)];
  }
}
```

**Replace `Notice` calls (3 occurrences)** with `console.warn("[archivist dice]", ...)`.

**Replace `_insertIntoMap` utility** -- inline it:
```typescript
function insertIntoMap<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.set(key, value);
}
```

**DiceRenderer references:** Add lazy ref pattern to avoid circular deps:
```typescript
let diceRendererRef: any = null;
export function setDiceRendererRef(renderer: any): void {
  diceRendererRef = renderer;
}
```
Use `diceRendererRef` instead of `DiceRenderer` in `getValue()`.

**BasicStackRoller forward reference:** Add lazy class ref for `checkCondition()`:
```typescript
let BasicStackRollerClass: any = null;
export function setBasicStackRollerClass(cls: any): void {
  BasicStackRollerClass = cls;
}
```

**Keep everything else intact:** constructor, `roll()`, `rollSync()`, all modifier methods, `canRender()`, `getType()`, `faces` getter, `result` getter, `display` getter, `applyModifiers()`, `applyConditions()`.

**Export types:**
```typescript
export type { Conditional, ResultMapInterface, ResultInterface };
export type Modifier = { conditionals: Conditional[]; data: number; value: string };
```

- [ ] **Step 4: Create small roller files**

Create `src/dice/fudge-roller.ts`:
```typescript
import { DiceRoller } from "./dice-roller";
import { RenderTypes } from "./renderable";

export class FudgeRoller extends DiceRoller {
  override getType() { return RenderTypes.FUDGE; }
  override canRender() { return true; }
  possibilities: number[] = [-1, 0, 1];
}
```

Create `src/dice/percent-roller.ts`:
Copy from `/tmp/dice-roller-ref/src/rollers/dice/percentage.ts` (50 lines), changing only import paths:
- `"src/lexer/lexer"` to `"./lexer"`
- `"./dice"` to `"./dice-roller"`

Create `src/dice/stunt-roller.ts`:
Copy from `/tmp/dice-roller-ref/src/rollers/dice/stunt.ts` (55 lines), changing only import paths:
- `"src/lexer/lexer"` to `"./lexer"`
- `"./dice"` to `"./dice-roller"`

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd ~/w/archivist-logseq && npx vitest run tests/dice/dice-roller.test.ts`

Expected: All 8 tests PASS.

- [ ] **Step 6: Commit**

```bash
cd ~/w/archivist-logseq && git add src/dice/dice-roller.ts src/dice/fudge-roller.ts src/dice/percent-roller.ts src/dice/stunt-roller.ts tests/dice/dice-roller.test.ts
git commit -m "feat: fork DiceRoller and small roller classes from dice-roller (MIT)"
```

---

### Task 5: Forked StackRoller -- Tests & Implementation

**Files:**
- Create: `tests/dice/stack-roller.test.ts`
- Create: `src/dice/stack-roller.ts`

The StackRoller evaluates full dice expressions (e.g., `2d6+1d4+3`, `4d6kh3`) by walking the shunting-yard RPN output, creating DiceRoller instances, and evaluating math operators.

- [ ] **Step 1: Write StackRoller tests**

Create `tests/dice/stack-roller.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { Lexer } from "@/dice/lexer";
import { StackRoller, BasicStackRoller } from "@/dice/stack-roller";

describe("BasicStackRoller", () => {
  it("evaluates a simple dice roll", () => {
    const result = Lexer.parse("1d6");
    expect(result.success).toBe(true);
    if (!result.success) return;
    const roller = new BasicStackRoller(result.data);
    const value = roller.rollSync();
    expect(value).toBeGreaterThanOrEqual(1);
    expect(value).toBeLessThanOrEqual(6);
  });

  it("evaluates a static number", () => {
    const result = Lexer.parse("5");
    expect(result.success).toBe(true);
    if (!result.success) return;
    const roller = new BasicStackRoller(result.data);
    const value = roller.rollSync();
    expect(value).toBe(5);
  });

  it("evaluates addition", () => {
    const result = Lexer.parse("3+4");
    expect(result.success).toBe(true);
    if (!result.success) return;
    const roller = new BasicStackRoller(result.data);
    const value = roller.rollSync();
    expect(value).toBe(7);
  });

  it("evaluates multiplication", () => {
    const result = Lexer.parse("3*4");
    expect(result.success).toBe(true);
    if (!result.success) return;
    const roller = new BasicStackRoller(result.data);
    const value = roller.rollSync();
    expect(value).toBe(12);
  });
});

describe("StackRoller", () => {
  it("evaluates 2d6+3", async () => {
    const result = Lexer.parse("2d6+3");
    expect(result.success).toBe(true);
    if (!result.success) return;
    const roller = new StackRoller(result.data);
    await roller.roll();
    expect(roller.result).toBeGreaterThanOrEqual(5);
    expect(roller.result).toBeLessThanOrEqual(15);
  });

  it("evaluates 1d20+5", async () => {
    const result = Lexer.parse("1d20+5");
    expect(result.success).toBe(true);
    if (!result.success) return;
    const roller = new StackRoller(result.data);
    await roller.roll();
    expect(roller.result).toBeGreaterThanOrEqual(6);
    expect(roller.result).toBeLessThanOrEqual(25);
  });

  it("evaluates rollSync", () => {
    const result = Lexer.parse("2d6+3");
    expect(result.success).toBe(true);
    if (!result.success) return;
    const roller = new StackRoller(result.data);
    roller.rollSync();
    expect(roller.result).toBeGreaterThanOrEqual(5);
    expect(roller.result).toBeLessThanOrEqual(15);
  });

  it("evaluates complex expression 2d6+1d4+3", async () => {
    const result = Lexer.parse("2d6+1d4+3");
    expect(result.success).toBe(true);
    if (!result.success) return;
    const roller = new StackRoller(result.data);
    await roller.roll();
    expect(roller.result).toBeGreaterThanOrEqual(6);
    expect(roller.result).toBeLessThanOrEqual(19);
  });

  it("evaluates subtraction", async () => {
    const result = Lexer.parse("10-3");
    expect(result.success).toBe(true);
    if (!result.success) return;
    const roller = new StackRoller(result.data);
    await roller.roll();
    expect(roller.result).toBe(7);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/w/archivist-logseq && npx vitest run tests/dice/stack-roller.test.ts`

Expected: FAIL with module not found.

- [ ] **Step 3: Fork the StackRoller**

Read `/tmp/dice-roller-ref/src/rollers/dice/stack.ts` (742 lines). Create `src/dice/stack-roller.ts` by applying these transformations:

**Imports -- replace:**
```typescript
// REMOVE all obsidian and src/ imports

// REPLACE with:
import type { LexicalToken } from "./lexer";
import { Roller, RenderableRoller } from "./roller";
import { DiceRoller, setBasicStackRollerClass } from "./dice-roller";
import { FudgeRoller } from "./fudge-roller";
import { PercentRoller } from "./percent-roller";
import { StuntRoller } from "./stunt-roller";
import type { RenderableDice } from "./renderable";
```

**`BasicStackRoller` -- change base class:**
```typescript
// BEFORE: extends Roller<number> (which extends Component)
export class BasicStackRoller extends Roller<number> {
```
Keep all `parseLexemes()` logic intact. It only uses `roll()` and `rollSync()`.

**`StackRoller` -- change base class and strip DOM:**
```typescript
export class StackRoller extends RenderableRoller<number> {
```

Strip from `StackRoller`:
- Remove `App` from constructor -- replace with just `lexemes: LexicalToken[]`
- Remove the entire `build()` method (~200 lines)
- Remove `onClick()`, `getTooltip()`, `getReplacer()`
- Remove `app.workspace.trigger()` calls
- Remove `Notice` calls
- Remove `inlineText` getter, `setSpinner()`, `save` property
- Remove `expectedValue`, `round`, `signed`, `showRenderNotice`, `showFormula`, `fixedText`, `displayFixedText` properties

Keep from `StackRoller`:
- Constructor taking `lexemes: LexicalToken[]`
- `operators` map for arithmetic
- `buildDiceTree()`, `calculate()`, `roll(render?)`, `rollSync()`
- `children`, `stack`, `stackCopy`, `result`, `dice` getter

**Wire circular dependency at bottom of file:**
```typescript
setBasicStackRollerClass(BasicStackRoller);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/w/archivist-logseq && npx vitest run tests/dice/stack-roller.test.ts`

Expected: All 9 tests PASS.

- [ ] **Step 5: Run all dice tests**

Run: `cd ~/w/archivist-logseq && npx vitest run tests/dice/`

Expected: All tests PASS (lexer + dice-roller + stack-roller).

- [ ] **Step 6: Commit**

```bash
cd ~/w/archivist-logseq && git add src/dice/stack-roller.ts tests/dice/stack-roller.test.ts
git commit -m "feat: fork StackRoller expression evaluator from dice-roller (MIT)"
```

---

### Task 6: 3D Renderer Foundation -- Resource Tracker, Geometries, Shapes

**Files:**
- Create: `src/dice/renderer/resource.ts`
- Create: `src/dice/renderer/geometries.ts`
- Create: `src/dice/renderer/shapes.ts`

These are the Three.js + cannon-es files. No Vitest tests (require WebGL context). Verified via build.

- [ ] **Step 1: Create `src/dice/renderer/resource.ts`**

Copy verbatim from `/tmp/dice-roller-ref/src/renderer/resource.ts` (71 lines). No changes needed -- pure Three.js disposal logic with zero Obsidian dependencies.

- [ ] **Step 2: Fork `src/dice/renderer/geometries.ts`**

Read `/tmp/dice-roller-ref/src/renderer/geometries.ts` (1156 lines). Create `src/dice/renderer/geometries.ts` by applying these transformations:

**Imports -- keep as-is** (all from `three` and `cannon-es`).

**Strip Genesys geometry classes** -- remove everything after `StuntDiceGeometry`:
- Remove `GenesysDice` abstract class and all 7 concrete Genesys geometries
- Remove these from exports

**Fix Obsidian dep in `DiceGeometry.createTextTexture()` and `D4DiceGeometry.createTextTexture()`:**
```typescript
// BEFORE: const canvas = createEl("canvas");
// AFTER:  const canvas = document.createElement("canvas");
```

**Keep intact:** `DiceGeometry` abstract base, `DiceOptions` interface, D4/D6/D8/D10/D100/D12/D20/Fudge/Stunt geometry classes.

**Update exports:**
```typescript
export {
  D100DiceGeometry, D20DiceGeometry, D12DiceGeometry, D10DiceGeometry,
  D8DiceGeometry, D6DiceGeometry, D4DiceGeometry, FudgeDiceGeometry,
  StuntDiceGeometry,
};
export type { DiceOptions };
```

- [ ] **Step 3: Fork `src/dice/renderer/shapes.ts`**

Read `/tmp/dice-roller-ref/src/renderer/shapes.ts` (538 lines). Create `src/dice/renderer/shapes.ts` by applying these transformations:

**Import paths -- change to local:**
```typescript
// BEFORE: import { ...Geometry } from "src/renderer/geometries";
// AFTER:  import { ...Geometry } from "./geometries";
```

**Strip Genesys shape classes:** Remove `BoostDice`, `SetbackDice`, `AbilityDice`, `DifficultyDice`, `ProficiencyDice`, `ChallengeDice`, `ForceDice`, and `Dice` (generic Genesys shape).

**Keep:** `DiceShape` abstract base (with `getUpsideValue()`, `set()`, `create()`, `generateVector()`), D4/D6/D8/D10/D12/D20/D100/Fudge/Stunt dice shapes.

**Export all kept classes.**

- [ ] **Step 4: Verify build**

Run: `cd ~/w/archivist-logseq && npm run build`

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
cd ~/w/archivist-logseq && git add src/dice/renderer/resource.ts src/dice/renderer/geometries.ts src/dice/renderer/shapes.ts
git commit -m "feat: fork 3D dice geometries and shapes from dice-roller (MIT)"
```

---

### Task 7: 3D Dice Renderer

**Files:**
- Create: `src/dice/renderer/dice-renderer.ts`

The main renderer class: Three.js scene, cannon-es physics world, animation loop, overlay management.

- [ ] **Step 1: Fork the renderer**

Read `/tmp/dice-roller-ref/src/renderer/renderer.ts` (983 lines). Create `src/dice/renderer/dice-renderer.ts` by applying these transformations:

**Imports -- replace:**
```typescript
// REMOVE all obsidian imports (Component, Events, debounce)

// REPLACE with Three.js, cannon-es, and local imports:
import {
  Scene, PerspectiveCamera, WebGLRenderer as ThreeWebGLRenderer,
  SpotLight, AmbientLight, Mesh, PlaneGeometry, ShadowMaterial,
  PCFSoftShadowMap, Vector3
} from "three";
import {
  World, Body, Vec3, Plane, ContactMaterial,
  Material as CannonMaterial, NaiveBroadphase
} from "cannon-es";
import { ResourceTracker } from "./resource";
import {
  D4Dice, D6Dice, D8Dice, D10Dice, D12Dice, D20Dice, D100Dice,
  FudgeDice, StuntDice, type DiceShape
} from "./shapes";
import {
  D4DiceGeometry, D6DiceGeometry, D8DiceGeometry, D10DiceGeometry,
  D100DiceGeometry, D12DiceGeometry, D20DiceGeometry,
  FudgeDiceGeometry, StuntDiceGeometry, type DiceOptions
} from "./geometries";
import { RenderTypes } from "../renderable";
import type { DiceRoller } from "../dice-roller";
```

**Class -- strip Component/Events base:**
```typescript
export class DiceRendererClass {
  private hostDocument: Document | null = null;
  private container: HTMLDivElement | null = null;
  private loaded = false;
  private cleanupFns: (() => void)[] = [];
  renderTime = 3000;
  // ... rest of properties from original
}
```

**Replace Obsidian helpers:**
- `createDiv()` -> `this.hostDocument!.createElement("div")`
- `document.body` -> `this.hostDocument!.body`
- `onload()` -> `load(hostDoc: Document): void`
- `onunload()` -> `unload(): void`
- `registerDomEvent(el, event, handler)` -> direct addEventListener with cleanup array
- `registerInterval(fn, ms)` -> setInterval with cleanup array
- `debounce(fn, ms)` -> inline 3-line setTimeout debounce

**Replace Events `trigger("throw-finished")`:** Use `WeakMap<DiceShape[], () => void>` for pending resolve callbacks.

**Strip `DiceFactory` into inline methods:** Move `buildDice()`, `getDiceForRoller()`, `clone()` directly into `DiceRendererClass`. Remove Genesys cases from `getDiceForRoller()`.

**Container overlay:**
```typescript
private createContainer(): HTMLDivElement {
  const div = this.hostDocument!.createElement("div");
  div.className = "archivist-dice-renderer";
  Object.assign(div.style, {
    position: "fixed", inset: "0", zIndex: "99999",
    pointerEvents: "all", transition: "opacity 0.5s",
  });
  return div;
}
```

**Keep intact (with local path fixes):**
- `LocalWorld` class (cannon-es physics, walls, contact materials, gravity `(0,0,-9.82*200)`)
- `initScene()`, `initCamera()`, `initLighting()`, `initDesk()`
- `render()` animation loop with `requestAnimationFrame`
- `throwFinished()` velocity threshold check (< 5, timeout > 10s)
- `addDice()` returns Promise resolving when dice stop
- `getDiceForRoller()` switch on RenderTypes for D4-D20/D100/Fudge/Stunt
- `start()` / `stop()` lifecycle
- `unrender()` fade-out (opacity 0, then remove + dispose after 500ms)
- `getVector()` random position generation

**Singleton export:**
```typescript
export let diceRenderer: DiceRendererClass | null = null;

export function initDiceRenderer(hostDoc: Document, renderTime?: number): DiceRendererClass {
  diceRenderer = new DiceRendererClass();
  if (renderTime !== undefined) diceRenderer.renderTime = renderTime;
  diceRenderer.load(hostDoc);
  return diceRenderer;
}
```

- [ ] **Step 2: Verify build**

Run: `cd ~/w/archivist-logseq && npm run build`

Expected: Build succeeds. Fix any type errors from the transformation.

- [ ] **Step 3: Commit**

```bash
cd ~/w/archivist-logseq && git add src/dice/renderer/dice-renderer.ts
git commit -m "feat: fork 3D dice renderer with host document overlay from dice-roller (MIT)"
```

---

### Task 8: DiceEngine API & Roll Entry Point -- Tests & Implementation

**Files:**
- Create: `tests/dice/engine.test.ts`
- Create: `src/dice/engine.ts`
- Create: `src/dice/roll.ts`

- [ ] **Step 1: Write DiceEngine tests**

Create `tests/dice/engine.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { DiceEngine } from "@/dice/engine";

describe("DiceEngine", () => {
  const engine = new DiceEngine();

  it("creates a roller for simple dice", () => {
    const roller = engine.getRoller("2d6+3");
    expect(roller).not.toBeNull();
  });

  it("returns null for invalid notation", () => {
    const roller = engine.getRoller("");
    expect(roller).toBeNull();
  });

  it("roller produces valid result", async () => {
    const roller = engine.getRoller("1d20+5");
    expect(roller).not.toBeNull();
    if (!roller) return;
    await roller.roll();
    expect(roller.result).toBeGreaterThanOrEqual(6);
    expect(roller.result).toBeLessThanOrEqual(25);
  });

  it("sets shouldRender from options", () => {
    const roller = engine.getRoller("1d6", { shouldRender: true });
    expect(roller).not.toBeNull();
    if (!roller) return;
    expect(roller.shouldRender).toBe(true);
  });

  it("handles complex expressions", async () => {
    const roller = engine.getRoller("4d6kh3");
    expect(roller).not.toBeNull();
    if (!roller) return;
    await roller.roll();
    expect(roller.result).toBeGreaterThanOrEqual(3);
    expect(roller.result).toBeLessThanOrEqual(18);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/w/archivist-logseq && npx vitest run tests/dice/engine.test.ts`

Expected: FAIL with module not found.

- [ ] **Step 3: Create `src/dice/engine.ts`**

```typescript
import { Lexer } from "./lexer";
import { StackRoller } from "./stack-roller";
import type { RollerOptions } from "./types";

export class DiceEngine {
  getRoller(notation: string, options?: Partial<RollerOptions>): StackRoller | null {
    const result = Lexer.parse(notation);
    if (!result.success) {
      console.warn("[archivist] Dice parse error:", result.error);
      return null;
    }
    const roller = new StackRoller(result.data);
    if (options?.shouldRender) roller.shouldRender = true;
    return roller;
  }
}
```

- [ ] **Step 4: Create `src/dice/roll.ts`**

```typescript
import { DiceEngine } from "./engine";

const engine = new DiceEngine();

export async function rollDice(notation: string): Promise<void> {
  const roller = engine.getRoller(notation, { shouldRender: true });
  if (roller) {
    await roller.roll(true);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd ~/w/archivist-logseq && npx vitest run tests/dice/engine.test.ts`

Expected: All 5 tests PASS.

- [ ] **Step 6: Run all dice tests**

Run: `cd ~/w/archivist-logseq && npx vitest run tests/dice/`

Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
cd ~/w/archivist-logseq && git add src/dice/engine.ts src/dice/roll.ts tests/dice/engine.test.ts
git commit -m "feat: add DiceEngine API and rollDice entry point"
```

---

### Task 9: Click Wiring -- Renderer Utils (extractDiceNotation + data attributes)

**Files:**
- Create: `tests/dice/extract-notation.test.ts`
- Modify: `src/renderers/renderer-utils.ts`

- [ ] **Step 1: Write tests for extractDiceNotation and isRollable**

Create `tests/dice/extract-notation.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { extractDiceNotation, isRollable } from "@/renderers/renderer-utils";

describe("isRollable", () => {
  it("dice is rollable", () => expect(isRollable("dice")).toBe(true));
  it("damage is rollable", () => expect(isRollable("damage")).toBe(true));
  it("atk is rollable", () => expect(isRollable("atk")).toBe(true));
  it("mod is rollable", () => expect(isRollable("mod")).toBe(true));
  it("dc is NOT rollable", () => expect(isRollable("dc")).toBe(false));
  it("check is NOT rollable", () => expect(isRollable("check")).toBe(false));
});

describe("extractDiceNotation", () => {
  it("passes dice content through", () => {
    expect(extractDiceNotation({ type: "dice", content: "2d6+3" })).toBe("2d6+3");
  });

  it("strips damage type text", () => {
    expect(extractDiceNotation({ type: "damage", content: "2d6+3 fire" })).toBe("2d6+3");
  });

  it("converts atk to d20 roll", () => {
    expect(extractDiceNotation({ type: "atk", content: "+7" })).toBe("1d20+7");
  });

  it("converts mod to d20 roll", () => {
    expect(extractDiceNotation({ type: "mod", content: "+3" })).toBe("1d20+3");
  });

  it("returns null for dc", () => {
    expect(extractDiceNotation({ type: "dc", content: "15" })).toBeNull();
  });

  it("returns null for check", () => {
    expect(extractDiceNotation({ type: "check", content: "Perception" })).toBeNull();
  });

  it("handles damage with no type text", () => {
    expect(extractDiceNotation({ type: "damage", content: "3d8" })).toBe("3d8");
  });

  it("handles negative modifier", () => {
    expect(extractDiceNotation({ type: "atk", content: "-1" })).toBe("1d20-1");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/w/archivist-logseq && npx vitest run tests/dice/extract-notation.test.ts`

Expected: FAIL (functions not exported yet).

- [ ] **Step 3: Add functions to `src/renderers/renderer-utils.ts`**

Add these exports near the top of the file (after existing imports):

```typescript
const ROLLABLE_TYPES = new Set(["dice", "damage", "atk", "mod"]);

export function isRollable(type: string): boolean {
  return ROLLABLE_TYPES.has(type);
}

export function extractDiceNotation(tag: { type: string; content: string }): string | null {
  switch (tag.type) {
    case "dice": return tag.content;
    case "damage": return tag.content.replace(/\s+\S+$/, "");
    case "atk": case "mod": return `1d20${tag.content}`;
    default: return null;
  }
}
```

- [ ] **Step 4: Add data attributes to `renderStatBlockTag()`**

In the `renderStatBlockTag()` function in `src/renderers/renderer-utils.ts`, modify the HTML string output to include `data-dice-notation` and `title` attributes for rollable tags. Find the line where the outer `<span class="archivist-stat-tag ...">` is built and add:

```typescript
const notation = extractDiceNotation(tag);
const dataAttrs = notation
  ? ` data-dice-notation="${escapeHtml(notation)}" title="${escapeHtml(displayText)} -- Click to roll"`
  : "";
```

Then include `${dataAttrs}` in the span's attribute list.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd ~/w/archivist-logseq && npx vitest run tests/dice/extract-notation.test.ts`

Expected: All 14 tests PASS.

- [ ] **Step 6: Commit**

```bash
cd ~/w/archivist-logseq && git add src/renderers/renderer-utils.ts tests/dice/extract-notation.test.ts
git commit -m "feat: add extractDiceNotation and data attributes on rollable stat block pills"
```

---

### Task 10: Click Wiring -- Inline Tag Observer

**Files:**
- Modify: `src/extensions/inline-tag-observer.ts`
- Modify: `src/renderers/inline-tag-renderer.ts`

- [ ] **Step 1: Add data attributes to `renderInlineTag()` in `inline-tag-renderer.ts`**

Read `src/renderers/inline-tag-renderer.ts`. Import the helpers and modify `renderInlineTag()` to add `data-dice-notation` on rollable pills:

```typescript
import { isRollable, extractDiceNotation } from "./renderer-utils";
```

In the function, compute the notation and add data attributes to the outer `<span>`:

```typescript
const notation = extractDiceNotation(tag);
const dataAttrs = notation ? ` data-dice-notation="${notation}"` : "";
// Include ${dataAttrs} in the span tag string
```

- [ ] **Step 2: Add click handlers in `inline-tag-observer.ts`**

Read `src/extensions/inline-tag-observer.ts`. Add imports:

```typescript
import { isRollable, extractDiceNotation } from "../renderers/renderer-utils";
import { rollDice } from "../dice/roll";
```

In `processCodeElements()`, after the pill wrapper is created and its content is set, add click handler wiring:

```typescript
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
```

- [ ] **Step 3: Verify build**

Run: `cd ~/w/archivist-logseq && npm run build`

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
cd ~/w/archivist-logseq && git add src/extensions/inline-tag-observer.ts src/renderers/inline-tag-renderer.ts
git commit -m "feat: add click-to-roll handlers on inline tag pills"
```

---

### Task 11: Plugin Initialization & Settings

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add dice settings to the settings schema**

In `src/index.ts`, find the `logseq.useSettingsSchema()` call. Add two new settings to the schema array:

```typescript
{
  key: "diceEnabled",
  type: "boolean",
  default: true,
  title: "Enable Dice Rolling",
  description: "Click rollable tag pills (dice, damage, attack, modifier) to trigger 3D dice animation.",
},
{
  key: "diceRenderTime",
  type: "number",
  default: 3000,
  title: "Dice Animation Duration (ms)",
  description: "How long the 3D dice overlay stays visible after dice stop rolling. Set to 0 to require a click to dismiss.",
},
```

- [ ] **Step 2: Add dice renderer initialization**

Add import at the top of `src/index.ts`:
```typescript
import { initDiceRenderer } from "./dice/renderer/dice-renderer";
import { rollDice } from "./dice/roll";
```

In `main()`, after the inline tag observer initialization block, add:

```typescript
// --- Phase 5: Dice Rolling ---
try {
  const diceHostDoc = parent?.document ?? top?.document;
  if (diceHostDoc) {
    const renderTime = (logseq.settings?.diceRenderTime as number) ?? 3000;
    initDiceRenderer(diceHostDoc, renderTime);
    console.log("[archivist] Dice renderer initialized");
  }
} catch (e) {
  console.warn("[archivist] Dice renderer setup failed:", e);
}
```

- [ ] **Step 3: Wire dice click handlers to fenced code block renderers**

In `src/index.ts`, find each fenced code block renderer's React component post-render callback (the `useEffect` or equivalent where the ref element's content is set). After the rendered HTML is placed on the DOM, add:

```typescript
// Wire dice click handlers on rollable pills
if (logseq.settings?.diceEnabled !== false) {
  ref.current.querySelectorAll(".archivist-stat-tag[data-dice-notation]").forEach((el: Element) => {
    (el as HTMLElement).style.cursor = "pointer";
    el.addEventListener("click", (e: Event) => {
      e.stopPropagation();
      const notation = (el as HTMLElement).dataset.diceNotation;
      if (notation) rollDice(notation);
    });
  });
}
```

This should be added in all three renderer components (MonsterBlock, SpellBlock, ItemBlock).

- [ ] **Step 4: Update the console.log**

Change the existing Phase log message to:
```typescript
console.log("Archivist TTRPG Blocks loaded (Phase 1 + 2 + 3 + 4 + 5 dice rolling)");
```

- [ ] **Step 5: Verify build**

Run: `cd ~/w/archivist-logseq && npm run build`

Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
cd ~/w/archivist-logseq && git add src/index.ts
git commit -m "feat: wire dice renderer initialization and click handlers into plugin entry"
```

---

### Task 12: CSS Additions

**Files:**
- Modify: `src/styles/archivist-dnd.css`

- [ ] **Step 1: Add rollable pill styles**

Append to the end of `src/styles/archivist-dnd.css`:

```css
/* ===========================================================================
   Phase 5: Rollable Pill Interaction
   =========================================================================== */

.archivist-stat-tag[data-dice-notation],
.archivist-inline-tag-widget .archivist-stat-tag[data-dice-notation] {
  cursor: pointer;
}

.archivist-stat-tag[data-dice-notation]:hover,
.archivist-inline-tag-widget .archivist-stat-tag[data-dice-notation]:hover {
  filter: brightness(1.15);
  transition: filter 0.15s ease;
}
```

- [ ] **Step 2: Run all tests**

Run: `cd ~/w/archivist-logseq && npx vitest run`

Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
cd ~/w/archivist-logseq && git add src/styles/archivist-dnd.css
git commit -m "feat: add rollable pill hover styles for dice interaction"
```

---

### Task 13: Build, Manual Testing & Cleanup

**Files:** None (verification only)

- [ ] **Step 1: Full build**

Run: `cd ~/w/archivist-logseq && npm run build`

Expected: Build succeeds with no errors.

- [ ] **Step 2: Run full test suite**

Run: `cd ~/w/archivist-logseq && npx vitest run`

Expected: All tests PASS.

- [ ] **Step 3: Clean up reference repo**

Run: `rm -rf /tmp/dice-roller-ref`

- [ ] **Step 4: Manual testing in Logseq**

Load the plugin in Logseq. Test these scenarios:

**Stat block pill clicks:**
1. Create a monster stat block with attack actions containing inline tags
2. Click on an attack (`atk:`) pill -- 3D d20 should animate in overlay
3. Click on a damage (`damage:`) pill -- 3D dice should animate
4. Click on a `dc:` pill -- should NOT trigger dice roll
5. Verify overlay auto-fades after ~3 seconds

**Inline tag pill clicks:**
1. In a regular block, type `` `dice:2d6+3` ``
2. After the pill renders, click it -- 3D dice should animate
3. Type `` `atk:+5` `` -- click should roll 1d20+5
4. Type `` `dc:15` `` -- click should do nothing

**Settings:**
1. Disable "Enable Dice Rolling" in settings -- clicks should do nothing
2. Set render time to 0 -- overlay should wait for click to dismiss
3. Set render time to 5000 -- overlay should stay 5 seconds

**Edge cases:**
- Multiple dice in one expression (e.g., `2d6+1d4+3`) -- multiple dice should appear
- Click-to-dismiss during animation -- overlay should close immediately
- Rapid clicking -- should not stack overlays or crash

- [ ] **Step 5: Document any issues found**

If integration issues arise, fix them and create a follow-up commit.

- [ ] **Step 6: Final commit if needed**

```bash
cd ~/w/archivist-logseq && git status
# If any uncommitted fixes:
git add -A && git commit -m "fix: Phase 5 integration fixes from manual testing"
```
