import { waveClearBonus, waveDef } from './waves';

/**
 * Missions are a nudge, not a second economy. Each card pays roughly six per
 * cent of the gross income of the wave that offered it, so even clearing all
 * three together contributes at most eighteen per cent. The repeatable cards
 * ask for clean defence and useful factory output; the one-shots pull the
 * player toward saving, research, and run milestones instead of merely buying
 * the locally strongest tower.
 *
 * An active card captures its goal and first eligible wave. That small bit of
 * state matters: a replacement drawn from a wave summary must not instantly
 * claim the work which completed the card before it. Everything here is pure;
 * GameState owns the run-scoped instances and the HUD only presents them.
 */

export type MissionPhase = 'build' | 'wave';

export interface MissionTally {
  leaked: number;
  produced: Readonly<Partial<Record<string, number>>>;
  delivered: Readonly<Partial<Record<string, number>>>;
  starved: number;
}

export interface MissionFacts {
  wave: number;
  phase: MissionPhase;
  money: number;
  runKills: number;
  researchLevel: number;
  tally: MissionTally;
  /** Present only while handling the synchronous wave-summary event. */
  lastCleared?: { wave: number; tally: MissionTally };
}

export interface ActiveMission {
  id: string;
  offeredAtWave: number;
  /** Per-wave work before this wave cannot satisfy the card. */
  startWave: number;
  goal?: number;
  payout: number;
}

export interface MissionDef {
  id: string;
  name: string;
  desc: string;
  repeatable?: boolean;
  /** Equivalent to research cards' `needs`: false means misleading or premature. */
  needs: (facts: MissionFacts) => boolean;
  create: (facts: MissionFacts) => ActiveMission;
  complete: (mission: ActiveMission, facts: MissionFacts) => boolean;
}

// `Object.values` over a Partial<Record<…>> yields `(number | undefined)[]`, so
// the accumulator infers as possibly-undefined despite the 0 seed — hence the
// explicit type argument. Same shape as `ammoTotal` in state/GameState.ts.
const total = (counts: Readonly<Partial<Record<string, number>>>): number =>
  Object.values(counts).reduce<number>((sum, n) => sum + (n ?? 0), 0);

export function projectedWaveIncome(wave: number): number {
  const d = waveDef(wave);
  return d.count * d.bounty + waveClearBonus(wave);
}

/** One card's target share; three simultaneous completions remain below 18%. */
export function missionPayout(wave: number): number {
  return Math.max(4, Math.floor(projectedWaveIncome(wave) * 0.06));
}

function startWave(facts: MissionFacts): number {
  // Cards awarded during a fight (including its synchronous summary) begin on
  // the next wave. Otherwise stale tally values could finish a fresh card.
  return facts.phase === 'wave' ? facts.wave + 1 : facts.wave;
}

function make(id: string, facts: MissionFacts, goal?: number): ActiveMission {
  return { id, offeredAtWave: facts.wave, startWave: startWave(facts), goal, payout: missionPayout(facts.wave) };
}

function tallyFor(
  facts: MissionFacts,
  firstWave: number,
  predicate: (tally: MissionTally) => boolean,
): boolean {
  if (facts.wave >= firstWave && predicate(facts.tally)) return true;
  return !!facts.lastCleared && facts.lastCleared.wave >= firstWave && predicate(facts.lastCleared.tally);
}

function clearedFor(
  facts: MissionFacts,
  firstWave: number,
  predicate: (tally: MissionTally) => boolean,
): boolean {
  return !!facts.lastCleared && facts.lastCleared.wave >= firstWave && predicate(facts.lastCleared.tally);
}

const numeric = (read: (facts: MissionFacts) => number) =>
  (mission: ActiveMission, facts: MissionFacts): boolean => read(facts) >= (mission.goal ?? Infinity);

