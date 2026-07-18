import Phaser from 'phaser';
import { GRID_H, GRID_W, PLAYFIELD_H, TILE } from '../config';
import { costOf, isTower, TOWERS } from '../data/buildings';
import { computePathCells, ORE_PATCHES, PATH_WAYPOINTS } from '../data/map';
import { GameState } from '../state/GameState';
import { CombatSystem } from '../systems/CombatSystem';
import { ConveyorSystem } from '../systems/ConveyorSystem';
import { GridSystem } from '../systems/GridSystem';
import { ProductionSystem } from '../systems/ProductionSystem';
import { WaveSystem } from '../systems/WaveSystem';
import { Building, BuildingType, Dir } from '../types';
import { sfx } from '../utils/sfx';

export class GameScene extends Phaser.Scene {
  private grid!: GridSystem;
  private conveyor!: ConveyorSystem;
  private production!: ProductionSystem;
  private waveSystem!: WaveSystem;
  private combat!: CombatSystem;

  private selected: BuildingType | null = null;
  private buildDir: Dir = 0;
  private ghost!: Phaser.GameObjects.Image;
  private rangeCircle!: Phaser.GameObjects.Arc;

  constructor() {
    super('game');
  }

  create(): void {
    GameState.reset();

    this.grid = new GridSystem();
    this.conveyor = new ConveyorSystem(this, this.grid);
    this.production = new ProductionSystem(this, this.grid, this.conveyor);
    this.waveSystem = new WaveSystem(this);
    this.combat = new CombatSystem(this, this.grid, this.waveSystem);

    this.drawTerrain();

    this.ghost = this.add.image(0, 0, 'belt').setAlpha(0).setDepth(10);
    this.rangeCircle = this.add
      .circle(0, 0, TOWERS.tower.range, 0xffe066, 0.07)
      .setStrokeStyle(1.5, 0xffe066, 0.6)
      .setVisible(false)
      .setDepth(10);

    this.setupInput();

    // Scene events from the UI (off first — create() re-runs on restart)
    GameState.events.off('ui:select').on('ui:select', (t: BuildingType) => this.select(t));
    GameState.events.off('ui:startwave').on('ui:startwave', () => this.waveSystem.start());

    const hint = this.add
      .text(
        640,
        90,
        'MINERS on ore → belt ore into a PRESS (ammo for GUNS) or FORGE (shells for CANNONS)\nTowers start pre-loaded but run dry fast — keep the supply chains flowing!  [SPACE] sends the wave.',
        { fontFamily: 'monospace', fontSize: '14px', color: '#cdd6e4', align: 'center', stroke: '#000', strokeThickness: 4 },
      )
      .setOrigin(0.5)
      .setDepth(30);
    this.tweens.add({ targets: hint, alpha: 0, delay: 14000, duration: 1500, onComplete: () => hint.destroy() });
  }

  update(_t: number, deltaMs: number): void {
    if (GameState.gameOver) return;
    const dt = Math.min(deltaMs / 1000, 0.05) * GameState.speed;
    this.waveSystem.update(dt);
    this.conveyor.update(dt);
    this.production.update(dt);
    this.combat.update(dt);
    this.updateGhost();
  }

  // ---------- juice helpers (used by systems) ----------

  floatText(x: number, y: number, msg: string, color: string): void {
    const t = this.add
      .text(x, y, msg, { fontFamily: 'monospace', fontSize: '14px', fontStyle: 'bold', color, stroke: '#000', strokeThickness: 3 })
      .setOrigin(0.5)
      .setDepth(30);
    this.tweens.add({ targets: t, y: y - 30, alpha: 0, duration: 850, ease: 'Cubic.out', onComplete: () => t.destroy() });
  }

  bigText(msg: string): void {
    const t = this.add
      .text(640, 260, msg, { fontFamily: 'monospace', fontSize: '32px', fontStyle: 'bold', color: '#ffe066', stroke: '#000', strokeThickness: 6 })
      .setOrigin(0.5)
      .setScale(0.3)
      .setDepth(30);
    this.tweens.add({ targets: t, scale: 1, duration: 250, ease: 'Back.out' });
    this.tweens.add({ targets: t, alpha: 0, y: 210, delay: 1300, duration: 600, onComplete: () => t.destroy() });
  }

