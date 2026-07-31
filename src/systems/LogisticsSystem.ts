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

/** Share of the measurement window this building spent doing its job. */
export function uptimeOf(b: Building): number {
  return b.utilTotal > 0 ? b.utilBusy / b.utilTotal : 0;
}

/**
 * How one cell of the overlay reads. Pure, and deliberately expressed as tints
 * rather than draw calls: the flat view paints these with a Graphics and the
 * isometric one lays them on the ground as decals, and neither should own the
 * meaning of "amber outline". Add a rule here and both views gain it.
 */
export interface OverlayCell {
  /** whole-tile wash — carriers, shaded by throughput */
  fill?: { color: number; alpha: number };
  /** tile outline — producers and towers */
  stroke?: { color: number; alpha: number };
  /** 0–1 magazine fill drawn under a tower */
  mag?: number;
  /** tower uptime readout; null once a tower exists but has no data yet */
  label?: string | null;
  /** colour for `label` */
  labelColor?: string;
}

/**
 * @param pulse 0–1 oscillator, so a starved producer throbs. Passed in rather
 *   than read from a clock, which is what keeps this testable.
 */
export function overlayCell(b: Building, pulse: number): OverlayCell {
  if (isCarrier(b)) {
    const jammed = !!b.item && b.stalled;
    return { fill: { color: jammed ? 0xff5555 : 0x5ef078, alpha: jammed ? 0.5 : 0.1 + uptimeOf(b) * 0.5 } };
  }
  if (isMachine(b.type) || b.type === 'miner') {
    const starved = b.stalled;
    const throb = 0.35 + 0.25 * pulse;
    return { stroke: { color: starved ? 0xff9f43 : 0x5ef078, alpha: starved ? throb + 0.35 : 0.4 } };
  }
  if (isTower(b.type)) {
    const up = uptimeOf(b);
    // No data yet (built after the wave started) reads as "—", not a false 0%
    const measured = b.utilTotal > 0;
    return {
      stroke: { color: b.ammo > 0 ? 0x5ef078 : 0xff5555, alpha: 0.5 },
      mag: b.ammo / TOWERS[b.type].ammoCap,
      label: measured ? `${Math.round(up * 100)}%` : '—',
      labelColor: measured ? uptimeColor(up) : '#8892a6',
    };
  }
  return {};
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

  /**
   * Board px → canvas px. Identity in the flat view; the isometric one supplies
   * its projection, because these labels are Phaser Text drawn on the 2D canvas
   * over the 3D world and would otherwise sit nowhere near their tower.
   */
  project: (x: number, y: number) => { x: number; y: number } = (x, y) => ({ x, y });

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

  private draw(): void {
    this.g.setVisible(true).clear();
    const live = new Set<Building>();
    const pulse = Math.sin(this.scene.time.now / 140);

    for (const b of this.grid.buildings) {
      const px = b.x * TILE;
      const py = b.y * TILE;
      const cell = overlayCell(b, pulse);

      if (cell.fill) {
        this.g.fillStyle(cell.fill.color, cell.fill.alpha);
        this.g.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
      }
      if (cell.stroke) {
        this.g.lineStyle(2, cell.stroke.color, cell.stroke.alpha);
        this.g.strokeRect(px + 1, py + 1, TILE - 2, TILE - 2);
      }
      if (cell.mag !== undefined) {
        // magazine fill, so "80% uptime but currently empty" is visible too
        this.g.fillStyle(0x6bd4ff, 0.5);
        this.g.fillRect(px + 3, py + TILE - 6, Math.round((TILE - 6) * cell.mag), 3);
      }
      if (cell.label !== undefined) {
        const label = this.labelFor(b);
        live.add(b);
        const at = this.project(px + TILE / 2, py - 4);
        label.setPosition(at.x, at.y);
        // Every setText re-rasterises a canvas texture; the percentage only
        // moves a few times a second, so skip the frames where it hasn't.
        if (label.text !== cell.label) label.setText(cell.label ?? '').setColor(cell.labelColor ?? '#ffffff');
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
      // Positioned by the caller each frame — see `project`.
      text = this.scene.add
        .text(0, 0, '', {
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
