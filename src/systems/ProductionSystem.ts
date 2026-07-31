import Phaser from 'phaser';
import { isMachine, MACHINES, minerCycle, recipeInputs } from '../data/buildings';
import { bumpAmmo, GameState } from '../state/GameState';
import { ConveyorSystem } from './ConveyorSystem';
import { GridSystem, minedResource } from './GridSystem';

/**
 * Ticks miners (ore or crystal, decided by the tile they stand on) and
 * crafting machines (press: ore→ammo, forge: 2 ore→shell,
 * assembler: 2 ore + 1 crystal→piercing).
 */
export class ProductionSystem {
  /** Set by the scene: a tile just ran dry (repaint the terrain, tell the player). */
  onDepleted?: (x: number, y: number) => void;

  constructor(
    private scene: Phaser.Scene,
    private grid: GridSystem,
    private conveyor: ConveyorSystem,
  ) {}

  update(dt: number): void {
    for (const b of this.grid.buildings) {
      if (b.type === 'miner') {
        const resource = minedResource(this.grid.cellAt(b.x, b.y)?.kind ?? 'grass');
        if (!resource) {
          b.stalled = true; // exhausted tile (or a stale save) — nothing left to dig
          b.stallReason = 'empty';
          continue;
        }
        const cycle = minerCycle(resource) / GameState.mods.minerSpeed;
        b.timer += dt;
        const ready = b.timer >= cycle;
        if (ready && this.conveyor.spawnFrom(b.x, b.y, b.dir, resource)) {
          // Subtract the cycle rather than zeroing: whatever the frame overshot
          // by is real elapsed time and belongs to the next unit. Zeroing threw
          // away up to one frame per cycle, so mining rate tracked the display
          // refresh instead of the clock.
          b.timer -= cycle;
          b.stalled = false;
          b.stallReason = null;
          if (this.grid.extract(b.x, b.y)) this.onDepleted?.(b.x, b.y);
          this.pop(b.sprite);
        } else {
          b.stalled = ready; // finished ore with nowhere to put it
          b.stallReason = ready ? 'output' : null;
        }
        // A miner that is ready but blocked holds at exactly one finished unit —
        // it must never bank a backlog that floods the belt once it clears.
        if (b.timer > cycle) b.timer = cycle;
      } else if (isMachine(b.type)) {
        const stats = MACHINES[b.type];
        if (b.outputBuf > 0 && this.conveyor.spawnFrom(b.x, b.y, b.dir, stats.output)) {
          b.outputBuf -= 1;
        }
        const recipe = recipeInputs(b.type);
        const fed = recipe.every(([item, n]) => (b.inputs[item] ?? 0) >= n);
        // starved of inputs, or backed up because nothing is taking the output
        const backedUp = b.outputBuf >= stats.outputCap;
        const starved = !b.crafting && !fed;
        b.stalled = starved || backedUp;
        // Output pressure is reported ahead of input hunger: a machine that is
        // both is waiting on its *outlet*, and widening its supply would do
        // nothing. That distinction is the whole point of naming the reason.
        b.stallReason = backedUp ? 'output' : starved ? 'input' : null;
        const cycle = stats.cycle / GameState.mods.craftSpeed;
        if (!b.crafting && fed && b.outputBuf < stats.outputCap) {
          for (const [item, n] of recipe) b.inputs[item] = (b.inputs[item] ?? 0) - n;
          b.crafting = true;
          // b.timer is deliberately *not* zeroed — it holds the overshoot the
          // last cycle finished with, which is elapsed time this craft has
          // already earned. Zeroing it here is what made craft rate depend on
          // frame length. It only ever advances while `crafting`, so an idle
          // machine cannot accumulate anything here.
        }
        if (b.crafting) {
          b.timer += dt;
          if (b.timer >= cycle) {
            b.crafting = false;
            // Carry the overshoot into the next craft. By construction it is at
            // most the dt that pushed the timer over, so clamping there costs
            // nothing in normal play and stops a cycle shorter than one frame
            // from banking a free craft every tick.
            b.timer = Math.min(b.timer - cycle, dt);
            b.outputBuf += stats.outputPer;
            bumpAmmo(GameState.tally.produced, stats.output, stats.outputPer);
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
