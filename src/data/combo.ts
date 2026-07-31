/**
 * Kill streak — the momentum meter.
 *
 * Every kill already had immediate feedback (a bounty number, a puff, a coin
 * blip), but the hundredth kill of a wave felt exactly like the first. What was
 * missing is *escalation*: the Vampire-Survivors read where the screen visibly
 * agrees that things are going well and you do not want to be the one who
 * breaks it.
 *
 * ## It deliberately pays nothing
 *
 * A streak bonus would be combat skill paying the bills, and this game's whole
 * premise is that throughput is the economy — see the design pillars. So the
 * streak buys spectacle only: bigger numbers, a rising pitch, a milestone
 * banner. `waves.test.ts`'s income-vs-threat invariants are untouched by
 * design, and `combo.test.ts` pins that there is no money in here at all.
 *
 * ## Breaking it is the point
 *
 * The streak dies on a leak, not on a timer alone. That is what makes it a
 * factory mechanic rather than an aim mechanic: the way to keep a streak alive
 * is to keep every tower fed, which is the thing the game is actually about.
 */

/** A kill this long after the previous one starts a fresh streak. */
export const COMBO_WINDOW_MS = 2600;

/**
 * The clock the streak is stamped with.
 *
 * Deliberately *not* a Phaser scene clock. Kills are registered from
 * WaveSystem (GameScene's clock) but expiry is noticed by the meter in
 * UIScene, and those are two different clocks: UIScene only ever sleeps while
 * GameScene is restarted outright on REBUILD, so after one restart GameScene's
 * clock is near zero while UIScene's is minutes in — and every streak would
 * look stale the instant it started.
 */
export function comboNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export interface ComboState {
  /** kills in the current streak */
  count: number;
  /** best streak this run, for the wave report and the achievement hook */
  best: number;
  /** timestamp of the most recent kill, in ms */
  last: number;
}

export function emptyCombo(): ComboState {
  return { count: 0, best: 0, last: -Infinity };
}

/**
 * Milestones. Deliberately sparse and widening — a banner every five kills is
 * wallpaper, and wallpaper is the opposite of a reward.
 */
export const COMBO_MILESTONES: { at: number; label: string }[] = [
  { at: 10, label: 'ASSEMBLY LINE' },
  { at: 25, label: 'PRODUCTION RUN' },
  { at: 50, label: 'MASS PRODUCTION' },
  { at: 100, label: 'INDUSTRIAL SCALE' },
  { at: 200, label: 'TOTAL SATURATION' },
];

/**
 * Register a kill. Returns fresh state — callers hold it, so this stays pure
 * and the tests can drive a whole wave through it without a scene.
 */
export function registerKill(s: ComboState, now: number): ComboState {
  const continued = now - s.last <= COMBO_WINDOW_MS;
  const count = continued ? s.count + 1 : 1;
  return { count, best: Math.max(s.best, count), last: now };
}

/** A leak (or a wave ending badly) ends the streak; the best is kept. */
export function breakCombo(s: ComboState): ComboState {
  return { count: 0, best: s.best, last: -Infinity };
}

/** Has the streak lapsed without a kill? Drives the on-screen meter fading out. */
export function comboExpired(s: ComboState, now: number): boolean {
  return s.count > 0 && now - s.last > COMBO_WINDOW_MS;
}

/** 0 while the streak is not worth mentioning, then 1..5 as it climbs. */
export function comboTier(count: number): number {
  if (count < 5) return 0;
  let tier = 0;
  for (const m of COMBO_MILESTONES) if (count >= m.at) tier += 1;
  return tier + 1;
}

/** The milestone label if this exact count just crossed one, else null. */
export function comboMilestone(count: number): string | null {
  return COMBO_MILESTONES.find((m) => m.at === count)?.label ?? null;
}

/**
 * Pitch multiplier for the kill blip, so a streak audibly climbs. Capped: an
 * uncapped ramp walks straight out of the audible band and into a dog whistle
 * on a hundred-kill swift wave.
 */
export const COMBO_MAX_PITCH = 2;

export function comboPitch(count: number): number {
  return Math.min(COMBO_MAX_PITCH, 1 + Math.max(0, count - 1) * 0.03);
}

/** Streak colour, warming as it climbs — matches the floating bounty text. */
export const COMBO_COLORS = ['#ffe066', '#ffd043', '#ff9f43', '#ff7043', '#ff5555', '#ff2d95'];

export function comboColor(count: number): string {
  return COMBO_COLORS[Math.min(COMBO_COLORS.length - 1, comboTier(count))];
}
