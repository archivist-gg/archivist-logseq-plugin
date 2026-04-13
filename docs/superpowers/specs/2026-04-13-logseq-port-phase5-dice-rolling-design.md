# Archivist TTRPG Blocks -- Logseq Port: Phase 5 Dice Rolling System

**Date:** 2026-04-13
**Status:** Spec -- awaiting user review, then implementation plan
**Scope:** Phase 5 of 6 -- click-to-roll dice with 3D physics animation

---

## Overview

Add click-to-roll dice functionality to the Logseq plugin. Users click on rollable inline tag pills (inside stat blocks or regular blocks) and a 3D dice animation plays in a full-screen overlay on the host document. The dice engine and 3D renderer are forked from the Obsidian community `dice-roller` plugin (MIT license), stripped of all Obsidian dependencies, and embedded directly into the Archivist plugin.

Phase 4 delivered inline tag pills (display-only). Phase 5 makes rollable pills interactive: `dice`, `damage`, `atk`, and `mod` tags respond to clicks with a full 3D physics dice roll. `dc` and `check` tags remain display-only.

## Source Attribution

The dice engine and 3D renderer are forked from:
- **Repository:** https://github.com/Obsidian-TTRPG-Community/dice-roller
- **License:** MIT
- **Version at time of fork:** v11.4.2
- **Author:** Jeremy Valentine

All forked code is stripped of Obsidian framework dependencies and adapted for the Logseq plugin runtime (iframe -> host document).

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Dice engine source | Fork from Obsidian dice-roller (MIT) | Full notation support, battle-tested lexer + parser, 328 stars. Clean-room reimplementation would be more work with more edge cases. |
| Notation support | Full D&D: `XdY+M`, modifiers (`kh`, `kl`, `dh`, `dl`, `!`, `!!`, `r`, `u`, `sa/sd`), conditions, math operators, parentheses, custom ranges, fudge, stunt, percentile | Covers all D&D 5e use cases plus advanced notation. |
| 3D rendering | Three.js + cannon-es physics, forked from dice-roller | Faithful port of the proven 3D dice animation. Realistic bouncing, shadows, textured dice. |
| Result display | Overlay only, no persistent results | Stateless. 3D dice animate in full-screen overlay, auto-fade after configurable time. No inline results, no roll log. |
| Rollable tag types | `dice`, `damage`, `atk`, `mod` | Same as Obsidian. `dc` and `check` remain display-only. |
| Non-rollable tags | `dc`, `check` | Display only, no click handler. |
| Bare dice auto-detection | Inside stat blocks only | `decorateProseDice()` runs on stat block text only. Regular Logseq blocks require explicit backtick tags. Same as Obsidian. |
| Overlay host | `parent.document` (Logseq main frame) | Plugin runs in iframe. Overlay must appear on the main window. Same pattern as inline tag observer. |
| Tokenizer | `moo` library (forked usage) | Complex grammar with 20+ token types. Hand-rolled regex would be fragile. ~4KB minified. |
| Random number generation | `crypto.getRandomValues()` | Cryptographically secure. Replaces the original's `Math.random()` in DiceRoller. |
| Dropped roller types | Table, section, line, tag, dataview, narrative | All reference Obsidian vault files or Genesys dice. Not applicable to D&D stat blocks. |
| Dropped dice geometries | All 7 Genesys types (Boost, Setback, Ability, Difficulty, Proficiency, Challenge, Force) | Not D&D. Keeps D4, D6, D8, D10, D12, D20, D100, Fudge, Stunt. |

---

## Architecture

### Data Flow

