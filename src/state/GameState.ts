import Phaser from 'phaser';
import { START_LIVES, START_MONEY } from '../config';
import { ComboState, emptyCombo } from '../data/combo';
import { MetaEffects } from '../data/metaTree';
import { emptyMods, Mods } from '../data/mods';
import { modsFrom, researchForLevel } from '../data/research';
import type { ItemType } from '../types';

export type Phase = 'build' | 'wave';

/**
 * Rounds counted per ammo type. Totals alone would lie: a chiller makes two
 * coolant per ore, so a healthy cryo line can hide a starving gun line behind a
 * comfortable-looking grand total.
 */
export type AmmoCount = Partial<Record<ItemType, number>>;

/** Per-wave counters for the wave-clear summary card. Reset when a wave starts. */
export interface WaveTally {
  kills: number;
  leaked: number;
  /** money earned during the wave — bounties and bonuses, never sell refunds */
  income: number;
  /** rounds towers actually fired, per ammo type */
  fired: AmmoCount;
  /**
   * Rounds the factory *finished* in the same window. Note this is not the same
   * as rounds that helped: a finished round may still be sitting in an output
   * buffer, riding a belt, or heading somewhere other than a gun.
   */
  produced: AmmoCount;
  /**
   * Rounds that actually entered a tower's magazine. This — not `produced` — is
   * what "did supply keep up" means: a factory can be at full tilt and still
   * starve the guns if the belts do not reach them.
   */
  delivered: AmmoCount;
  /**
   * Rounds a Lab consumed. A real sink competing with the guns for the same
   * output, and invisible in `produced` vs `fired` — research that starved a
   * tower used to look like a production shortfall.
   */
  toLab: AmmoCount;
  /**
   * How many times a tower ran completely dry during the wave. Counted on the
   * empty transition, so it is "guns that fell silent", not a duration — the
   * one number that points at *which* part of the board to go and look at.
   */
  starved: number;
  /** total rounds sitting in every tower magazine when the wave was sent */
  magStart: number;
  /** …and when it was cleared. The difference is the buffer the wave cost you. */
  magEnd: number;
}

export function emptyTally(): WaveTally {
  return {
    kills: 0,
    leaked: 0,
    income: 0,
    fired: {},
    produced: {},
    delivered: {},
    toLab: {},
    starved: 0,
    magStart: 0,
    magEnd: 0,
  };
}

export function bumpAmmo(c: AmmoCount, type: ItemType, n = 1): void {
  c[type] = (c[type] ?? 0) + n;
}

export function ammoTotal(c: AmmoCount): number {
  let sum = 0;
  for (const n of Object.values(c)) sum += n ?? 0;
  return sum;
}

/**
 * Ammo types the towers burned faster than the belts *delivered*, worst
 * shortfall first. This — not the grand total — is what tells a player which
 * supply line to widen.
 *
 * Deliberately measured against `delivered`, not `produced`. Comparing against
 * production made the card lie in both directions: a factory whose output was
 * stuck in a backed-up buffer, riding a belt that never reached a gun, or being
 * eaten by a Lab still reported "production kept up", while a player burning
 * down a stockpile they had banked between waves was told they were short. What
 * a tower fired can only have come from what was delivered to it, so this
 * difference is exactly the magazine drain.
 */
export function ammoDeficits(t: WaveTally): { type: ItemType; short: number }[] {
  return (Object.keys(t.fired) as ItemType[])
    .map((type) => ({ type, short: (t.fired[type] ?? 0) - (t.delivered[type] ?? 0) }))
    .filter((d) => d.short > 0)
    .sort((a, b) => b.short - a.short);
}

/**
 * Rounds the factory finished but that never reached a gun this wave — stuck in
 * a buffer, still on a belt, or spent on research. A large figure next to a
 * healthy `produced` is the tell that the problem is routing, not throughput.
 */
export function ammoUndelivered(t: WaveTally): number {
  return Math.max(0, ammoTotal(t.produced) - ammoTotal(t.delivered));
}

/** Deep copy — the live tally is mutated in place all wave, so the card needs its own. */
export function cloneTally(t: WaveTally): WaveTally {
  return {
    ...t,
    fired: { ...t.fired },
    produced: { ...t.produced },
    delivered: { ...t.delivered },
    toLab: { ...t.toLab },
  };
}

/**
 * Shared game state singleton. GameScene mutates it, UIScene renders it.
 * Scenes communicate exclusively through `events` — no direct references.
 *
 * Events: 'money', 'lives', 'wave', 'phase', 'gameover',
 *         'ui:select' (UI→Game building choice), 'ui:startwave' (UI→Game),
 *         'ui:menu' (UI→Game: exit to title, GameScene saves + transitions),
 *         'selected' (Game→UI current build selection),
 *         'achievement' (progress→UI toast),
 *         'wavesummary' (Game→UI wave-clear card: wave + WaveTally)
 */
