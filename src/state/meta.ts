/**
 * Workshop wallet + owned levels, persisted to localStorage.
 *
 * The only module that touches storage for meta progression — the rules
 * themselves are pure in `data/metaTree.ts`, exactly like the
 * `progress.ts` / `achievements.ts` split.
 *
 * localStorage remains authoritative. Signed-in sync is only a best-effort
 * mirror, applied through the pure rules in `mergeProgress.ts`.
 */

import { effectsFrom, MetaEffects, MetaOwned, META_NODES, metaNode, nodeCost, RunResult, scrapEarned } from '../data/metaTree';
import type { WorkshopProgress } from './mergeProgress';

const KEY_SCRAP = 'ftd:scrap';
const KEY_OWNED = 'ftd:workshop';

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

class MetaClass {
  /** unspent scrap */
  scrap = 0;
  owned: MetaOwned = {};

  constructor() {
    const s = readJSON<number>(KEY_SCRAP);
    if (typeof s === 'number' && Number.isFinite(s) && s >= 0) this.scrap = Math.floor(s);
    const o = readJSON<MetaOwned>(KEY_OWNED);
    if (o && typeof o === 'object') {
      // Keep only ids the tree still defines: a node removed in a later version
      // must not leave an orphan level sitting in storage forever.
      for (const node of META_NODES) {
        const n = o[node.id];
        if (typeof n === 'number' && Number.isFinite(n) && n > 0) {
          this.owned[node.id] = Math.min(node.max, Math.floor(n));
        }
      }
    }
  }

  /** Everything a fresh run gets from the Workshop. Rebuilt from levels, never accumulated. */
  effects(): MetaEffects {
    return effectsFrom(this.owned);
  }

  /** A detached snapshot for pure local ↔ cloud merge. */
  snapshot(): WorkshopProgress {
    return { scrap: this.scrap, owned: { ...this.owned } };
  }

  /** Apply an already-validated merged snapshot without replaying purchases. */
  absorb(snapshot: WorkshopProgress): void {
    this.scrap = snapshot.scrap;
    this.owned = { ...snapshot.owned };
    this.persist();
  }

  levels(id: string): number {
    return this.owned[id] ?? 0;
  }

  /** Price of the next level, or null when the node is already maxed. */
  priceOf(id: string): number | null {
    const node = metaNode(id);
    if (!node) return null;
    const have = this.levels(id);
    return have >= node.max ? null : nodeCost(node, have);
  }

  canBuy(id: string): boolean {
    const price = this.priceOf(id);
    return price !== null && this.scrap >= price;
  }

  /** Buy one level. Returns false (and changes nothing) if unaffordable or maxed. */
  buy(id: string): boolean {
    const price = this.priceOf(id);
    if (price === null || this.scrap < price) return false;
    this.scrap -= price;
    this.owned[id] = this.levels(id) + 1;
    this.persist();
    return true;
  }

  /** Bank a finished run's payout. Returns the amount, for the game-over card. */
  award(result: RunResult): number {
    const earned = scrapEarned(result);
    this.scrap += earned;
    this.persist();
    return earned;
  }

  private persist(): void {
    writeJSON(KEY_SCRAP, this.scrap);
    writeJSON(KEY_OWNED, this.owned);
  }
}

export const meta = new MetaClass();
