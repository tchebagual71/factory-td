/**
 * Run-scoped modifiers earned from research picks.
 *
 * Lives in its own module so `buildings.ts` (which applies the combat ones) and
 * `research.ts` (which defines the cards that grant them) can both depend on it
 * without importing each other.
 *
 * Multipliers start at 1 and additives at 0, so an untouched `Mods` is a no-op
 * and every consumer can take one unconditionally.
 */
export interface Mods {
  /** tower damage multiplier */
  damage: number;
  /** tower rate-of-fire multiplier */
  fireRate: number;
  /** tower range multiplier */
  range: number;
  /** extra enemies a lance skewers */
  pierce: number;
  /** multiplies the *remaining* speed of a cryo slow, so < 1 means deeper */
  slow: number;
  /** belt item travel speed multiplier */
  beltSpeed: number;
  /** miner extraction speed multiplier */
  minerSpeed: number;
  /** crafting machine speed multiplier */
  craftSpeed: number;
  /** wave-clear payout multiplier */
  clearCash: number;
  /** research earned per item delivered to a lab */
  researchValue: number;
}

export function emptyMods(): Mods {
  return {
    damage: 1,
    fireRate: 1,
    range: 1,
    pierce: 0,
    slow: 1,
    beltSpeed: 1,
    minerSpeed: 1,
    craftSpeed: 1,
    clearCash: 1,
    researchValue: 1,
  };
}

/** Shared no-op instance for the many call sites that have no run state to hand. */
export const NO_MODS: Mods = Object.freeze(emptyMods());