class GameStateClass {
  events = new Phaser.Events.EventEmitter();

  money = START_MONEY;
  lives = START_LIVES;
  wave = 1;
  phase: Phase = 'build';
  gameOver = false;
  speed: 1 | 2 | 3 = 1;
  auto = false;
  paused = false;
  /** seconds of build phase elapsed — drives the decaying early-send bonus */
  buildElapsed = 0;
  tally: WaveTally = emptyTally();
  /** logistics overlay visibility ([L]) — a view toggle, never part of a save */
  overlay = false;
  /** surveys bought this run — each one costs more than the last */
  surveys = 0;
  /**
   * Kill streak. Never serialized: it is a moment-to-moment feel mechanic that
   * pays nothing, so restoring a run mid-streak would be meaningless.
   */
  combo: ComboState = emptyCombo();

  /**
   * Permanent Workshop grants (`data/metaTree.ts`), folded in underneath the
   * research picks. Not serialized: it is rederived from the player's account
   * on every run, so an old save can never carry a stale Workshop with it.
   */
  baseMods: Partial<Mods> = {};
  /** extra rounds every tower is placed with — the Preloaded Mags perk */
  startAmmoBonus = 0;
  /** kills across the whole run (the tally is per-wave) — feeds the scrap payout */
  runKills = 0;
  /**
   * The lifetime best wave as it stood when this run began. `bestWave` is bumped
   * on every wave clear, so by game over it already equals the wave the player
   * died on — comparing against it could never report a new best. This is the
   * frozen "score to beat", set once by GameScene and never written again.
   */
  bestWaveAtStart = 0;
  /** fraction off the survey price — the Prospector perk */
  surveyDiscount = 0;

  // ---------- research ----------
  /** research banked toward the next level */
  research = 0;
  researchLevel = 0;
  /** levels earned but not yet spent on a card; the draw shows one per level */
  pendingLevels = 0;
  /** how many times each research card has been taken (mods are derived from this) */
  taken: Record<string, number> = {};
  mods: Mods = emptyMods();
  /** true while a level-up draw is on screen — freezes the sim without being a user pause */
  awaitingCard = false;
  /**
   * True while a full-screen reference modal (the in-game help) is up. Also a
   * freeze that is not a user pause, which is the point: `paused` is left alone,
   * so closing the modal returns to whatever the player had chosen rather than
   * silently un-pausing them.
   */
  modalOpen = false;

  /**
   * The sim is stopped, for any reason. Player pause, the card draw and an open
   * modal all qualify.
   */
  get frozen(): boolean {
    return this.paused || this.awaitingCard || this.modalOpen;
  }

  /**
   * Bank research from a lab delivery. Rolls over as many levels as the deposit
   * covers — a big shell dump can be worth more than one — and announces them
   * so the draw can be presented one at a time.
   */
  addResearch(n: number): void {
    if (n <= 0) return;
    this.research += n;
    let gained = 0;
    while (this.research >= researchForLevel(this.researchLevel + 1)) {
      this.research -= researchForLevel(this.researchLevel + 1);
      this.researchLevel += 1;
      gained += 1;
    }
    this.events.emit('research', this.research, this.researchLevel);
    if (gained > 0) {
      this.pendingLevels += gained;
      this.awaitingCard = true;
      this.events.emit('levelup');
    }
  }

  /** Record a taken card and recompute the run's modifiers from scratch. */
  takeCard(id: string): void {
    this.taken[id] = (this.taken[id] ?? 0) + 1;
    this.mods = modsFrom(this.taken, this.baseMods);
    this.pendingLevels = Math.max(0, this.pendingLevels - 1);
    this.events.emit('mods', this.mods);
  }

  /** Card draw finished (or was skipped because the pool ran dry) — resume the sim. */
  finishDraw(): void {
    this.awaitingCard = false;
    this.pendingLevels = 0;
  }

  toggleOverlay(): void {
    this.overlay = !this.overlay;
    this.events.emit('overlay', this.overlay);
  }

  recordSurvey(): void {
    this.surveys += 1;
    this.events.emit('surveys', this.surveys);
  }

  togglePause(): void {
    // A card draw or an open modal owns the freeze; letting the key through
    // would quietly flip the pause the player returns to when it closes.
    if (this.gameOver || this.awaitingCard || this.modalOpen) return;
    this.paused = !this.paused;
    this.events.emit('paused', this.paused);
  }

  cycleSpeed(): void {
    this.speed = this.speed === 3 ? 1 : ((this.speed + 1) as 1 | 2 | 3);
    this.events.emit('speed', this.speed);
  }