```
User clicks rollable pill (e.g., `atk:+7` or `dice:2d6+3`)
        |
        v
Click handler calls extractDiceNotation(tag)
  atk:+7   -> "1d20+7"
  dice:2d6  -> "2d6"
  damage:2d6+3 fire -> "2d6+3"
  mod:+3   -> "1d20+3"
        |
        v
rollDice(notation) in src/dice/roll.ts
        |
        v
DiceEngine.getRoller(notation, { shouldRender: true })
  Lexer.parse(notation) -> LexicalToken[]
  new StackRoller(lexemes)
        |
        v
roller.roll(true)  // true = force 3D render
  For each dice group: DiceRoller.roll()
    If shouldRender && canRender():
      DiceRenderer.getDiceForRoller(roller) -> DiceShape[]
      DiceRenderer.addDice(shapes)
      Physics simulation determines face values
    Else:
      getRandomValue() via crypto.getRandomValues()
  StackRoller evaluates math operators on results
  Apply modifiers (kh, kl, explode, reroll, etc.)
        |
        v
DiceRenderer.start() -> full-screen overlay on parent.document
  Three.js scene: camera, lights, desk plane, shadow mapping
  cannon-es world: gravity, barriers, contact materials
  requestAnimationFrame loop:
    world.step() -> sync mesh positions from physics bodies
    renderer.render(scene, camera)
  throwFinished(): all dice velocity < 5 threshold
  DiceShape.getUpsideValue(): read face-up value from quaternion
        |
        v
Auto-fade after renderTime ms (default 3000), or click to dismiss
  container.style.opacity -> 0
  setTimeout -> container.remove(), dispose Three.js resources
```

### Project Structure (Phase 5 additions)

```
src/dice/
  # --- FORKED from Obsidian dice-roller (MIT), stripped of Obsidian deps ---
  lexer.ts            # moo tokenizer + shunting-yard parser (~250 lines)
  roller.ts           # Base Roller/RenderableRoller classes, plain TS (~60 lines)
  dice-roller.ts      # DiceRoller: single dice group evaluation (~500 lines)
  stack-roller.ts     # StackRoller: full expression evaluator (~400 lines)
  fudge-roller.ts     # FudgeRoller: fate dice [-1,0,1] (~12 lines)
  percent-roller.ts   # PercentRoller: d100 as digit dice (~50 lines)
  stunt-roller.ts     # StuntRoller: AGE system stunt die (~55 lines)
  renderable.ts       # RenderableDice interface + RenderTypes enum (~30 lines)
  types.ts            # Round, ExpectedValue enums, RollerOptions (~25 lines)

  renderer/
    dice-renderer.ts  # Three.js scene + cannon-es physics + overlay (~600 lines)
    shapes.ts         # DiceShape classes for each die type (~400 lines)
    geometries.ts     # BufferGeometry builders with face textures (~800 lines)
    resource.ts       # Three.js resource disposal tracker (~71 lines)

  # --- NEW ---
  engine.ts           # DiceEngine: simplified public API (~80 lines)
  roll.ts             # rollDice(): central entry point (~30 lines)
```

---

## 1. Dice Engine

### Forked Lexer (`src/dice/lexer.ts`, ~250 lines)

Source: `dice-roller/src/lexer/lexer.ts` (322 lines)

**Kept tokens:**
- `dice` -- `XdY`, bare numbers, omitted-value patterns
- `fudge` -- `XdF`, `dF`
- `stunt` -- `1dS`
- `%` -- `Xd%` percentile
- `condition` -- `=`, `!=`, `<`, `>`, `<=`, `>=`, `-=`
- `kh`, `kl`, `dh`, `dl` -- keep/drop high/low
- `!`, `!!` -- exploding/compounding
- `r` -- reroll
- `u` -- unique
- `sort` -- `sa`, `sd`
- `math` -- `+`, `-`, `*`, `/`, `^`, `(`, `)`
- `WS` -- whitespace (filtered)

**Stripped tokens:**
- `table` -- Obsidian file link to table
- `line` -- Obsidian file link + `|line`
- `section` -- Obsidian file link (section roller)
- `tag` -- `#tag` roller (Dataview)
- `dataview` -- `dv()` expression
- `narrative` -- Genesys/Star Wars dice

**Stripped logic:**
- `DataviewManager.getFieldValueFromActiveFile()` in dice token value function -- unknown identifiers become parse errors
- `@sniptt/monads` Result type -- replaced with `ParseResult<T>` pattern matching the rest of the codebase (`{ success: true, data } | { success: false, error }`)

**Kept intact:**
- `moo.compile()` grammar with ordered priority matching
- `Parser` class (shunting-yard algorithm with operator precedence)
- `LexerClass.parse()` and `transform()` methods
- Whitespace filtering, consecutive +/- collapsing, condition attachment

### Forked Base Classes (`src/dice/roller.ts`, ~60 lines)

Source: `dice-roller/src/rollers/roller.ts` (417 lines)

