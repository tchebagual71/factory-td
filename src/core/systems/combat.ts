import { BUILDING_DEFS, TILE } from '../config';
import type { Game } from '../game';
import type { Building, Enemy } from '../types';
import { enemyPos } from './enemies';

/**
 * Turrets are hitscan: pick the enemy furthest along the path in range, spend
 * a shot, apply damage (splash for cannons). Magazines reload from the
 * building's ammo input buffer, one item -> several shots.
 */
export function updateTurrets(game: Game, dt: number): void {
  for (const b of game.buildings) {
    const spec = BUILDING_DEFS[b.kind].turret;
    if (!spec) continue;
    b.cooldown = Math.max(0, b.cooldown - dt);

    if (b.shots <= 0 && (b.input[spec.ammo] ?? 0) > 0) {
      b.input[spec.ammo] = (b.input[spec.ammo] ?? 0) - 1;
      b.shots += spec.shotsPerItem;
    }
    if (b.cooldown > 0 || b.shots <= 0) continue;

    const origin = turretCenter(b);
    const target = pickTarget(game, origin, spec.range);
    if (!target) continue;

    b.shots--;
    b.cooldown = 1 / spec.rate;
    const tpos = enemyPos(game, target);
    game.effects.push({ kind: 'beam', x: origin.x, y: origin.y, x2: tpos.x, y2: tpos.y, t: 0.08, max: 0.08 });

    if (spec.splash) {
      game.effects.push({ kind: 'blast', x: tpos.x, y: tpos.y, r: spec.splash, t: 0.25, max: 0.25 });
      for (const e of [...game.enemies]) {
        const p = enemyPos(game, e);
        if (Math.hypot(p.x - tpos.x, p.y - tpos.y) <= spec.splash + e.radius) {
          damageEnemy(game, e, spec.damage);
        }
      }
    } else {
      damageEnemy(game, target, spec.damage);
    }
  }
}

function turretCenter(b: Building): { x: number; y: number } {
  return { x: (b.x + 0.5) * TILE, y: (b.y + 0.5) * TILE };
}

/** Classic "first" targeting: furthest along the path wins. */
function pickTarget(game: Game, origin: { x: number; y: number }, range: number): Enemy | null {
  let best: Enemy | null = null;
  for (const e of game.enemies) {
    const p = enemyPos(game, e);
    if (Math.hypot(p.x - origin.x, p.y - origin.y) <= range + e.radius) {
      if (!best || e.dist > best.dist) best = e;
    }
  }
  return best;
}

export function damageEnemy(game: Game, e: Enemy, amount: number): void {
  e.hp -= amount;
  if (e.hp > 0) return;
  const i = game.enemies.indexOf(e);
  if (i === -1) return;
  game.enemies.splice(i, 1);
  game.money += e.reward;
  const p = enemyPos(game, e);
  game.effects.push({ kind: 'death', x: p.x, y: p.y, r: e.radius * 1.5, t: 0.3, max: 0.3 });
}
