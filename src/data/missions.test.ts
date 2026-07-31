import { describe, expect, it } from 'vitest';
import {
  ActiveMission,
  MISSIONS,
  MissionFacts,
  missionComplete,
  projectedWaveIncome,
  refillMissions,
} from './missions';

function facts(overrides: Partial<MissionFacts> = {}): MissionFacts {
  return {
    wave: 1,
    phase: 'build',
    money: 450,
    runKills: 0,
    researchLevel: 0,
    tally: { leaked: 0, produced: {}, delivered: {}, starved: 0 },
    ...overrides,
  };
}

function def(id: string) {
  const found = MISSIONS.find((m) => m.id === id);
  if (!found) throw new Error(`missing mission ${id}`);
  return found;
}

function active(id: string, f: MissionFacts): ActiveMission {
  return def(id).create(f);
}

describe('mission predicates', () => {
  it('fires a clean-shift mission only after a newly cleared leak-free wave', () => {
    const start = facts();
    const mission = active('clean_shift', start);
    const d = def('clean_shift');
    expect(missionComplete(d, mission, start)).toBe(false);
    expect(missionComplete(d, mission, facts({
      phase: 'wave',
      lastCleared: { wave: 1, tally: { leaked: 1, produced: {}, delivered: {}, starved: 0 } },
    }))).toBe(false);
    expect(missionComplete(d, mission, facts({
      phase: 'wave',
      lastCleared: { wave: 1, tally: { leaked: 0, produced: {}, delivered: {}, starved: 0 } },
    }))).toBe(true);
  });

  it('does not let work from the offer wave instantly finish a replacement', () => {
    const summary = facts({
      wave: 4,
      phase: 'wave',
      tally: { leaked: 0, produced: { ammo: 80 }, delivered: { ammo: 80 }, starved: 0 },
      lastCleared: { wave: 4, tally: { leaked: 0, produced: { ammo: 80 }, delivered: { ammo: 80 }, starved: 0 } },
    });
    for (const id of ['clean_shift', 'keep_them_fed', 'delivery_quota', 'production_quota']) {
      const d = def(id);
      const mission = d.create(summary);
      expect(missionComplete(d, mission, summary), id).toBe(false);
    }
  });

  it('hits numeric predicates at the threshold, never one unit early', () => {
    const cases = [
      ['bank_750', { money: 749 }, { money: 750 }],
      ['research_2', { researchLevel: 1 }, { researchLevel: 2 }],
      ['kills_100', { runKills: 99 }, { runKills: 100 }],
    ] as const;
    for (const [id, before, at] of cases) {
      const base = facts({ wave: 12 });
      const d = def(id);
      const mission = d.create(base);
      expect(missionComplete(d, mission, facts({ wave: 12, ...before })), `${id} before`).toBe(false);
      expect(missionComplete(d, mission, facts({ wave: 12, ...at })), `${id} at`).toBe(true);
    }
  });

  it('counts per-wave output at the goal, not one round before it', () => {
    for (const [id, field] of [
      ['delivery_quota', 'delivered'],
      ['production_quota', 'produced'],
    ] as const) {
      const start = facts({ wave: 6 });
      const d = def(id);
      const mission = d.create(start);
      const goal = mission.goal ?? 0;
      const before = facts({ wave: 6, phase: 'wave', tally: { leaked: 0, produced: {}, delivered: {}, starved: 0 } });
      before.tally[field] = { ammo: goal - 1 };
      expect(missionComplete(d, mission, before), `${id} before`).toBe(false);
      before.tally[field] = { ammo: goal };
      expect(missionComplete(d, mission, before), `${id} at`).toBe(true);
    }
  });

  it('requires a completed wave with zero starvation for Keep Them Fed', () => {
    const start = facts({ wave: 2 });
    const d = def('keep_them_fed');
    const mission = d.create(start);
    expect(missionComplete(d, mission, start)).toBe(false);
    expect(missionComplete(d, mission, facts({
      wave: 2,
      phase: 'wave',
      lastCleared: { wave: 2, tally: { leaked: 0, produced: {}, delivered: {}, starved: 1 } },
    }))).toBe(false);
    expect(missionComplete(d, mission, facts({
      wave: 2,
      phase: 'wave',
      lastCleared: { wave: 2, tally: { leaked: 0, produced: {}, delivered: {}, starved: 0 } },
    }))).toBe(true);
  });
});

describe('mission draw safety', () => {
  it('never offers an impossible or already-satisfied mission', () => {
    const late = facts({ wave: 12, money: 4000, runKills: 500, researchLevel: 8 });
    // Begin at the gated one-shots rather than letting the safe repeatables at
    // the front hide a naive draw which forgets to consult `needs()`.
    const draw = refillMissions([], new Set(), late, 3, 3).active;
    expect(draw).toHaveLength(3);
    for (const mission of draw) {
      const d = def(mission.id);
      expect(d.needs(late), mission.id).toBe(true);
      expect(missionComplete(d, mission, late), mission.id).toBe(false);
      if (mission.goal !== undefined && ['bank_750', 'bank_1500', 'bank_3000'].includes(mission.id)) {
        expect(late.money).toBeLessThan(mission.goal);
      }
    }
  });

  it('gates one-shot goals until they are plausible and removes them once met', () => {
    const cases = [
      ['bank_750', facts({ wave: 1, money: 450 }), facts({ wave: 2, money: 750 })],
      ['kills_100', facts({ wave: 4, runKills: 20 }), facts({ wave: 8, runKills: 100 })],
      ['research_2', facts({ wave: 3 }), facts({ wave: 8, researchLevel: 2 })],
      ['bank_1500', facts({ wave: 6 }), facts({ wave: 9, money: 1500 })],
      ['kills_300', facts({ wave: 9 }), facts({ wave: 15, runKills: 300 })],
      ['research_5', facts({ wave: 9 }), facts({ wave: 15, researchLevel: 5 })],
      ['bank_3000', facts({ wave: 11 }), facts({ wave: 15, money: 3000 })],
    ] as const;
    for (const [id, tooEarly, alreadyMet] of cases) {
      expect(def(id).needs(tooEarly), `${id} too early`).toBe(false);
      expect(def(id).needs(alreadyMet), `${id} already met`).toBe(false);
    }
  });

  it('terminates and refills from repeatable work when most one-shot missions are complete', () => {
    const completed = new Set(MISSIONS.filter((m) => !m.repeatable).map((m) => m.id));
    const draw = refillMissions([], completed, facts({ wave: 30 }), 3);
    expect(draw.active).toHaveLength(3);
    expect(new Set(draw.active.map((m) => m.id)).size).toBe(3);
    expect(draw.active.every((m) => def(m.id).repeatable)).toBe(true);
  });

  it('keeps a full three-card payout at or below 18% of offered-wave gross income', () => {
    for (let wave = 1; wave <= 40; wave++) {
      const f = facts({ wave });
      const draw = refillMissions([], new Set(), f, 3).active;
      expect(draw.reduce((sum, m) => sum + m.payout, 0), `wave ${wave}`).toBeLessThanOrEqual(
        Math.ceil(projectedWaveIncome(wave) * 0.18),
      );
    }
  });
});
