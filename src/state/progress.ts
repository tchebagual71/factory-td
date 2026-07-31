import {
  AchievementDef,
  emptyStats,
  newlyUnlocked,
  startMoneyBonus,
  StatKey,
  Stats,
} from '../data/achievements';
import { GameState } from './GameState';
import { mergeStats } from './mergeProgress';

/**
 * Lifetime stats + unlocked achievements, persisted to localStorage. This is
 * the only module that touches storage for progress data — the unlock rules
 * themselves live (pure) in `data/achievements.ts`. Emits 'achievement' on
 * GameState.events when a new one unlocks. Survives runs; never reset by
 * GameState.reset().
 */

const KEY_STATS = 'ftd:stats';
const KEY_ACH = 'ftd:ach';

function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable (private mode / quota) — play on without persistence
  }
}

/**
 * How long stats may sit in memory before being written. A kill records three
 * or four stats, and a swift wave at ×3 speed produces kills faster than one a
 * frame — writing through on each one meant dozens of `JSON.stringify` +
 * synchronous `localStorage.setItem` pairs per second on the main thread, which
 * is exactly the budget a low-end phone does not have.
 */
const FLUSH_MS = 2000;

class ProgressClass {
  stats: Stats = emptyStats();
  unlocked = new Set<string>();

  /** stats changed since the last write */
  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const savedStats = readJSON<Partial<Stats>>(KEY_STATS);
    if (savedStats) this.stats = { ...emptyStats(), ...savedStats };
    const savedAch = readJSON<string[]>(KEY_ACH);
    if (Array.isArray(savedAch)) this.unlocked = new Set(savedAch.filter((id) => typeof id === 'string'));

    // Never lose a session's progress to a closed tab. `visibilitychange` is the
    // one that actually fires on mobile, where `beforeunload` is unreliable.
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => this.flush());
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.flush();
      });
    }
  }

  record(stat: StatKey, n = 1): void {
    this.stats[stat] += n;
    this.afterChange();
  }

  /** For high-water stats like bestWave: only ever moves up. */
  recordMax(stat: StatKey, value: number): void {
    if (value <= this.stats[stat]) return;
    this.stats[stat] = value;
    this.afterChange();
  }

  /**
   * Write any pending stats out now. Called at the natural run boundaries (wave
   * end, leaving to the menu, game over) and when the tab goes away — so the
   * throttle below can never cost a player more than the current wave.
   */
  flush(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.dirty) return;
    this.dirty = false;
    writeJSON(KEY_STATS, this.stats);
  }

  /** Starting-money bonus earned from unlocks (consumed at run start). */
  startBonus(): number {
    return startMoneyBonus(this.unlocked);
  }

  /** Merge in achievement ids unlocked elsewhere (cloud sync) — no toasts for these. */
  absorb(ids: Iterable<string>): void {
    let changed = false;
    for (const id of ids) {
      if (!this.unlocked.has(id)) {
        this.unlocked.add(id);
        changed = true;
      }
    }
    if (changed) writeJSON(KEY_ACH, [...this.unlocked]);
  }

  /**
   * Merge lifetime counters learned from another device. This is deliberately
   * quiet: old progress appearing at sign-in is not a new in-run event. Any
   * achievement implied by those counters is still banked for the union push.
   */
  absorbStats(other: Stats): void {
    const merged = mergeStats(this.stats, other);
    if ((Object.keys(merged) as StatKey[]).every((stat) => merged[stat] === this.stats[stat])) return;

    this.stats = merged;
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.dirty = false;
    writeJSON(KEY_STATS, this.stats);

    const fresh = newlyUnlocked(this.unlocked, this.stats);
    if (fresh.length > 0) {
      for (const def of fresh) this.unlocked.add(def.id);
      writeJSON(KEY_ACH, [...this.unlocked]);
    }
  }

  private afterChange(): void {
    // The unlock scan stays synchronous: it is a pass over a couple of dozen
    // pure predicates, and the toast has to land on the kill that earned it.
    // Only the storage write is deferred.
    const fresh = newlyUnlocked(this.unlocked, this.stats);
    for (const def of fresh) this.unlocked.add(def.id);

    this.dirty = true;
    if (fresh.length > 0) {
      // An unlock is rare and expensive to lose, so it writes through — and
      // takes the pending stats with it.
      writeJSON(KEY_ACH, [...this.unlocked]);
      this.flush();
    } else if (this.flushTimer === null) {
      // A throttle, not a debounce: continuous kills must not postpone the
      // write indefinitely.
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush();
      }, FLUSH_MS);
    }

    for (const def of fresh) GameState.events.emit('achievement', def satisfies AchievementDef);
  }
}

export const progress = new ProgressClass();
