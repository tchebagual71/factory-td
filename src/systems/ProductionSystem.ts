import Phaser from 'phaser';
import { isMachine, MACHINES, MINER } from '../data/buildings';
import { ConveyorSystem } from './ConveyorSystem';
import { GridSystem } from './GridSystem';

/** Ticks miners (produce ore) and crafting machines (press: ore→ammo, forge: 2 ore→shell). */
export class ProductionSystem {
  constructor(
    private scene: Phaser.Scene,
    private grid: GridSystem,
    private conveyor: ConveyorSystem,
  ) {}

  update(dt: number): void {
    for (const b of this.grid.buildings) {
      if (b.type === 'miner') {
        b.timer += dt;
        if (b.timer >= MINER.cycle && this.conveyor.spawnFrom(b.x, b.y, b.dir, 'ore')) {
          b.timer = 0;
          this.pop(b.sprite);
        }
      } else if (isMachine(b.type)) {
        const stats = MACHINES[b.type];
        if (b.outputBuf > 0 && this.conveyor.spawnFrom(b.x, b.y, b.dir, stats.output)) {
          b.outputBuf -= 1;
        }
        if (!b.crafting && b.inputOre >= stats.oreIn && b.outputBuf < stats.outputCap) {
          b.inputOre -= stats.oreIn;
          b.crafting = true;
          b.timer = 0;
        }
        if (b.crafting) {
          b.timer += dt;
          if (b.timer >= stats.cycle) {
            b.crafting = false;
            b.outputBuf += 1;
            this.pop(b.sprite);
          }
        }
      }
    }
  }

  private pop(sprite: Phaser.GameObjects.Image): void {
    this.scene.tweens.add({ targets: sprite, scale: 1.1, duration: 60, yoyo: true });
  }
}
