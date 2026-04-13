import { DiceEngine } from "./engine";
import { diceRenderer } from "./renderer/dice-renderer";

const engine = new DiceEngine();

/**
 * Roll dice with 3D animation. The physics simulation IS the RNG —
 * dice land naturally and getUpsideValue() reads the settled face.
 * This matches the original Obsidian dice-roller architecture.
 */
export async function rollDice(notation: string): Promise<void> {
  const roller = engine.getRoller(notation, { shouldRender: true });
  if (!roller) return;

  // roll(true) sets shouldRender on children, which makes DiceRoller.getValue()
  // create 3D shapes via getShapes(), animate via addDice(), then read the
  // settled face value via resolveShapeValue(). The result IS the 3D dice.
  await roller.roll(true);

  showResult(notation, roller.result);
}

function showResult(notation: string, result: number): void {
  const doc = diceRenderer?.hostDocument;
  if (!doc) return;

  const el = doc.createElement("div");
  el.className = "archivist-dice-result";

  const label = doc.createElement("span");
  label.textContent = notation;
  Object.assign(label.style, { opacity: "0.7", fontSize: "14px" });

  const value = doc.createElement("span");
  value.textContent = String(result);
  Object.assign(value.style, { fontSize: "28px", fontWeight: "bold" });

  el.appendChild(label);
  el.appendChild(doc.createElement("br"));
  el.appendChild(value);

  Object.assign(el.style, {
    position: "fixed",
    top: "48px",
    right: "16px",
    background: "rgba(0,0,0,0.85)",
    color: "#fff",
    padding: "14px 28px",
    borderRadius: "10px",
    textAlign: "center",
    zIndex: "100000",
    pointerEvents: "none",
    fontFamily: "system-ui, sans-serif",
    transition: "opacity 0.5s",
  });
  doc.body.appendChild(el);

  const duration = diceRenderer?.renderTime ?? 3000;
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 500);
  }, duration);
}