  toggleAuto(): void {
    this.auto = !this.auto;
    this.events.emit('auto', this.auto);
  }

  /**
   * Fold the Workshop's permanent grants into a *fresh* run. Called after
   * `reset()` and never for a restored save — a save already banked the money
   * and lives it was given, so re-granting them on load would pay twice.
   *
   * Mods are rebuilt rather than multiplied in, so calling this twice is
   * harmless.
   */
  applyMeta(e: MetaEffects): void {
    this.baseMods = e.mods;
    this.startAmmoBonus = e.startAmmo;
    this.surveyDiscount = e.surveyDiscount;
    this.mods = modsFrom(this.taken, this.baseMods);
    this.events.emit('mods', this.mods);
    if (e.startLives > 0) {
      this.lives += e.startLives;
      this.events.emit('lives', this.lives);
    }
    if (e.startMoney > 0) this.addMoney(e.startMoney, false);
  }

  /** `earned` false for sell refunds — recycling your own cash is not wave income. */
  addMoney(n: number, earned = true): void {
    this.money += n;
    if (earned) this.tally.income += n;
    this.events.emit('money', this.money);
  }

  spend(n: number): boolean {
    if (this.money < n) return false;
    this.money -= n;
    this.events.emit('money', this.money);
    return true;
  }

  /** Research can hand lives back. Never resurrects a finished run. */
  gainLives(n: number): void {
    if (this.gameOver || n <= 0) return;
    this.lives += n;
    this.events.emit('lives', this.lives);
  }

  loseLives(n: number): void {
    this.lives = Math.max(0, this.lives - n);
    this.events.emit('lives', this.lives);
    if (this.lives === 0 && !this.gameOver) {
      this.gameOver = true;
      this.events.emit('gameover');
    }
  }

  setPhase(p: Phase): void {
    this.phase = p;
    if (p === 'build') this.buildElapsed = 0;
    this.events.emit('phase', p);
  }

  nextWave(): void {
    this.wave += 1;
    this.events.emit('wave', this.wave);
  }

  /** Restore a loaded run's counters (always lands in build phase). Mirrors reset()'s event burst. */
  applySnapshot(s: {
    money: number;
    lives: number;
    wave: number;
    speed: 1 | 2 | 3;
    auto: boolean;
    surveys?: number;
    research?: number;
    researchLevel?: number;
    taken?: Record<string, number>;
  }): void {
    this.research = s.research ?? 0;
    this.researchLevel = s.researchLevel ?? 0;
    this.taken = { ...(s.taken ?? {}) };
    this.mods = modsFrom(this.taken, this.baseMods);
    this.pendingLevels = 0;
    this.awaitingCard = false;
    this.money = s.money;
    this.lives = s.lives;
    this.wave = s.wave;
    this.phase = 'build';
    this.gameOver = false;
    this.speed = s.speed;
    this.auto = s.auto;
    this.buildElapsed = 0;
    this.tally = emptyTally();
    this.surveys = s.surveys ?? 0;
    this.events.emit('surveys', this.surveys);
    this.events.emit('research', this.research, this.researchLevel);
    this.events.emit('mods', this.mods);
    this.events.emit('money', this.money);
    this.events.emit('lives', this.lives);
    this.events.emit('wave', this.wave);
    this.events.emit('phase', this.phase);
    this.events.emit('speed', this.speed);
    this.events.emit('auto', this.auto);
  }

  reset(): void {
    this.money = START_MONEY;
    this.lives = START_LIVES;
    this.wave = 1;
    this.phase = 'build';
    this.gameOver = false;
    this.speed = 1;
    this.auto = false;
    this.paused = false;
    this.buildElapsed = 0;
    this.tally = emptyTally();
    this.combo = emptyCombo();
    this.overlay = false;
    this.surveys = 0;
    this.research = 0;
    this.researchLevel = 0;
    this.pendingLevels = 0;
    this.awaitingCard = false;
    this.modalOpen = false;
    this.taken = {};
    this.baseMods = {};
    this.startAmmoBonus = 0;
    this.runKills = 0;
    this.bestWaveAtStart = 0;
    this.surveyDiscount = 0;
    this.mods = emptyMods();
    this.events.emit('paused', false);
    this.events.emit('overlay', false);
    this.events.emit('surveys', 0);
    this.events.emit('research', 0, 0);
    this.events.emit('mods', this.mods);
    this.events.emit('money', this.money);
    this.events.emit('lives', this.lives);
    this.events.emit('wave', this.wave);
    this.events.emit('phase', this.phase);
    this.events.emit('speed', this.speed);
    this.events.emit('auto', this.auto);
  }
}

export const GameState = new GameStateClass();
