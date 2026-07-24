import Phaser from 'phaser';
import { GAME_W, GRID_H, GRID_W, PLAYFIELD_H, TILE } from '../config';
import { costOf, effStats, isTower, MAX_MK, nextTier, pathOf, TOWERS, UPGRADE_TREE, UpgradeTier } from '../data/buildings';
import { computePathCells, ORE_PATCHES, PATH_WAYPOINTS } from '../data/map';
import { GameState } from '../state/GameState';
import { progress } from '../state/progress';
import { CombatSystem } from '../systems/CombatSystem';
import { ConveyorSystem } from '../systems/ConveyorSystem';
import { GridSystem } from '../systems/GridSystem';
import { ProductionSystem } from '../systems/ProductionSystem';
import { WaveSystem } from '../systems/WaveSystem';
import { Building, BuildingType, Dir, PathId } from '../types';
import { sfx } from '../utils/sfx';

/** Mk-pip / float-text tint per specialization path. */
const PATH_COLORS: Record<PathId, number> = { sniper: 0x6bd4ff, gatling: 0xffe066, siege: 0xff9f43, flak: 0xb18cff };

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

  private selTower: Building | null = null;
  private panel!: Phaser.GameObjects.Container;
  private panelTitle!: Phaser.GameObjects.Text;
  private panelInfo!: Phaser.GameObjects.Text;
  private panelBtnA!: Phaser.GameObjects.Rectangle;
  private panelBtnAText!: Phaser.GameObjects.Text;
  private panelBtnB!: Phaser.GameObjects.Rectangle;
  private panelBtnBText!: Phaser.GameObjects.Text;

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

    this.createUpgradePanel();
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

    const st = this.selTower;
    if (st && this.panel.visible && isTower(st.type)) {
      if (st.mk === 2) {
        const [pa, pb] = UPGRADE_TREE[st.type].paths;
        this.tintAfford(this.panelBtnA, this.panelBtnAText, st, pa.tiers[0]);
        this.tintAfford(this.panelBtnB, this.panelBtnBText, st, pb.tiers[0]);
      } else {
        const tier = nextTier(st.type, st.mk, st.path);
        if (tier) this.tintAfford(this.panelBtnA, this.panelBtnAText, st, tier);
      }
    }
  }

  private tintAfford(btn: Phaser.GameObjects.Rectangle, label: Phaser.GameObjects.Text, b: Building, tier: UpgradeTier): void {
    const can = GameState.money >= tier.money && b.ammo >= tier.ammo;
    btn.setFillStyle(can ? 0x2e7d4f : 0x3a3f52);
    label.setColor(can ? '#ffffff' : '#8892a6');
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

  // ---------- tower upgrades ----------

  private createUpgradePanel(): void {
    this.panel = this.add.container(GAME_W - 266, 44).setDepth(40).setVisible(false);
    const bg = this.add.rectangle(0, 0, 258, 104, 0x141625, 0.94).setOrigin(0).setStrokeStyle(2, 0x2b3040);
    this.panelTitle = this.add.text(10, 7, '', { fontFamily: 'monospace', fontSize: '13px', fontStyle: 'bold', color: '#ffe066' });
    this.panelInfo = this.add.text(10, 25, '', { fontFamily: 'monospace', fontSize: '10px', color: '#cdd6e4', lineSpacing: 2 });
    // Two fixed button slots: A alone for linear tiers, A+B at the Mk3 branch.
    this.panelBtnA = this.add
      .rectangle(10, 78, 114, 20, 0x2e7d4f)
      .setOrigin(0)
      .setStrokeStyle(1, 0x5ef078)
      .setInteractive({ useHandCursor: true });
    this.panelBtnA.on('pointerdown', () => this.tryUpgrade(0));
    this.panelBtnAText = this.add
      .text(67, 88, 'UPGRADE [U]', { fontFamily: 'monospace', fontSize: '10px', fontStyle: 'bold', color: '#ffffff' })
      .setOrigin(0.5);
    this.panelBtnB = this.add
      .rectangle(134, 78, 114, 20, 0x2e7d4f)
      .setOrigin(0)
      .setStrokeStyle(1, 0x5ef078)
      .setInteractive({ useHandCursor: true });
    this.panelBtnB.on('pointerdown', () => this.tryUpgrade(1));
    this.panelBtnBText = this.add
      .text(191, 88, '', { fontFamily: 'monospace', fontSize: '10px', fontStyle: 'bold', color: '#ffffff' })
      .setOrigin(0.5);
    this.panel.add([bg, this.panelTitle, this.panelInfo, this.panelBtnA, this.panelBtnAText, this.panelBtnB, this.panelBtnBText]);
  }

  private selectTower(b: Building | null): void {
    this.selTower = b;
    this.refreshPanel();
  }

  private refreshPanel(): void {
    const b = this.selTower;
    if (!b || !isTower(b.type)) {
      this.panel.setVisible(false);
      return;
    }
    const cur = effStats(b.type, b.mk, b.path);
    const label = b.type === 'cannon' ? 'CANNON' : 'GUN TOWER';
    const pathName = b.path ? ` · ${pathOf(b.type, b.path).name}` : '';
    this.panel.setVisible(true);
    this.panelTitle.setText(`${label} Mk${b.mk}${pathName}`);

    const showA = (text: string) => {
      this.panelBtnA.setVisible(true);
      this.panelBtnAText.setVisible(true).setText(text);
    };
    const showB = (text: string) => {
      this.panelBtnB.setVisible(true);
      this.panelBtnBText.setVisible(true).setText(text);
    };
    this.panelBtnB.setVisible(false);
    this.panelBtnBText.setVisible(false);

    if (b.mk === 2) {
      // The branch: choose a specialization
      const [pa, pb] = UPGRADE_TREE[b.type].paths;
      const sa = effStats(b.type, 3, pa.id);
      const sb = effStats(b.type, 3, pb.id);
      this.panelInfo.setText(
        `${pa.name}: DMG ${sa.damage} RNG ${sa.range} ROF ${sa.fireRate.toFixed(1)}\n  $${pa.tiers[0].money} + full mag (${pa.tiers[0].ammo})\n` +
          `${pb.name}: DMG ${sb.damage} RNG ${sb.range} ROF ${sb.fireRate.toFixed(1)}\n  $${pb.tiers[0].money} + full mag (${pb.tiers[0].ammo})`,
      );
      showA(`${pa.name} [U]`);
      showB(`${pb.name} [I]`);
      return;
    }

    const tier = nextTier(b.type, b.mk, b.path);
    if (tier) {
      const next = effStats(b.type, b.mk + 1, b.path ?? UPGRADE_TREE[b.type].paths[0].id);
      const nextStats = b.mk === 1 ? effStats(b.type, 2) : next;
      this.panelInfo.setText(
        `DMG ${cur.damage}→${nextStats.damage} · RNG ${cur.range}→${nextStats.range}\nROF ${cur.fireRate.toFixed(1)}→${nextStats.fireRate.toFixed(1)}/s\nCost: $${tier.money} + full magazine (${tier.ammo} ${cur.ammoType})`,
      );
      showA('UPGRADE [U]');
    } else {
      this.panelInfo.setText(`DMG ${cur.damage} · RNG ${cur.range} · ROF ${cur.fireRate.toFixed(1)}/s\nMAXED`);
      this.panelBtnA.setVisible(false);
      this.panelBtnAText.setVisible(false);
    }
  }

  private tryUpgrade(choice: 0 | 1 = 0): void {
    const b = this.selTower;
    if (!b || !isTower(b.type) || GameState.gameOver) return;
    let tier: UpgradeTier | null;
    let newPath: PathId | null = null;
    if (b.mk === 2) {
      const p = UPGRADE_TREE[b.type].paths[choice];
      tier = p.tiers[0];
      newPath = p.id;
    } else {
      if (choice === 1) return; // [I] only picks the second path at the branch
      tier = nextTier(b.type, b.mk, b.path);
    }
    if (!tier) return;
    const cx = b.x * TILE + TILE / 2;
    const cy = b.y * TILE + TILE / 2;
    if (b.ammo < tier.ammo) {
      sfx.error();
      this.floatText(cx, cy - 12, 'Need a full magazine!', '#ff5555');
      return;
    }
    if (!GameState.spend(tier.money)) {
      sfx.error();
      this.floatText(cx, cy - 12, `Need $${tier.money}`, '#ff5555');
      return;
    }
    b.ammo -= tier.ammo;
    b.mk += 1;
    if (newPath) b.path = newPath;
    b.invested += tier.money;
    const pipColor = b.path ? PATH_COLORS[b.path] : 0xffe066;
    b.mkPips = b.mkPips ?? [];
    b.mkPips.push(
      this.add.rectangle(cx - 12 + (b.mk - 2) * 8, cy - 15, 5, 5, pipColor).setDepth(6).setStrokeStyle(1, 0xb8962e),
    );
    progress.record('upgradesBought');
    if (b.mk === MAX_MK) progress.record('maxedTowers');
    this.burst(cx, cy, pipColor, 20);
    this.floatText(cx, cy - 16, newPath ? `${pathOf(b.type, newPath).name}!` : `Mk${b.mk}!`, '#ffe066');
    this.cameras.main.shake(80, 0.002);
    sfx.waveClear();
    this.refreshPanel();
  }

  // ---------- input & placement ----------

  private setupInput(): void {
    this.input.mouse?.disableContextMenu();
    const kb = this.input.keyboard!;
    kb.removeAllListeners();
    kb.on('keydown-ONE', () => this.select('belt'));
    kb.on('keydown-TWO', () => this.select('splitter'));
    kb.on('keydown-THREE', () => this.select('tunnel'));
    kb.on('keydown-FOUR', () => this.select('miner'));
    kb.on('keydown-FIVE', () => this.select('press'));
    kb.on('keydown-SIX', () => this.select('forge'));
    kb.on('keydown-SEVEN', () => this.select('tower'));
    kb.on('keydown-EIGHT', () => this.select('cannon'));
    kb.on('keydown-U', () => this.tryUpgrade(0));
    kb.on('keydown-I', () => this.tryUpgrade(1));
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
      if (this.selected) {
        this.tryPlace(this.selected, tx, ty, false);
      } else {
        const b = this.grid.cellAt(tx, ty)?.building;
        this.selectTower(b && isTower(b.type) ? b : null);
      }
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
    if (type) {
      this.ghost.setTexture(type);
      this.selectTower(null);
    }
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
      mk: 1,
      path: null,
      invested: costOf(type),
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
    if (type === 'tunnel') progress.record('tunnelsBuilt');
  }

  private sell(b: Building): void {
    const refund = Math.floor(b.invested / 2);
    if (b.item) this.conveyor.destroyItem(b.item);
    b.sprite.destroy();
    b.barrel?.destroy();
    b.ammoBar?.destroy();
    b.mkPips?.forEach((p) => p.destroy());
    if (this.selTower === b) this.selectTower(null);
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
      const show = hovered && isTower(hovered.type) ? hovered : this.selTower;
      if (show && isTower(show.type)) {
        this.rangeCircle
          .setRadius(effStats(show.type, show.mk, show.path).range)
          .setVisible(true)
          .setPosition(show.x * TILE + TILE / 2, show.y * TILE + TILE / 2);
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