**Replaces 6-class Obsidian hierarchy with 2 plain TS classes:**

```typescript
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
  children: RenderableDice<any>[] = [];
  abstract rollSync(): T;
  abstract get result(): T;
}
```

**Dropped entirely:**
- `BareRoller` -- Obsidian DOM creation (containerEl, resultEl, iconEl, setIcon)
- `BasicRoller` -- source tracking, replacer, spinner
- `GenericFileRoller` -- Obsidian vault file access (TFile, CachedMetadata, App)
- `GenericEmbeddedRoller` -- Obsidian embed results (Notice, clipboard)
- `ArrayRoller` -- pick-from-array (not needed for dice)

### Forked DiceRoller (`src/dice/dice-roller.ts`, ~500 lines)

Source: `dice-roller/src/rollers/dice/dice.ts` (689 lines)

**Changes:**
- Replace `Notice` (3 occurrences) with `console.warn()` for modifier error messages
- Replace `Math.random()` in `getRandomValue()` with `crypto.getRandomValues()` via base class `getRandomBetween()`
- Keep `DiceRenderer` references for 3D rendering path
- Keep all modifier logic: `keepHigh()`, `keepLow()`, `reroll()`, `explode()`, `applyConditions()`
- Keep `checkCondition()` with `BasicStackRoller` for condition evaluation
- Keep `canRender()` check (contiguous 1..N face values required for 3D geometry)
- Drop `DataviewManager` condition evaluation path

### Forked StackRoller (`src/dice/stack-roller.ts`, ~400 lines)

Source: `dice-roller/src/rollers/dice/stack.ts` (742 lines)

**Kept:**
- `BasicStackRoller` -- lightweight RPN evaluator for condition expressions
- `StackRoller.buildDiceTree()` -- lexeme walking, creates DiceRoller/FudgeRoller/StuntRoller/PercentRoller instances
- `StackRoller.calculate()` -- re-evaluates math stack from rolled children, tracks min/max
- `StackRoller.roll(render?)` -- if rendering, calls `renderChildren()` (3D path), otherwise rolls each child
- `StackRoller.rollSync()` -- synchronous evaluation

**Stripped:**
- `StackRoller.build()` -- entire DOM result rendering method (~200 lines)
- `app.workspace.trigger("dice-roller:new-result")` -- Obsidian workspace events
- `Notice` imports
- `App` constructor parameter
- Signed/formula/average display logic (DOM-only concerns)

### Verbatim Files

| File | Lines | Notes |
|------|-------|-------|
| `fudge-roller.ts` | ~12 | Sets possibilities to [-1, 0, 1], overrides getType/canRender |
| `percent-roller.ts` | ~50 | Splits d100 into digit dice. No Obsidian imports. |
| `stunt-roller.ts` | ~55 | Rolls 2d6 + 1d6 stunt die. No Obsidian imports. |
| `renderable.ts` | ~30 | RenderableDice interface + RenderTypes enum (trimmed to D&D types) |
| `types.ts` | ~25 | Round, ExpectedValue enums + RollerOptions interface |

---

## 2. 3D Renderer

### Forked Renderer (`src/dice/renderer/dice-renderer.ts`, ~600 lines)

Source: `dice-roller/src/renderer/renderer.ts` (983 lines)

**Three.js scene setup (kept verbatim):**
- `WebGLRenderer` with alpha, antialias, shadow mapping (`PCFSoftShadowMap`)
- `PerspectiveCamera` with FOV=20, positioned at `cameraHeight.far` on Z axis
- `SpotLight` (intensity 0.25, shadow map 1024x1024) + `AmbientLight` (intensity 0.9)
- Desk plane with `ShadowMaterial` (opacity 0.5)

**cannon-es physics (kept verbatim):**
- `World` with gravity `(0, 0, -9.82 * 200)`
- `NaiveBroadphase` collision detection
- 5 planes: 1 ground + 4 walls (at 93% of viewport dimensions)
- Contact materials: desk-dice (friction 0.01, restitution 0.5), barrier-dice (friction 0.01, restitution 1.0), dice-dice (friction 0.1, restitution 0.5)
- Fixed timestep: 1/60 second

