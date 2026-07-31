import Phaser from 'phaser';
import { BELT_SPEED, TILE } from '../config';
import { isMachine, isTower, MACHINES, recipeNeeds, TOWERS, TUNNEL } from '../data/buildings';
import { labAccepts, RESEARCH_VALUE } from '../data/research';
import { bumpAmmo, GameState } from '../state/GameState';
import { Building, Dir, DX, DY, ItemEnt, ItemType } from '../types';
import { GridSystem } from './GridSystem';

const ITEM_TEXTURE: Record<ItemType, string> = {
  ore: 'item-ore',
  crystal: 'item-crystal',
  ammo: 'item-ammo',
  shell: 'item-shell',
  piercing: 'item-piercing',
  coolant: 'item-coolant',
};

/** Output directions relative to facing: 0=straight, 3=left, 1=right. */
const SPLIT_OFFSETS = [0, 3, 1];
const SIDE_OFFSETS = [3, 1];

/**
 * Moves items along carriers. Each cell holds at most one item;
 * items glide smoothly to their cell center, then hop to the next cell if
 * free, or get consumed by the machine/tower the cell points into.
 * Splitters round-robin straight/left/right; configured sorters reserve
 * straight for their filtered item and share everything else across the sides.
 */
export class ConveyorSystem {
  items: ItemEnt[] = [];

  constructor(
    private scene: Phaser.Scene,
    private grid: GridSystem,
  ) {}

