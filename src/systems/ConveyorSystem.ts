import Phaser from 'phaser';
import { BELT_SPEED, TILE } from '../config';
import { isMachine, isTower, MACHINES, TOWERS, TUNNEL } from '../data/buildings';
import { Building, Dir, DX, DY, ItemEnt, ItemType } from '../types';
import { GridSystem } from './GridSystem';

const ITEM_TEXTURE: Record<ItemType, string> = {
  ore: 'item-ore',
  ammo: 'item-ammo',
  shell: 'item-shell',
};

/**
 * Moves items along belts and splitters. Each cell holds at most one item;
 * items glide smoothly to their cell center, then hop to the next cell if
 * free, or get consumed by the machine/tower the cell points into.
 * Splitters round-robin their output between straight/left/right.
 */
export class ConveyorSystem {
  items: ItemEnt[] = [];

  constructor(
    private scene: Phaser.Scene,
    private grid: GridSystem,
  ) {}

  update(dt: number): void {
    const step = BELT_SPEED * dt;
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

      if (host.type === 'belt') {
        this.tryTransfer(i, it, host, host.dir);
      } else if (host.type === 'tunnel') {
        if (!this.tryTunnel(it, host)) this.tryTransfer(i, it, host, host.dir);
      } else if (host.type === 'splitter') {
        // offsets relative to facing: 0=straight, 3=left, 1=right
        const offsets = [0, 3, 1];
        for (let k = 0; k < 3; k++) {
          const slot = (host.outIdx + k) % 3;
          const dir = ((host.dir + offsets[slot]) % 4) as Dir;
          if (this.tryTransfer(i, it, host, dir)) {
            host.outIdx = (slot + 1) % 3;
            break;
          }
        }
      }
    }
  }

  /**
   * Send the item underground to the next tunnel with the same facing within
   * reach. Returns true if it dove (or is waiting on a blocked exit ahead).
   */
  private tryTunnel(it: ItemEnt, host: Building): boolean {
    for (let k = 1; k <= TUNNEL.reach; k++) {
      const exit = this.grid.cellAt(it.cx + DX[host.dir] * k, it.cy + DY[host.dir] * k)?.building;
      if (!exit || exit.type !== 'tunnel' || exit.dir !== host.dir) continue;
      if (exit.item) return true; // paired exit exists but is occupied — wait here
      host.item = null;
      exit.item = it;
      it.cx = exit.x;
      it.cy = exit.y;
      it.sprite.setAlpha(0.35); // "underground" while gliding to the exit
      return true;
    }
    return false; // no exit ahead — behave like a plain belt
  }

  /** Move/insert the item one cell in `dir`. Returns true if the item left its host. */
  private tryTransfer(index: number, it: ItemEnt, host: Building, dir: Dir): boolean {
    const nx = it.cx + DX[dir];
    const ny = it.cy + DY[dir];
    const nb = this.grid.cellAt(nx, ny)?.building;
    if (!nb) return false;

    if ((nb.type === 'belt' || nb.type === 'splitter' || nb.type === 'tunnel') && !nb.item) {
      host.item = null;
      nb.item = it;
      it.cx = nx;
      it.cy = ny;
      return true;
    }
    if (isMachine(nb.type) && it.type === 'ore' && nb.inputOre < MACHINES[nb.type].inputCap) {
      nb.inputOre += 1;
      this.consume(index);
      this.pop(nb.sprite);
      return true;
    }
    if (isTower(nb.type) && it.type === TOWERS[nb.type].ammoType && nb.ammo < TOWERS[nb.type].ammoCap) {
      nb.ammo += 1;
      this.consume(index);
      this.pop(nb.sprite);
      return true;
    }
    return false;
  }

  /** Machine pushes a freshly produced item onto the belt/splitter cell it faces. */
  spawnFrom(fromX: number, fromY: number, dir: number, type: ItemType): boolean {
    const nx = fromX + DX[dir];
    const ny = fromY + DY[dir];
    const nb = this.grid.cellAt(nx, ny)?.building;
    if (!nb || (nb.type !== 'belt' && nb.type !== 'splitter' && nb.type !== 'tunnel') || nb.item) return false;
    const sprite = this.scene.add
      .image(fromX * TILE + TILE / 2, fromY * TILE + TILE / 2, ITEM_TEXTURE[type])
      .setDepth(4);
    const it: ItemEnt = { type, cx: nx, cy: ny, sprite };
    nb.item = it;
    this.items.push(it);
    return true;
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
