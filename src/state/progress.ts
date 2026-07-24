import {
  AchievementDef,
  emptyStats,
  newlyUnlocked,
  startMoneyBonus,
  StatKey,
  Stats,
} from '../data/achievements';
import { GameState } from './GameState';

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

class ProgressClass {
  stats: Stats = emptyStats();
  unlocked = new Set<string>();

  constructor() {
    const savedStats = readJSON<Partial<Stats>>(KEY_STATS);
    if (savedStats) this.stats = { ...emptyStats(), ...savedStats };
    const savedAch = readJSON<string[]>(KEY_ACH);
    if (Array.isArray(savedAch)) this.unlocked = new Set(savedAch.filter((id) => typeof id === 'string'));
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

  private afterChange(): void {
    const fresh = newlyUnlocked(this.unlocked, this.stats);
    for (const def of fresh) this.unlocked.add(def.id);
    writeJSON(KEY_STATS, this.stats);
    if (fresh.length > 0) writeJSON(KEY_ACH, [...this.unlocked]);
    for (const def of fresh) GameState.events.emit('achievement', def satisfies AchievementDef);
  }
}

export const progress = new ProgressClass();
