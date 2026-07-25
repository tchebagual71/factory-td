import Phaser from 'phaser';
import { START_LIVES, START_MONEY } from '../config';
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
  /** rounds the factory finished in the same window — below `fired` means those magazines are draining */
  produced: AmmoCount;
}

export function emptyTally(): WaveTally {
  return { kills: 0, leaked: 0, income: 0, fired: {}, produced: {} };
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
 * Ammo types the towers burned faster than the factory replaced them, worst
 * shortfall first. This — not the grand total — is what tells a player which
 * supply line to widen.
 */
export function ammoDeficits(t: WaveTally): { type: ItemType; short: number }[] {
  return (Object.keys(t.fired) as ItemType[])
    .map((type) => ({ type, short: (t.fired[type] ?? 0) - (t.produced[type] ?? 0) }))
    .filter((d) => d.short > 0)
    .sort((a, b) => b.short - a.short);
}

/** Deep copy — the live tally is mutated in place all wave, so the card needs its own. */
export function cloneTally(t: WaveTally): WaveTally {
  return { ...t, fired: { ...t.fired }, produced: { ...t.produced } };
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

  /** The sim is stopped, for any reason. Player pause and the card draw both qualify. */
  get frozen(): boolean {
    return this.paused || this.awaitingCard;
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
    this.mods = modsFrom(this.taken);
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
    if (this.gameOver || this.awaitingCard) return; // a pending card draw owns the freeze
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
    this.mods = modsFrom(this.taken);
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
    this.overlay = false;
    this.surveys = 0;
    this.research = 0;
    this.researchLevel = 0;
    this.pendingLevels = 0;
    this.awaitingCard = false;
    this.taken = {};
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
