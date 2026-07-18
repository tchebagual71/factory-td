import { BELT_SPEED } from '../config';
import type { Game } from '../game';
import { DIRS } from '../types';
import { tryInsert } from './transfer';

/**
 * Belts hold at most one item each, moving 0..1 across the tile. Transfers are
 * attempted before advancing, so a freed downstream belt is usable next tick;
 * at 60 Hz the one-tick handoff gap is invisible.
 */
export function updateBelts(game: Game, dt: number): void {
  for (const b of game.buildings) {
    if (b.kind !== 'belt' || b.item === null) continue;
    if (b.progress >= 1) {
      const d = DIRS[b.dir];
      if (tryInsert(game, b.x + d.x, b.y + d.y, b.item)) {
        b.item = null;
        b.progress = 0;
        continue;
      }
    }
    b.progress = Math.min(1, b.progress + BELT_SPEED * dt);
  }
}