  burst(x: number, y: number, tint: number, count: number): void {
    const e = this.add.particles(x, y, 'px', {
      speed: { min: 40, max: 170 },
      lifespan: { min: 150, max: 450 },
      scale: { start: 1.2, end: 0 },
      tint,
      emitting: false,
    });
    e.setDepth(25);
    e.explode(count);
    this.time.delayedCall(500, () => e.destroy());
  }

  // ---------- input & placement ----------

  private setupInput(): void {
    this.input.mouse?.disableContextMenu();
    const kb = this.input.keyboard!;
    kb.removeAllListeners();
    kb.on('keydown-ONE', () => this.select('belt'));
    kb.on('keydown-TWO', () => this.select('splitter'));
    kb.on('keydown-THREE', () => this.select('miner'));
    kb.on('keydown-FOUR', () => this.select('press'));
    kb.on('keydown-FIVE', () => this.select('forge'));
    kb.on('keydown-SIX', () => this.select('tower'));
    kb.on('keydown-SEVEN', () => this.select('cannon'));
    kb.on('keydown-R', () => {
      this.buildDir = ((this.buildDir + 1) % 4) as Dir;
    });
    kb.on('keydown-ESC', () => this.select(null));
    kb.on('keydown-SPACE', () => this.waveSystem.start());
    kb.on('keydown-F', () => GameState.cycleSpeed());

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.y >= PLAYFIELD_H) return;
      const tx = Math.floor(p.x / TILE);
      const ty = Math.floor(p.y / TILE);
      if (p.rightButtonDown()) {
        const b = this.grid.cellAt(tx, ty)?.building;
        if (b) this.sell(b);
        else this.select(null);
        return;
      }
      if (this.selected) this.tryPlace(this.selected, tx, ty, false);
    });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      // drag-paint belts
      if (this.selected === 'belt' && p.isDown && p.leftButtonDown() && p.y < PLAYFIELD_H) {
        this.tryPlace('belt', Math.floor(p.x / TILE), Math.floor(p.y / TILE), true);
      }
    });
  }

  private select(type: BuildingType | null): void {
    this.selected = type;
    GameState.events.emit('selected', type);
    if (type) this.ghost.setTexture(type);
  }

  private tryPlace(type: BuildingType, tx: number, ty: number, silent: boolean): void {
    if (GameState.gameOver) return;
    if (!this.grid.canPlace(type, tx, ty)) {
      if (!silent) sfx.error();
      return;
    }
    if (!GameState.spend(costOf(type))) {
      if (!silent) {
        sfx.error();
        this.floatText(tx * TILE + 16, ty * TILE + 8, 'Need $' + costOf(type), '#ff5555');
      }
      return;
    }

    const cx = tx * TILE + TILE / 2;
    const cy = ty * TILE + TILE / 2;
    const tower = isTower(type);
    const depth = type === 'belt' || type === 'splitter' ? 1 : 3;
    const sprite = this.add.image(cx, cy, type).setDepth(depth);
    if (!tower) sprite.setRotation((this.buildDir * Math.PI) / 2);

    const b: Building = {
      type,
      x: tx,
      y: ty,
      dir: this.buildDir,
      sprite,
      item: null,
      outIdx: 0,
      timer: 0,
      crafting: false,
      inputOre: 0,
      outputBuf: 0,
      ammo: tower ? TOWERS[type].startAmmo : 0,
      cooldown: 0,
    };
    if (tower) {
      const barColor = type === 'cannon' ? 0xff9f43 : 0xffe066;
      b.barrel = this.add
        .image(cx, cy, type === 'cannon' ? 'barrel-cannon' : 'barrel')
        .setOrigin(0.15, 0.5)
        .setDepth(4);
      b.ammoBar = this.add.rectangle(cx - 12, cy + 15, 24, 3, barColor).setOrigin(0, 0.5).setDepth(6);
    }
    this.grid.place(b);

    sprite.setScale(0.5);
    this.tweens.add({ targets: sprite, scale: 1, duration: 130, ease: 'Back.out' });
    sfx.place();
  }

  private sell(b: Building): void {
    const refund = Math.floor(costOf(b.type) / 2);
    if (b.item) this.conveyor.destroyItem(b.item);
    b.sprite.destroy();
    b.barrel?.destroy();
    b.ammoBar?.destroy();
    this.grid.remove(b);
    GameState.addMoney(refund);
    this.floatText(b.x * TILE + 16, b.y * TILE + 8, `+$${refund}`, '#9aa7bd');
    this.burst(b.x * TILE + 16, b.y * TILE + 16, 0x9aa7bd, 8);
    sfx.sell();
  }

  private updateGhost(): void {
    const p = this.input.activePointer;
    const tx = Math.floor(p.x / TILE);
    const ty = Math.floor(p.y / TILE);
    if (!this.selected || p.y >= PLAYFIELD_H) {
      this.ghost.setAlpha(0);
      // show range of an existing tower under the cursor
      const hovered = p.y < PLAYFIELD_H ? this.grid.cellAt(tx, ty)?.building : null;
      if (hovered && isTower(hovered.type)) {
        this.rangeCircle
          .setRadius(TOWERS[hovered.type].range)
          .setVisible(true)
          .setPosition(hovered.x * TILE + TILE / 2, hovered.y * TILE + TILE / 2);
      } else {
        this.rangeCircle.setVisible(false);
      }
      return;
    }
    const cx = tx * TILE + TILE / 2;
    const cy = ty * TILE + TILE / 2;
    const ok = this.grid.canPlace(this.selected, tx, ty) && GameState.money >= costOf(this.selected);
    const towerSel = isTower(this.selected);
    this.ghost
      .setAlpha(0.6)
      .setPosition(cx, cy)
      .setRotation(towerSel ? 0 : (this.buildDir * Math.PI) / 2)
      .setTint(ok ? 0x88ff88 : 0xff6666);
    if (towerSel) this.rangeCircle.setRadius(TOWERS[this.selected as 'tower' | 'cannon'].range);
    this.rangeCircle.setVisible(towerSel).setPosition(cx, cy);
  }

  // ---------- terrain ----------

  private drawTerrain(): void {
    const g = this.add.graphics().setDepth(0);
    const pathCells = computePathCells();
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const px = x * TILE;
        const py = y * TILE;
        if (pathCells.has(`${x},${y}`)) {
          g.fillStyle(0xc8a15a);
          g.fillRect(px, py, TILE, TILE);
          g.fillStyle(0xb08c4a);
          g.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
        } else {
          g.fillStyle((x + y) % 2 === 0 ? 0x2f4f43 : 0x2b4a3f);
          g.fillRect(px, py, TILE, TILE);
        }
      }
    }
    for (const patch of ORE_PATCHES) {
      for (let y = patch.y; y < patch.y + patch.h; y++) {
        for (let x = patch.x; x < patch.x + patch.w; x++) {
          const px = x * TILE;
          const py = y * TILE;
          g.fillStyle(0x24382f);
          g.fillRect(px, py, TILE, TILE);
          g.fillStyle(0xb35c1e);
          g.fillCircle(px + 9, py + 11, 4);
          g.fillCircle(px + 22, py + 20, 5);
          g.fillCircle(px + 13, py + 24, 3);
          g.fillStyle(0xff9f43);
          g.fillCircle(px + 9, py + 11, 2);
          g.fillCircle(px + 22, py + 20, 2.5);
        }
      }
    }
    // subtle grid lines
    g.lineStyle(1, 0xffffff, 0.035);
    for (let x = 0; x <= GRID_W; x++) g.lineBetween(x * TILE, 0, x * TILE, PLAYFIELD_H);
    for (let y = 0; y <= GRID_H; y++) g.lineBetween(0, y * TILE, GRID_W * TILE, y * TILE);

    // spawn & exit markers
    const first = PATH_WAYPOINTS[0];
    const last = PATH_WAYPOINTS[PATH_WAYPOINTS.length - 1];
    g.fillStyle(0x3d1f5c, 1);
    g.fillRect(0, first.y * TILE, TILE / 2, TILE);
    g.fillStyle(0x8f1f1f, 1);
    g.fillRect(GRID_W * TILE - TILE / 2, last.y * TILE, TILE / 2, TILE);
  }
}
