import Phaser from 'phaser';
import { isMachine, MACHINES, minerCycle } from '../data/buildings';
import { ConveyorSystem } from './ConveyorSystem';
import { GridSystem, minedResource } from './GridSystem';

/**
 * Ticks miners (ore or crystal, decided by the tile they stand on) and
 * crafting machines (press: ore→ammo, forge: 2 ore→shell,
 * assembler: 2 ore + 1 crystal→piercing).
 */
export class ProductionSystem {
  constructor(
    private scene: Phaser.Scene,
    private grid: GridSystem,
    private conveyor: ConveyorSystem,
  ) {}

  update(dt: number): void {
    for (const b of this.grid.buildings) {
      if (b.type === 'miner') {
        const resource = minedResource(this.grid.cellAt(b.x, b.y)?.kind ?? 'grass');
        if (!resource) continue; // stale placement (map changed under a save)
        b.timer += dt;
        if (b.timer >= minerCycle(resource) && this.conveyor.spawnFrom(b.x, b.y, b.dir, resource)) {
          b.timer = 0;
          this.pop(b.sprite);
        }
      } else if (isMachine(b.type)) {
        const stats = MACHINES[b.type];
        if (b.outputBuf > 0 && this.conveyor.spawnFrom(b.x, b.y, b.dir, stats.output)) {
          b.outputBuf -= 1;
        }
        const fed = b.inputOre >= stats.oreIn && b.inputCrystal >= stats.crystalIn;
        if (!b.crafting && fed && b.outputBuf < stats.outputCap) {
          b.inputOre -= stats.oreIn;
          b.inputCrystal -= stats.crystalIn;
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