**Animation loop (kept verbatim):**
- `requestAnimationFrame` loop
- Each frame: `world.step()`, sync dice mesh positions from physics bodies, `renderer.render(scene, camera)`
- `throwFinished()`: all dice angular + linear velocity < 5 threshold, or > 10s elapsed
- 30 extra frames for settling after finish

**Host document overlay (adapted for Logseq):**

```typescript
export class DiceRendererClass {
  private hostDocument: Document;
  private container: HTMLDivElement;

  constructor(hostDoc: Document) {
    this.hostDocument = hostDoc;
    this.container = hostDoc.createElement("div");
    this.container.className = "archivist-dice-renderer";
    Object.assign(this.container.style, {
      position: "fixed",
      inset: "0",
      zIndex: "99999",
      pointerEvents: "all",
    });
  }

  start(): void {
    this.hostDocument.body.appendChild(this.container);
    this.container.appendChild(this.webglRenderer.domElement);
    this.initScene();
    this.animate();
  }

  unrender(): void {
    this.container.style.transition = "opacity 0.5s";
    this.container.style.opacity = "0";
    setTimeout(() => {
      this.container.remove();
      this.dispose();
    }, 500);
  }
}
```

**Completion behavior:**
- After all dice stop: auto-fade after `renderTime` ms (default 3000, configurable via settings)
- Click anywhere on overlay: immediate dismiss
- If `renderTime` is 0: wait for click (no auto-fade)

**Stripped:**
- `Component` base class -- replaced with manual `load()`/`unload()` lifecycle
- `Events` -- replaced with simple callback (`onFinished: () => void`)
- `createDiv()` -- replaced with `document.createElement("div")`
- `debounce` from obsidian -- replaced with inline `setTimeout` (3 lines)
- `registerDomEvent()` / `registerInterval()` -- replaced with direct `addEventListener()` / `setInterval()` with cleanup arrays in `unload()`
- `DiceFactory.updateDice()` Svelte integration -- not needed

### Forked Shapes (`src/dice/renderer/shapes.ts`, ~400 lines)

Source: `dice-roller/src/renderer/shapes.ts` (538 lines)

**Kept:** D4Shape, D6Shape, D8Shape, D10Shape, D12Shape, D20Shape, D100Shape, FudgeShape, StuntShape

**Stripped:** BoostShape, SetbackShape, AbilityShape, DifficultyShape, ProficiencyShape, ChallengeShape, ForceShape (7 Genesys shapes)

**`DiceShape.getUpsideValue()`** -- pure Three.js + cannon-es math. Iterates face normals, rotates by body quaternion, finds closest to Z-up. Copied verbatim.

No Obsidian dependencies in shapes.

### Forked Geometries (`src/dice/renderer/geometries.ts`, ~800 lines)

Source: `dice-roller/src/renderer/geometries.ts` (1156 lines)

**Kept:** D4DiceGeometry, D6DiceGeometry, D8DiceGeometry, D10DiceGeometry, D100DiceGeometry, D12DiceGeometry, D20DiceGeometry, FudgeDiceGeometry, StuntDiceGeometry

**Stripped:** All 7 Genesys geometry classes (~350 lines)

**One Obsidian dep to fix:** `createEl("canvas")` in `DiceGeometry.createTextTexture()` -- replace with `document.createElement("canvas")`.

Dice face textures are generated at runtime via Canvas 2D API (text labels drawn onto texture maps). No external image assets needed.

### Resource Tracker (`src/dice/renderer/resource.ts`, ~71 lines)

Source: `dice-roller/src/renderer/resource.ts`

Copied verbatim. Pure Three.js disposal logic -- walks tracked objects and calls `.dispose()` on geometries, materials, textures. No Obsidian dependencies.

---

## 3. Click Wiring

### Stat Block Pills

The HTML string renderers (`monster-renderer.ts`, `spell-renderer.ts`, `item-renderer.ts`) already produce pill `<span>` elements via `renderStatBlockTag()` in `renderer-utils.ts`. Currently display-only.

**Change to `renderer-utils.ts`:**

