export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function attackBonus(abilityScore: number, profBonus: number): number {
  return abilityModifier(abilityScore) + profBonus;
}

export function saveDC(abilityScore: number, profBonus: number): number {
  return 8 + profBonus + abilityModifier(abilityScore);
}
