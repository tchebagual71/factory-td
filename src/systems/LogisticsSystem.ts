import Phaser from 'phaser';
import { TILE } from '../config';
import { isMachine, isTower, TOWERS } from '../data/buildings';
import { GameState } from '../state/GameState';
import { Building } from '../types';
import { GridSystem } from './GridSystem';

/** Uptime thresholds for the tower labels: green / amber / red. */
const GOOD = 0.9;
const OK = 0.6;

function uptimeColor(frac: number): string {
  return frac >= GOOD ? '#5ef078' : frac >= OK ? '#ffd75e' : '#ff5555';
}

/** Belt-likes are the throughput carriers; everything else is a producer or consumer. */
function isCarrier(b: Building): boolean {
  return b.type === 'belt' || b.type === 'splitter' || b.type === 'tunnel';
}

/**
 * Measures how well the factory actually served the guns, and draws it on
 * demand (the [L] overlay). Telemetry accumulates only during the wave phase
 * and resets when the next wave starts, so the numbers always describe the
 * last fight rather than an average over idle build time.
 *
 * It derives everything from state the other systems already maintain — the
 * `stalled` flag each of them sets plus magazine/buffer levels — so nothing
 * here can change the simulation.
 */
export class LogisticsSystem {
  private g: Phaser.GameObjects.Graphics;
  private labels = new Map<Building, Phaser.GameObjects.Text>();

  constructor(
    private scene: Phaser.Scene,
    private grid: GridSystem,
  ) {
    this.g = scene.add.graphics().setDepth(20).setVisible(false);
  }

  /** Start a fresh measurement window (called when a wave is sent). */
  resetWindow(): void {
    for (const b of this.grid.buildings) {
      b.utilBusy = 0;
      b.utilBlocked = 0;
      b.utilTotal = 0;
    }
  }

  update(dt: number): void {
    if (GameState.phase === 'wave') this.measure(dt);
    if (GameState.overlay) this.draw();
    else if (this.g.visible) this.hide();
  }

  private measure(dt: number): void {
    for (const b of this.grid.buildings) {
      b.utilTotal += dt;
      if (isTower(b.type)) {
        // "Busy" for a gun means armed — a dry tower is the failure this overlay exists to expose
        if (b.ammo > 0) b.utilBusy += dt;
        else b.utilBlocked += dt;
      } else if (isCarrier(b)) {
        if (b.item) {
          b.utilBusy += dt;
          if (b.stalled) b.utilBlocked += dt;
        }
      } else if (b.crafting) {
        b.utilBusy += dt;
      } else if (b.stalled) {
        b.utilBlocked += dt;
      }
    }
  }

  /** Share of the window this building spent doing its job. */
  private uptime(b: Building): number {
    return b.utilTotal > 0 ? b.utilBusy / b.utilTotal : 0;
  }

  private draw(): void {
    this.g.setVisible(true).clear();
    const live = new Set<Building>();

    for (const b of this.grid.buildings) {
      const px = b.x * TILE;
      const py = b.y * TILE;

      if (isCarrier(b)) {
        // Throughput: how much of the window this cell actually carried something
        const load = this.uptime(b);
        const jammed = !!b.item && b.stalled;
        this.g.fillStyle(jammed ? 0xff5555 : 0x5ef078, jammed ? 0.5 : 0.1 + load * 0.5);
        this.g.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
        continue;
      }

      const starved = b.stalled;
      if (isMachine(b.type) || b.type === 'miner') {
        // Starved or backed-up producers pulse so they are findable at a glance
        const pulse = 0.35 + 0.25 * Math.sin(this.scene.time.now / 140);
        this.g.lineStyle(2, starved ? 0xff9f43 : 0x5ef078, starved ? pulse + 0.35 : 0.4);
        this.g.strokeRect(px + 1, py + 1, TILE - 2, TILE - 2);
        continue;
      }

      if (isTower(b.type)) {
        const up = this.uptime(b);
        const label = this.labelFor(b);
        live.add(b);
        // No data yet (built after the wave started) reads as "—", not a false 0%
        const measured = b.utilTotal > 0;
        label
          .setText(measured ? `${Math.round(up * 100)}%` : '—')
          .setColor(measured ? uptimeColor(up) : '#8892a6');
        this.g.lineStyle(2, b.ammo > 0 ? 0x5ef078 : 0xff5555, 0.5);
        this.g.strokeRect(px + 1, py + 1, TILE - 2, TILE - 2);
        // magazine fill, so "80% uptime but currently empty" is visible too
        const mag = b.ammo / TOWERS[b.type].ammoCap;
        this.g.fillStyle(0x6bd4ff, 0.5);
        this.g.fillRect(px + 3, py + TILE - 6, Math.round((TILE - 6) * mag), 3);
      }
    }

    for (const [b, text] of this.labels) {
      if (!live.has(b)) {
        text.destroy();
        this.labels.delete(b);
      }
    }
  }

  private labelFor(b: Building): Phaser.GameObjects.Text {
    let text = this.labels.get(b);
    if (!text) {
      text = this.scene.add
        .text(b.x * TILE + TILE / 2, b.y * TILE - 4, '', {
          fontFamily: 'monospace',
          fontSize: '11px',
          fontStyle: 'bold',
          color: '#ffffff',
          stroke: '#000000',
          strokeThickness: 3,
        })
        .setOrigin(0.5, 1)
        .setDepth(21);
      this.labels.set(b, text);
    }
    return text;
  }

  private hide(): void {
    this.g.clear().setVisible(false);
    for (const text of this.labels.values()) text.destroy();
    this.labels.clear();
  }
}