Add `extractDiceNotation()` and `isRollable()` functions (~30 lines). These are exported and also used by `inline-tag-observer.ts`:
```typescript
const ROLLABLE_TYPES = new Set(["dice", "damage", "atk", "mod"]);

export function isRollable(type: string): boolean {
  return ROLLABLE_TYPES.has(type);
}

export function extractDiceNotation(tag: InlineTag): string | null {
  switch (tag.type) {
    case "dice": return tag.content;                          // "2d6+3" -> "2d6+3"
    case "damage": return tag.content.replace(/\s+\S+$/, ""); // "2d6+3 fire" -> "2d6+3"
    case "atk": case "mod": return `1d20${tag.content}`;      // "+7" -> "1d20+7"
    default: return null;                                      // dc, check not rollable
  }
}
```

Add `data-dice-notation` attribute to rollable pills in `renderStatBlockTag()`:
```html
<span class="archivist-stat-tag archivist-stat-tag-atk"
      data-dice-notation="1d20+7"
      title="+7 to hit -- Click to roll">
```

**Click handler attachment** in each React fenced code block component (`MonsterBlock`, `SpellBlock`, `ItemBlock`), inside the existing `useEffect` after setting innerHTML:

```typescript
container.querySelectorAll(".archivist-stat-tag[data-dice-notation]").forEach(el => {
  el.style.cursor = "pointer";
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    const notation = (el as HTMLElement).dataset.diceNotation;
    if (notation && logseq.settings?.diceEnabled !== false) {
      rollDice(notation);
    }
  });
});
```

### Inline Tag Observer Pills

The `inline-tag-observer.ts` MutationObserver replaces `<code>` elements with styled pill `<span>` elements.

**Change:** After creating each pill span, check if the tag type is rollable. If so, add `data-dice-notation` and a click handler:

```typescript
if (isRollable(parsed.type)) {
  const notation = extractDiceNotation(parsed);
  if (notation) {
    pill.dataset.diceNotation = notation;
    pill.style.cursor = "pointer";
    pill.addEventListener("click", (e) => {
      e.stopPropagation();
      if (logseq.settings?.diceEnabled !== false) {
        rollDice(notation);
      }
    });
  }
}
```

Where `isRollable(type)` returns `true` for `"dice"`, `"damage"`, `"atk"`, `"mod"`.

### Central Roll Function (`src/dice/roll.ts`, ~30 lines)

```typescript
import { DiceEngine } from "./engine";
import { diceRenderer } from "./renderer/dice-renderer";

const engine = new DiceEngine();

export async function rollDice(notation: string): Promise<void> {
  const roller = engine.getRoller(notation, { shouldRender: true });
  if (roller) {
    await roller.roll(true);
  }
}
```

### DiceEngine API (`src/dice/engine.ts`, ~80 lines)

Simplified version of the Obsidian `APIInstance`. No source registration, no flag parsing, no file-based rollers:

```typescript
import { Lexer } from "./lexer";
import { StackRoller } from "./stack-roller";
import type { RollerOptions } from "./types";

export class DiceEngine {
  private lexer = new Lexer();

  getRoller(notation: string, options?: Partial<RollerOptions>): StackRoller | null {
    const result = this.lexer.parse(notation);
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

---

## 4. Settings

Added to the existing `logseq.useSettingsSchema()` from Phase 3:

| Setting | Type | Default | Purpose |
|---------|------|---------|---------|
| `diceRenderTime` | number | `3000` | Milliseconds before 3D overlay auto-fades. 0 = wait for click. |
| `diceEnabled` | boolean | `true` | Master toggle for click-to-roll. When false, pills are display-only. |

Accessed at runtime via `logseq.settings?.diceRenderTime` and `logseq.settings?.diceEnabled`.

---

## 5. Plugin Initialization

Updated `src/index.ts` startup sequence:

```
logseq.ready(main)
  |
  v
1.  logseq.provideStyle(dndCss)                         # Phase 1
2.  logseq.provideStyle(editCss)                         # Phase 3
3.  logseq.useSettingsSchema(settingsSchema)              # Phase 3, MODIFIED (2 new fields)
4.  Register 3 fenced code renderers                      # Phase 1, modified Phase 3
      - MODIFIED: attach dice click handlers post-render
