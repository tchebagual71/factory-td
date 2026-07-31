import { describe, expect, it } from 'vitest';
import { gradeRun, ScoreInput, ScoreTier } from './score';

function run(wave: number, produced: number, delivered: number, toLab = 0): ScoreInput {
  return { wave, tally: { produced: { ammo: produced }, delivered: { ammo: delivered }, toLab: { ammo: toLab } } };
}

describe('run grading', () => {
  it('a strictly better run never scores worse', () => {
    const bases = [run(1, 0, 0), run(8, 80, 40), run(20, 180, 150, 10)];
    for (const base of bases) {
      const baseScore = gradeRun(base).points;
      const better = [
        run(base.wave + 1, base.tally.produced.ammo ?? 0, base.tally.delivered.ammo ?? 0, base.tally.toLab.ammo ?? 0),
        run(base.wave, base.tally.produced.ammo ?? 0, (base.tally.delivered.ammo ?? 0) + 20, base.tally.toLab.ammo ?? 0),
        run(base.wave, Math.max(0, (base.tally.produced.ammo ?? 0) - 20), base.tally.delivered.ammo ?? 0, base.tally.toLab.ammo ?? 0),
      ];
      for (const candidate of better) expect(gradeRun(candidate).points).toBeGreaterThanOrEqual(baseScore);
    }
  });

  it('makes every verdict tier reachable', () => {
    const reached = new Set<ScoreTier>();
    for (const wave of [1, 5, 10, 15, 20, 25, 35, 50]) {
      for (const made of [0, 25, 75, 150, 250]) {
        for (const delivered of [0, 25, 75, 150, 250]) reached.add(gradeRun(run(wave, made, delivered)).tier);
      }
    }
    expect(reached).toEqual(new Set<ScoreTier>(['D', 'C', 'B', 'A', 'S']));
  });

  it('never divides by zero on a wave-1 loss with no production', () => {
    const score = gradeRun(run(1, 0, 0));
    expect(Number.isFinite(score.points)).toBe(true);
    expect(Number.isFinite(score.efficiency)).toBe(true);
    expect(score.efficiency).toBe(0);
  });

  it('shows the three numbers that justify the verdict and actionable advice', () => {
    const score = gradeRun(run(12, 100, 65));
    expect(score.wave).toBe(12);
    expect(score.delivered).toBe(65);
    expect(score.efficiency).toBeGreaterThan(0);
    expect(score.verdict.length).toBeGreaterThan(0);
    expect(score.advice.length).toBeGreaterThan(0);
  });
});
