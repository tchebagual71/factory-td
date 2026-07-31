/**
 * The defeat card needs a verdict, not an accountant's ledger. Wave reached is
 * sixty per cent of the grade: surviving the pressure still matters most.
 * Delivered throughput is worth twenty-five, and the final fifteen reward a
 * factory whose output reached a useful sink (a magazine or the Lab) instead
 * of marooning rounds in buffers and belts.
 *
 * Each component is monotone in what it claims to reward. The curves saturate
 * rather than turn downward, and the zero-output opening loss is explicitly
 * zero-efficiency rather than NaN. This module stays pure so the thresholds can
 * be tuned against tests without Phaser, storage, or scene timing.
 */

export type ScoreTier = 'D' | 'C' | 'B' | 'A' | 'S';

export interface ScoreTally {
  produced: Readonly<Partial<Record<string, number>>>;
  delivered: Readonly<Partial<Record<string, number>>>;
  toLab: Readonly<Partial<Record<string, number>>>;
}

export interface ScoreInput {
  wave: number;
  tally: ScoreTally;
}

export interface RunScore {
  points: number;
  tier: ScoreTier;
  wave: number;
  delivered: number;
  /** Percentage of finished output which reached a useful sink. */
  efficiency: number;
  verdict: string;
  advice: string;
}

// `Object.values` over a Partial<Record<…>> yields `(number | undefined)[]`, so
// the accumulator infers as possibly-undefined despite the 0 seed — hence the
// explicit type argument. Same shape as `ammoTotal` in state/GameState.ts.
const total = (counts: Readonly<Partial<Record<string, number>>>): number =>
  Object.values(counts).reduce<number>((sum, n) => {
    const value = n ?? 0;
    return sum + (Number.isFinite(value) && value > 0 ? value : 0);
  }, 0);

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

const TIER_MIN: { tier: ScoreTier; min: number; verdict: string }[] = [
  { tier: 'S', min: 85, verdict: 'INDUSTRIAL MONSTER' },
  { tier: 'A', min: 65, verdict: 'HIGH-OUTPUT FACTORY' },
  { tier: 'B', min: 45, verdict: 'STEADY LINE' },
  { tier: 'C', min: 25, verdict: 'FRAGILE OUTPUT' },
  { tier: 'D', min: 0, verdict: 'LINE COLLAPSED' },
];

export function gradeRun(input: ScoreInput): RunScore {
  const wave = Math.max(1, Number.isFinite(input.wave) ? input.wave : 1);
  const produced = total(input.tally.produced);
  const delivered = total(input.tally.delivered);
  const useful = delivered + total(input.tally.toLab);
  const efficiencyRatio = produced === 0 && useful === 0 ? 0 : clamp01(useful / Math.max(produced, useful));

  const reachPoints = 60 * (1 - Math.exp(-(wave - 1) / 18));
  const throughputPoints = 25 * clamp01(delivered / 200);
  const efficiencyPoints = 15 * efficiencyRatio;
  const points = Math.round(reachPoints + throughputPoints + efficiencyPoints);
  const band = TIER_MIN.find((candidate) => points >= candidate.min) ?? TIER_MIN[TIER_MIN.length - 1];

  const advice = efficiencyRatio < 0.72 && produced > 0
    ? 'Fix routing: too much finished output never reached a useful sink.'
    : delivered < 140
      ? 'Raise delivered throughput: widen production and feed more magazines.'
      : wave < 25
        ? 'Scale earlier: this line was efficient, but it needed more capacity sooner.'
        : 'Push the wall: preserve this flow while scaling the next run faster.';

  return {
    points,
    tier: band.tier,
    wave: Math.floor(wave),
    delivered: Math.round(delivered),
    efficiency: Math.round(efficiencyRatio * 100),
    verdict: band.verdict,
    advice,
  };
}