export const MISSIONS: MissionDef[] = [
  {
    id: 'clean_shift',
    name: 'Clean Shift',
    desc: 'Clear a wave with no leaks',
    repeatable: true,
    needs: () => true,
    create: (facts) => make('clean_shift', facts),
    complete: (mission, facts) => clearedFor(facts, mission.startWave, (t) => t.leaked === 0),
  },
  {
    id: 'delivery_quota',
    name: 'Delivery Quota',
    desc: 'Feed rounds into tower magazines',
    repeatable: true,
    needs: () => true,
    create: (facts) => make('delivery_quota', facts, Math.max(12, Math.round(waveDef(startWave(facts)).count * 1.5))),
    complete: (mission, facts) =>
      tallyFor(facts, mission.startWave, (t) => total(t.delivered) >= (mission.goal ?? Infinity)),
  },
  {
    id: 'production_quota',
    name: 'Hot Line',
    desc: 'Finish rounds in one wave',
    repeatable: true,
    needs: () => true,
    create: (facts) => make('production_quota', facts, Math.max(15, Math.round(waveDef(startWave(facts)).count * 2))),
    complete: (mission, facts) =>
      tallyFor(facts, mission.startWave, (t) => total(t.produced) >= (mission.goal ?? Infinity)),
  },
  {
    id: 'bank_750',
    name: 'Cash Buffer',
    desc: 'Bank $750',
    needs: (facts) => facts.wave >= 2 && facts.money < 750,
    create: (facts) => make('bank_750', facts, 750),
    complete: numeric((facts) => facts.money),
  },
  {
    id: 'keep_them_fed',
    name: 'Keep Them Fed',
    desc: 'Clear a wave without a tower running dry',
    repeatable: true,
    needs: (facts) => facts.wave >= 2,
    create: (facts) => make('keep_them_fed', facts),
    complete: (mission, facts) => clearedFor(facts, mission.startWave, (t) => t.starved === 0),
  },
  {
    id: 'kills_100',
    name: 'Full Order Book',
    desc: 'Destroy 100 enemies this run',
    needs: (facts) => facts.wave >= 5 && facts.runKills < 100,
    create: (facts) => make('kills_100', facts, 100),
    complete: numeric((facts) => facts.runKills),
  },
  {
    id: 'research_2',
    name: 'R&D Budget',
    desc: 'Reach research level 2',
    needs: (facts) => facts.wave >= 4 && facts.researchLevel < 2,
    create: (facts) => make('research_2', facts, 2),
    complete: numeric((facts) => facts.researchLevel),
  },
  {
    id: 'bank_1500',
    name: 'War Chest',
    desc: 'Bank $1,500',
    needs: (facts) => facts.wave >= 7 && facts.money < 1500,
    create: (facts) => make('bank_1500', facts, 1500),
    complete: numeric((facts) => facts.money),
  },
  {
    id: 'kills_300',
    name: 'Mass Production',
    desc: 'Destroy 300 enemies this run',
    needs: (facts) => facts.wave >= 10 && facts.runKills < 300,
    create: (facts) => make('kills_300', facts, 300),
    complete: numeric((facts) => facts.runKills),
  },
  {
    id: 'research_5',
    name: 'Applied Science',
    desc: 'Reach research level 5',
    needs: (facts) => facts.wave >= 10 && facts.researchLevel < 5,
    create: (facts) => make('research_5', facts, 5),
    complete: numeric((facts) => facts.researchLevel),
  },
  {
    id: 'bank_3000',
    name: 'Deep Reserves',
    desc: 'Bank $3,000',
    needs: (facts) => facts.wave >= 12 && facts.money < 3000,
    create: (facts) => make('bank_3000', facts, 3000),
    complete: numeric((facts) => facts.money),
  },
];

export function missionDef(id: string): MissionDef | undefined {
  return MISSIONS.find((def) => def.id === id);
}

export function missionComplete(def: MissionDef, mission: ActiveMission, facts: MissionFacts): boolean {
  return def.complete(mission, facts);
}

/** Compact live text for the HUD card; completion rules remain on the defs. */
export function missionProgress(mission: ActiveMission, facts: MissionFacts): string {
  const goal = mission.goal ?? 0;
  switch (mission.id) {
    case 'clean_shift':
      return 'clear with zero leaks';
    case 'keep_them_fed':
      return 'clear with zero dry towers';
    case 'delivery_quota':
      return `${facts.wave < mission.startWave ? 0 : Math.min(goal, total(facts.tally.delivered))}/${goal} delivered`;
    case 'production_quota':
      return `${facts.wave < mission.startWave ? 0 : Math.min(goal, total(facts.tally.produced))}/${goal} made`;
    case 'bank_750':
    case 'bank_1500':
    case 'bank_3000':
      return `$${Math.min(goal, facts.money)}/$${goal}`;
    case 'research_2':
    case 'research_5':
      return `research ${Math.min(goal, facts.researchLevel)}/${goal}`;
    case 'kills_100':
    case 'kills_300':
      return `${Math.min(goal, facts.runKills)}/${goal} destroyed`;
    default:
      return 'complete the objective';
  }
}

/**
 * Circular draw with a hard one-pass bound. Repeatables keep the late-game pool
 * alive; one-shots stay gone after completion. Candidates are checked after
 * instantiation too, which is the guard against a stale/current tally making a
 * freshly offered mission already complete.
 */
export function refillMissions(
  active: readonly ActiveMission[],
  completed: ReadonlySet<string>,
  facts: MissionFacts,
  count = 3,
  cursor = 0,
): { active: ActiveMission[]; cursor: number } {
  const next = [...active];
  const activeIds = new Set(next.map((mission) => mission.id));
  let checked = 0;
  let at = ((cursor % MISSIONS.length) + MISSIONS.length) % MISSIONS.length;

  while (next.length < count && checked < MISSIONS.length) {
    const def = MISSIONS[at];
    at = (at + 1) % MISSIONS.length;
    checked += 1;
    if (activeIds.has(def.id) || (!def.repeatable && completed.has(def.id)) || !def.needs(facts)) continue;
    const candidate = def.create(facts);
    if (def.complete(candidate, facts)) continue;
    next.push(candidate);
    activeIds.add(def.id);
  }
  return { active: next, cursor: at };
}