5.  Register 3 slash commands                             # Phase 1
6.  Create SrdStore, EntityRegistry, CompendiumManager    # Phase 2
7.  compendiumManager.discover() + loadAllEntities()      # Phase 2
8.  Register "Import SRD" command                         # Phase 2
9.  Register "Search Entity" command                      # Phase 2
10. logseq.provideModel({ ...searchUIHandlers })          # Phase 2
11. startInlineTagObserver(hostDoc)                       # Phase 4, MODIFIED (dice clicks)
12. initDiceRenderer(hostDoc)                             # NEW Phase 5
```

---

## 6. CSS Additions

Appended to `src/styles/archivist-dnd.css` (~15 lines):

```css
/* --- Phase 5: Rollable pill interaction --- */
.archivist-stat-tag[data-dice-notation],
.archivist-inline-tag-widget [data-dice-notation] {
  cursor: pointer;
}

.archivist-stat-tag[data-dice-notation]:hover,
.archivist-inline-tag-widget [data-dice-notation]:hover {
  filter: brightness(1.15);
}
```

The 3D renderer overlay is styled entirely inline via JavaScript (position fixed, inset 0, z-index 99999). No CSS file needed for the overlay.

---

## 7. New Dependencies

```bash
npm install moo three cannon-es
npm install -D @types/moo @types/three
```

| Package | Size (minified) | Purpose |
|---------|----------------|---------|
| `moo` | ~4KB | Dice notation tokenizer |
| `three` | ~150KB | 3D WebGL rendering |
| `cannon-es` | ~50KB | Physics engine |

Tree-shaking via Vite will reduce the Three.js bundle -- only core scene/geometry/material/light modules are used (no loaders, post-processing, or GLTF).

---

## File Summary

### New files (forked + new)

| File | Est. Lines | Source |
|------|-----------|--------|
| `src/dice/lexer.ts` | ~250 | Fork, stripped non-D&D tokens |
| `src/dice/roller.ts` | ~60 | Rewrite, plain TS classes |
| `src/dice/dice-roller.ts` | ~500 | Fork, stripped Obsidian deps |
| `src/dice/stack-roller.ts` | ~400 | Fork, stripped DOM/events |
| `src/dice/fudge-roller.ts` | ~12 | Verbatim |
| `src/dice/percent-roller.ts` | ~50 | Verbatim |
| `src/dice/stunt-roller.ts` | ~55 | Verbatim |
| `src/dice/renderable.ts` | ~30 | Trimmed to D&D types |
| `src/dice/types.ts` | ~25 | Enums + RollerOptions |
| `src/dice/engine.ts` | ~80 | New: simplified public API |
| `src/dice/roll.ts` | ~30 | New: rollDice() entry point |
| `src/dice/renderer/dice-renderer.ts` | ~600 | Fork, host document overlay |
| `src/dice/renderer/shapes.ts` | ~400 | Fork, stripped Genesys shapes |
| `src/dice/renderer/geometries.ts` | ~800 | Fork, stripped Genesys geometries |
| `src/dice/renderer/resource.ts` | ~71 | Verbatim |

### Modified files

| File | Delta | Change |
|------|-------|--------|
| `src/index.ts` | ~20 lines | Init renderer, wire dice click hooks |
| `src/renderers/renderer-utils.ts` | ~40 lines | `extractDiceNotation()`, `data-dice-notation` attrs |
| `src/extensions/inline-tag-observer.ts` | ~15 lines | Click handlers on rollable pills |
| `src/styles/archivist-dnd.css` | ~15 lines | Cursor pointer + hover on rollable pills |

### Totals

| Category | Files | Est. Lines |
|----------|-------|-----------|
| Forked (stripped) | 13 | ~3,333 |
| New | 2 | ~110 |
| Modified | 4 | ~90 delta |
| **Total new code** | | **~3,533 lines** |

---

## What Phase 5 Does NOT Include

- Dice rolling result history / log panel
- Inline result display next to pills
- Dice color/texture customization settings
- Bare dice auto-detection in regular blocks (only inside stat blocks)
- Sound effects
- Custom dice faces / themes
- Reading mode rendering (observer only works in rendered blocks)
- Dice rolling outside of pill clicks (e.g., slash commands to roll arbitrary expressions)

---

## Phase Roadmap (Updated)

| Phase | Status |
|-------|--------|
| Phase 1: Core Rendering | Done |
| Phase 2: Entity & Compendium | Done |
| Phase 3: Edit Mode | Done |
| Phase 4: Inline Tags | Done |
| **Phase 5: Dice Rolling System** | **This spec** |
| Phase 6: AI / Inquiry System | Future |