  update(dt: number): void {
    const step = BELT_SPEED * GameState.mods.beltSpeed * dt;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      const tx = it.cx * TILE + TILE / 2;
      const ty = it.cy * TILE + TILE / 2;
      const dx = tx - it.sprite.x;
      const dy = ty - it.sprite.y;
      const d = Math.hypot(dx, dy);

      if (d > step) {
        it.sprite.x += (dx / d) * step;
        it.sprite.y += (dy / d) * step;
        continue;
      }
      it.sprite.setPosition(tx, ty).setAlpha(1);

      const host = this.grid.cellAt(it.cx, it.cy)?.building;
      if (!host) continue;

      // An item resting at the cell center that fails to move is a jam — the
      // overlay reads `stalled` to paint backed-up belts.
      let moved = false;
      if (host.type === 'belt') {
        moved = this.tryTransfer(i, it, host, host.dir);
      } else if (host.type === 'tunnel') {
        const dive = this.tryTunnel(it, host);
        moved = dive === 'moved' || (dive === 'none' && this.tryTransfer(i, it, host, host.dir));
      } else if (host.type === 'splitter' || (host.type === 'sorter' && (host.filter ?? null) === null)) {
        for (let k = 0; k < 3; k++) {
          const slot = (host.outIdx + k) % 3;
          const dir = ((host.dir + SPLIT_OFFSETS[slot]) % 4) as Dir;
          if (this.tryTransfer(i, it, host, dir)) {
            host.outIdx = (slot + 1) % 3;
            moved = true;
            break;
          }
        }
      } else if (host.type === 'sorter') {
        if (it.type === host.filter) {
          // A filtered line is a guarantee, not a preference. Diverting when
          // straight is busy would put the exact wrong item back into the line
          // the sorter exists to protect.
          moved = this.tryTransfer(i, it, host, host.dir);
        } else {
          for (let k = 0; k < 2; k++) {
            const slot = (host.outIdx + k) % 2;
            const dir = ((host.dir + SIDE_OFFSETS[slot]) % 4) as Dir;
            if (this.tryTransfer(i, it, host, dir)) {
              host.outIdx = (slot + 1) % 2;
              moved = true;
              break;
            }
          }
        }
      }
      host.stalled = !moved;
      host.stallReason = moved ? null : 'jam';
    }
  }

  /**
   * Send the item underground to the next tunnel with the same facing within
   * reach. 'waiting' means a paired exit exists but is occupied (hold, do not
   * fall back to belt behavior); 'none' means unpaired — act like a plain belt.
   */
  private tryTunnel(it: ItemEnt, host: Building): 'moved' | 'waiting' | 'none' {
    for (let k = 1; k <= TUNNEL.reach; k++) {
      const exit = this.grid.cellAt(it.cx + DX[host.dir] * k, it.cy + DY[host.dir] * k)?.building;
      if (!exit || exit.type !== 'tunnel' || exit.dir !== host.dir) continue;
      if (exit.item) return 'waiting';
      host.item = null;
      exit.item = it;
      it.cx = exit.x;
      it.cy = exit.y;
      it.sprite.setAlpha(0.35); // "underground" while gliding to the exit
      return 'moved';
    }
    return 'none';
  }

  /** Move/insert the item one cell in `dir`. Returns true if the item left its host. */
  private tryTransfer(index: number, it: ItemEnt, host: Building, dir: Dir): boolean {
    const nx = it.cx + DX[dir];
    const ny = it.cy + DY[dir];
    const nb = this.grid.cellAt(nx, ny)?.building;
    if (!nb) return false;

    if ((nb.type === 'belt' || nb.type === 'splitter' || nb.type === 'sorter' || nb.type === 'tunnel') && !nb.item) {
      host.item = null;
      nb.item = it;
      it.cx = nx;
      it.cy = ny;
      return true;
    }
    // Machines accept exactly the items their recipe calls for, buffered and
    // capped per type. Past the press those inputs are manufactured goods, not
    // raw ore, so this can no longer branch on the two resource kinds.
    if (isMachine(nb.type) && recipeNeeds(nb.type, it.type) > 0) {
      const held = nb.inputs[it.type] ?? 0;
      if (held < MACHINES[nb.type].inputCap) {
        nb.inputs[it.type] = held + 1;
        this.consume(index);
        this.pop(nb.sprite);
        return true;
      }
    }
    // The Lab has no buffer and no output: finished goods go in and become
    // research. Raw ore is refused, so research always costs you ammo.
    if (nb.type === 'lab' && labAccepts(it.type)) {
      // Banked exactly, never rounded per delivery. `RESEARCH_VALUE` conserves
      // value across every recipe, but rounding each item destroys that: a
      // chiller's coolant is worth exactly half an ammo, and with one PEER
      // REVIEW stack `round(2.5) * 2 = 6` beat the `round(5) = 5` the ammo would
      // have paid — the laundering exploit, back in miniature. Fractions
      // accumulate harmlessly; only the level thresholds are whole numbers.
      GameState.addResearch(RESEARCH_VALUE[it.type]! * GameState.mods.researchValue);
      bumpAmmo(GameState.tally.toLab, it.type); // a round the guns did not get
      this.consume(index);
      this.pop(nb.sprite);
      return true;
    }
    if (isTower(nb.type) && it.type === TOWERS[nb.type].ammoType && nb.ammo < TOWERS[nb.type].ammoCap) {
      nb.ammo += 1;
      nb.fed += 1; // lifetime service record — gates this tower's upgrades
      // The one place a round becomes usable defence. Everything the wave report
      // says about supply is measured here rather than at the machine.
      bumpAmmo(GameState.tally.delivered, it.type);
      this.consume(index);
      this.pop(nb.sprite);
      return true;
    }
    return false;
  }

  /** Machine pushes a freshly produced item onto the carrier cell it faces. */
  spawnFrom(fromX: number, fromY: number, dir: number, type: ItemType): boolean {
    const nx = fromX + DX[dir];
    const ny = fromY + DY[dir];
    const nb = this.grid.cellAt(nx, ny)?.building;
    if (!nb || (nb.type !== 'belt' && nb.type !== 'splitter' && nb.type !== 'sorter' && nb.type !== 'tunnel') || nb.item) return false;
    const sprite = this.scene.add
      .image(fromX * TILE + TILE / 2, fromY * TILE + TILE / 2, ITEM_TEXTURE[type])
      .setDepth(4);
    const it: ItemEnt = { type, cx: nx, cy: ny, sprite };
    nb.item = it;
    this.items.push(it);
    return true;
  }

  /**
   * Recreate a saved item on its host cell, mid-glide position and tunnel-transit
   * alpha included. Returns null if the cell can't host it (corrupt/stale save).
   */
  restoreItem(type: ItemType, cx: number, cy: number, px: number, py: number, alpha = 1): ItemEnt | null {
    const host = this.grid.cellAt(cx, cy)?.building;
    if (!host || (host.type !== 'belt' && host.type !== 'splitter' && host.type !== 'sorter' && host.type !== 'tunnel') || host.item) return null;
    const sprite = this.scene.add.image(px, py, ITEM_TEXTURE[type]).setDepth(4).setAlpha(alpha);
    const it: ItemEnt = { type, cx, cy, sprite };
    host.item = it;
    this.items.push(it);
    return it;
  }

  /** Destroy an item wherever it is (belt removed, restart, etc.). */
  destroyItem(it: ItemEnt): void {
    const i = this.items.indexOf(it);
    if (i >= 0) this.items.splice(i, 1);
    it.sprite.destroy();
  }

  private consume(index: number): void {
    const it = this.items[index];
    const host = this.grid.cellAt(it.cx, it.cy)?.building;
    if (host?.item === it) host.item = null;
    this.items.splice(index, 1);
    it.sprite.destroy();
  }

  private pop(sprite: Phaser.GameObjects.Image): void {
    this.scene.tweens.add({ targets: sprite, scale: 1.12, duration: 70, yoyo: true });
  }
}
