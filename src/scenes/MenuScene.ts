import Phaser from 'phaser';
import { GAME_H, GAME_W, IS_TOUCH, TILE } from '../config';
import { BOARD_CX, BOARD_CZ, toView } from '../iso/isoMath';
import { ACHIEVEMENTS } from '../data/achievements';
import {
  accountLabel,
  currentUser,
  isAnonymous,
  linkEmail,
  linkGoogle,
  onAuth,
  setDisplayName,
  signInAnon,
  signInGoogle,
  signInMagicLink,
  signOut,
} from '../services/auth';
import { DEFAULT_MAP_ID, MAPS } from '../data/map';
import { META_CATEGORIES, META_NODES } from '../data/metaTree';
import { fetchLeaderboard, syncOnSignIn } from '../services/cloud';
import { meta } from '../state/meta';
import { clearLocal, lastPickedMap, loadLocal, setPendingLoad, setPendingMap } from '../state/persistence';
import { progress } from '../state/progress';
import { isoSupported, renderMode, toggleRenderMode } from '../state/renderMode';
import { anchorInput } from '../utils/htmlInput';
import { getVolume, isMuted, setVolume, sfx, toggleMute } from '../utils/sfx';

const FONT = { fontFamily: 'monospace' };

/**
 * Title screen: continue/new-run, achievements, leaderboard, account.
 * Sign-in happens only here — OAuth navigates away, so a live run is never
 * interrupted. On auth changes the scene syncs (cloud merge) and re-renders.
 * UIScene sleeps (never stops) while the menu is up so its GameState
 * listeners stay singular.
 */
export class MenuScene extends Phaser.Scene {
  private confirmingNewRun = false;
  private shownUserId: string | null = null;
  private unsubAuth?: () => void;
  /** everything belonging to the open modal — Phaser objects and anchored HTML inputs alike */
  private modal: Array<{ destroy: () => void }> = [];
  /** Mode-specific decoration, torn down and rebuilt when the view is toggled. */
  private backdrop: Phaser.GameObjects.GameObject[] = [];
  private subtitle!: Phaser.GameObjects.Text;

  constructor() {
    super('menu');
  }

  create(): void {
    this.confirmingNewRun = false;
    this.modal = [];
    // Depth -2 so the mode backdrop (-1) sits above it and the buttons (0)
    // above that. The backdrop is rebuilt on toggle, so it cannot rely on
    // display-list insertion order to stay behind the UI.
    this.add.rectangle(0, 0, GAME_W, GAME_H, 0x0e0f1a).setOrigin(0).setDepth(-2);
    // The canvas grows on boxier screens, so the whole title screen is laid out
    // relative to a vertical origin rather than pinned to a 720px-tall canvas.
    const TOP = Math.round((GAME_H - 720) / 2);
    this.buildBackdrop();
    const title = this.add
      .text(GAME_W / 2, TOP + 130, 'FACTORY TD', { ...FONT, fontSize: '64px', fontStyle: 'bold', color: '#ffe066', stroke: '#000', strokeThickness: 10 })
      .setOrigin(0.5);
    this.tweens.add({ targets: title, scale: 1.03, yoyo: true, repeat: -1, duration: 1600, ease: 'Sine.inOut' });
    this.subtitle = this.add
      .text(GAME_W / 2, TOP + 185, '', { ...FONT, fontSize: '15px', color: '#cdd6e4' })
      .setOrigin(0.5);
    this.paintSubtitle();

    // ----- renderer chip (top-left) -----
    // Deliberately not in the button stack: that column already runs to the
    // bottom of the shortest canvas we support, and this is a preference rather
    // than a thing you come to the title screen to do.
    this.buildViewToggle();

    // ----- account chip (top-right) -----
    const chip = this.add
      .text(GAME_W - 16, 16, '...', { ...FONT, fontSize: '13px', fontStyle: 'bold', color: '#cdd6e4' })
      .setOrigin(1, 0);
    const accountBtn = this.add
      .rectangle(GAME_W - 16, 42, 150, 30, 0x1e2233)
      .setOrigin(1, 0)
      .setStrokeStyle(2, 0x2b3040)
      .setInteractive({ useHandCursor: true });
    const accountBtnText = this.add
      .text(GAME_W - 91, 57, 'ACCOUNT', { ...FONT, fontSize: '12px', fontStyle: 'bold', color: '#cdd6e4' })
      .setOrigin(0.5);
    accountBtn.on('pointerdown', () => {
      sfx.place();
      void this.showAccount();
    });
    void currentUser().then((u) => {
      if (this.scene.isActive()) {
        chip.setText(accountLabel(u));
        chip.setColor(u ? '#5ef078' : '#8892a6');
        accountBtnText.setText(u ? 'ACCOUNT' : 'SIGN IN');
      }
    });

    // ----- main buttons -----
    const save = loadLocal();
    let y = TOP + 265;
    if (save) {
      const savedMap = MAPS.find((m) => m.id === save.map)?.name ?? MAPS[0].name;
      this.button(y, `CONTINUE  ${savedMap} · Wave ${save.wave} · $${save.money}`, 0x2e7d4f, 0x5ef078, () => {
        setPendingLoad(save);
        this.startGame();
      });
      y += 62;
    }
    const newRunBtn = this.button(y, 'NEW RUN', save ? 0x1e2233 : 0x2e7d4f, save ? 0x2b3040 : 0x5ef078, () => {
      if (save && !this.confirmingNewRun) {
        this.confirmingNewRun = true;
        newRunBtn.label.setText('OVERWRITE SAVE? CLICK AGAIN');
        newRunBtn.frame.setStrokeStyle(2, 0xff5555);
        this.time.delayedCall(3000, () => {
          if (this.confirmingNewRun && newRunBtn.label.active) {
            this.confirmingNewRun = false;
            newRunBtn.label.setText('NEW RUN');
            newRunBtn.frame.setStrokeStyle(2, 0x2b3040);
          }
        });
        return;
      }
      clearLocal();
      this.startGame();
    });
    y += 62;
    // Paired on one row: the stack has to stay inside the canvas, and neither of
    // these needs the full width.
    const half = 186;
    const halfX = GAME_W / 2 - half / 2 - 4;
    this.button(y, 'HOW TO PLAY', 0x1e2233, 0x2b3040, () => this.showHowToPlay(), half, halfX);
    this.button(
      y,
      `★ ${progress.unlocked.size}/${ACHIEVEMENTS.length}`,
      0x1e2233,
      0x2b3040,
      () => this.showAchievements(),
      half,
      GAME_W / 2 + half / 2 + 4,
    );
    y += 62;
    this.button(y, 'LEADERBOARD', 0x1e2233, 0x2b3040, () => void this.showLeaderboard(), half, halfX);
    // Lit whenever something is actually affordable — an unspent wallet is the
    // one thing on this screen the player should not walk past.
    const canSpend = META_NODES.some((n) => meta.canBuy(n.id));
    this.button(
      y,
      `⚙ WORKSHOP · ${meta.scrap}`,
      canSpend ? 0x2f6f5c : 0x1e2233,
      canSpend ? 0x7cf7c4 : 0x2b3040,
      () => this.showWorkshop(),
      half,
      GAME_W / 2 + half / 2 + 4,
    );

    // Stack the rest sequentially so adding a row can never silently collide
    // with the one below it (the canvas height is no longer a fixed 720).
    y += 74;
    this.buildMapPicker(y);
    y += 88;
    this.buildVolumeControl(y);
    y += 40;

    if (progress.stats.bestWave > 0) {
      this.add
        .text(GAME_W / 2, y, `Personal best: wave ${progress.stats.bestWave}`, { ...FONT, fontSize: '14px', color: '#ffe066' })
        .setOrigin(0.5);
    }
    this.add
      .text(GAME_W / 2, GAME_H - 26, IS_TOUCH
        ? 'New here? Tap HOW TO PLAY · tap a build slot then tap the map · tap it again to cancel · SELL refunds 50% · [?] in-game help'
        : 'New here? Read HOW TO PLAY · 1-9 factory · ZXCV guns · R rotate · drag paints belts · right-click sells · SPACE wave · L logistics · H help', {
        ...FONT, fontSize: '11px', color: '#8892a6',
      })
      .setOrigin(0.5);

    // ----- auth subscription (re-render on real account changes) -----
    this.unsubAuth?.();
    this.unsubAuth = onAuth((event, session) => {
      const uid = session?.user?.id ?? null;
      if (event === 'SIGNED_OUT' && this.shownUserId !== null) {
        this.shownUserId = null;
        if (this.scene.isActive()) this.scene.restart();
      } else if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && uid && uid !== this.shownUserId) {
        this.shownUserId = uid;
        void syncOnSignIn().finally(() => {
          if (this.scene.isActive()) this.scene.restart();
        });
      }
    });
    this.events.once('shutdown', () => {
      this.unsubAuth?.();
      this.unsubAuth = undefined;
    });

    this.input.keyboard?.on('keydown-ESC', () => this.closeModal());
    // anchored HTML inputs live on document.body — never leak them past this scene
    this.events.once('shutdown', () => this.closeModal());
  }

  /**
   * Flat or isometric. The choice is a device preference, so it lives in
   * localStorage rather than the save — a run started in 3D on a desktop
   * continues in 2D on a phone if that is what the phone is set to.
   */
  /**
   * The title screen dresses itself as whichever renderer is selected, so the
   * choice is visible *before* you commit to a run rather than being a label
   * that claims something the screen doesn't show.
   *
   * The isometric backdrop is projected through `isoMath.toView` — the game's
   * actual camera basis, not a hand-rolled 2:1 diamond — so the lattice on the
   * title screen sits at the same angle as the board you are about to play on.
   */
  private buildBackdrop(): void {
    this.backdrop.forEach((o) => o.destroy());
    this.backdrop = [];
    const iso = renderMode() === 'iso';
    const g = this.add.graphics().setDepth(-1);
    this.backdrop.push(g);

    if (!iso) {
      // 2D CLASSIC: the flat tile grid, and the prop row along the bottom.
      g.lineStyle(1, 0x1c2030, 0.9);
      for (let x = 0; x <= GAME_W; x += TILE) g.lineBetween(x, 0, x, GAME_H);
      for (let y = 0; y <= GAME_H; y += TILE) g.lineBetween(0, y, GAME_W, y);
      for (let i = 0; i < 14; i++) {
        this.backdrop.push(
          this.add
            .image(60 + i * 90, GAME_H - 100 + (i % 2) * 24, i % 3 === 0 ? 'tower' : 'belt')
            .setAlpha(0.12)
            .setScale(1.4)
            .setDepth(-1),
        );
      }
      return;
    }

    // 3D ISOMETRIC: a ground lattice at the true camera angle, with a few
    // extruded solids standing on it — the same read as the real board.
    const S = 0.66;
    const CX = GAME_W / 2;
    const CY = GAME_H - 168;
    const pt = (bx: number, by: number, h = 0) => {
      const v = toView(bx, h, by);
      return { x: CX + v.x * S, y: CY - v.y * S };
    };
    const HALF_X = 460;
    const HALF_Y = 300;
    g.lineStyle(1, 0x232a3d, 0.9);
    for (let x = -HALF_X; x <= HALF_X; x += 64) {
      const a = pt(BOARD_CX + x, BOARD_CZ - HALF_Y);
      const b = pt(BOARD_CX + x, BOARD_CZ + HALF_Y);
      g.lineBetween(a.x, a.y, b.x, b.y);
    }
    for (let y = -HALF_Y; y <= HALF_Y; y += 64) {
      const a = pt(BOARD_CX - HALF_X, BOARD_CZ + y);
      const b = pt(BOARD_CX + HALF_X, BOARD_CZ + y);
      g.lineBetween(a.x, a.y, b.x, b.y);
    }

    // The camera sits at +x/+y/+z (see CAM_EYE), so the faces you can see are
    // the ones at max x and max z. Drawing the other two would z-fight nothing
    // and just muddy the silhouette.
    const solid = (bx: number, by: number, w: number, h: number, tint: number) => {
      const top = [pt(bx, by, h), pt(bx + w, by, h), pt(bx + w, by + w, h), pt(bx, by + w, h)];
      const xFace = [pt(bx + w, by, h), pt(bx + w, by + w, h), pt(bx + w, by + w, 0), pt(bx + w, by, 0)];
      const zFace = [pt(bx, by + w, h), pt(bx + w, by + w, h), pt(bx + w, by + w, 0), pt(bx, by + w, 0)];
      g.fillStyle(tint, 0.26);
      g.fillPoints(top, true);
      g.fillStyle(tint, 0.17);
      g.fillPoints(xFace, true);
      g.fillStyle(tint, 0.1);
      g.fillPoints(zFace, true);
    };
    // A little skyline: towers tall and narrow, machines low and wide.
    const props: [number, number, number, number, number][] = [
      [-352, -128, 56, 74, 0xc0504d],
      [-224, 32, 64, 34, 0xd98c3a],
      [-96, -192, 56, 96, 0xc0504d],
      [-32, 96, 64, 30, 0x4a90d9],
      [96, -64, 56, 60, 0xd98c3a],
      [224, 96, 64, 40, 0x4a90d9],
      [320, -160, 56, 84, 0xc0504d],
    ];
    for (const [dx, dy, w, h, tint] of props) solid(BOARD_CX + dx, BOARD_CZ + dy, w, h, tint);
  }

  private paintSubtitle(): void {
    const iso = renderMode() === 'iso';
    this.subtitle
      .setText(
        iso
          ? 'Build the factory. Feed the guns. Hold the line.  ·  3D'
          : 'Build the factory. Feed the guns. Hold the line.',
      )
      .setColor(iso ? '#7cf7c4' : '#cdd6e4');
  }

  private buildViewToggle(): void {
    const supported = isoSupported();
    const label = this.add
      .text(16, 16, 'VIEW', { ...FONT, fontSize: '13px', fontStyle: 'bold', color: '#8892a6' })
      .setOrigin(0, 0);
    label.setVisible(supported);
    if (!supported) return;

    const frame = this.add
      .rectangle(16, 42, 150, 30, 0x1e2233)
      .setOrigin(0, 0)
      .setStrokeStyle(2, 0x2b3040)
      .setInteractive({ useHandCursor: true });
    const text = this.add
      .text(91, 57, '', { ...FONT, fontSize: '12px', fontStyle: 'bold', color: '#cdd6e4' })
      .setOrigin(0.5);
    const paint = () => {
      const iso = renderMode() === 'iso';
      text.setText(iso ? '3D ISOMETRIC' : '2D CLASSIC').setColor(iso ? '#7cf7c4' : '#cdd6e4');
      frame.setStrokeStyle(2, iso ? 0x2f6f5c : 0x2b3040);
    };
    paint();
    frame.on('pointerover', () => frame.setFillStyle(0x28304a));
    frame.on('pointerout', () => frame.setFillStyle(0x1e2233));
    frame.on('pointerdown', () => {
      sfx.place();
      toggleRenderMode();
      paint();
      // The whole screen re-dresses, not just this chip — that is the point.
      this.buildBackdrop();
      this.paintSubtitle();
    });
  }

  private button(
    y: number,
    text: string,
    fill: number,
    stroke: number,
    onClick: () => void,
    width = 380,
    cx = GAME_W / 2,
  ): { frame: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text } {
    const frame = this.add
      .rectangle(cx, y, width, 50, fill)
      .setStrokeStyle(2, stroke)
      .setInteractive({ useHandCursor: true });
    const label = this.add
      .text(cx, y, text, { ...FONT, fontSize: width < 300 ? '14px' : '16px', fontStyle: 'bold', color: '#ffffff' })
      .setOrigin(0.5);
    frame.on('pointerover', () => frame.setFillStyle(fill + 0x0a0a14));
    frame.on('pointerout', () => frame.setFillStyle(fill));
    frame.on('pointerdown', () => {
      sfx.place();
      onClick();
    });
    return { frame, label };
  }

  private startGame(): void {
    if (this.scene.isSleeping('ui')) this.scene.wake('ui');
    else if (!this.scene.isActive('ui')) this.scene.launch('ui');
    this.scene.start('game');
  }

  // ---------- modal helpers ----------

  private openModal(height = 560, width = 980): void {
    this.closeModal();
    // dim swallows and closes on outside-clicks; the panel is interactive so
    // clicks inside it never reach the dim (input.topOnly is true by default)
    const dim = this.add.rectangle(0, 0, GAME_W, GAME_H, 0x000000, 0.75).setOrigin(0).setDepth(10).setInteractive();
    dim.on('pointerdown', () => this.closeModal());
    const panel = this.add
      .rectangle(GAME_W / 2, GAME_H / 2, width, height, 0x141625, 0.98)
      .setStrokeStyle(2, 0x2b3040)
      .setDepth(11)
      .setInteractive();
    this.modal.push(dim, panel);
  }

  private closeModal(): void {
    this.modal.forEach((p) => p.destroy());
    this.modal = [];
  }

  /** Top edge of a centered modal — content must hang off this, not off a fixed y. */
  private modalTop(height: number): number {
    return GAME_H / 2 - height / 2;
  }

  private modalTitle(text: string, height: number): void {
    this.modal.push(
      this.add
        .text(GAME_W / 2, GAME_H / 2 - height / 2 + 34, text, { ...FONT, fontSize: '24px', fontStyle: 'bold', color: '#ffe066' })
        .setOrigin(0.5)
        .setDepth(12),
    );
  }

  private modalClose(height: number): void {
    const y = GAME_H / 2 + height / 2 - 44;
    const close = this.add
      .rectangle(GAME_W / 2, y, 180, 44, 0x2e7d4f)
      .setStrokeStyle(2, 0x5ef078)
      .setDepth(12)
      .setInteractive({ useHandCursor: true });
    const closeText = this.add
      .text(GAME_W / 2, y, 'CLOSE', { ...FONT, fontSize: '15px', fontStyle: 'bold', color: '#ffffff' })
      .setOrigin(0.5)
      .setDepth(13);
    close.on('pointerdown', () => this.closeModal());
    this.modal.push(close, closeText);
  }

  private modalButton(x: number, y: number, w: number, text: string, onClick: () => void): Phaser.GameObjects.Text {
    const frame = this.add
      .rectangle(x, y, w, 44, 0x1e2233)
      .setStrokeStyle(2, 0x2b3040)
      .setDepth(12)
      .setInteractive({ useHandCursor: true });
    const label = this.add
      .text(x, y, text, { ...FONT, fontSize: '14px', fontStyle: 'bold', color: '#e8edf5' })
      .setOrigin(0.5)
      .setDepth(13);
    frame.on('pointerover', () => frame.setFillStyle(0x272c42));
    frame.on('pointerout', () => frame.setFillStyle(0x1e2233));
    frame.on('pointerdown', () => {
      sfx.place();
      onClick();
    });
    this.modal.push(frame, label);
    return label;
  }

  /**
   * The Workshop: spend ⚙ SCRAP on permanent perks.
   *
   * Rebuilt wholesale after every purchase rather than patched in place — the
   * screen is small, a redraw is cheap, and it means the wallet, the pips, the
   * prices and the affordability tints can never disagree with each other.
   */
  private showWorkshop(): void {
    const H = 620;
    const W = 1000;
    this.openModal(H, W);
    const top = this.modalTop(H);
    const left = GAME_W / 2 - W / 2;

    this.modalTitle('WORKSHOP', H);
    this.modal.push(
      this.add
        .text(GAME_W / 2, top + 60, `⚙ ${meta.scrap} SCRAP` , {
          ...FONT, fontSize: '19px', fontStyle: 'bold', color: '#7cf7c4',
        })
        .setOrigin(0.5)
        .setDepth(12),
      this.add
        .text(GAME_W / 2, top + 84, 'Earned every run — deeper runs pay more. Perks are permanent and apply to every new run.', {
          ...FONT, fontSize: '11px', color: '#8892a6',
        })
        .setOrigin(0.5)
        .setDepth(12),
    );

    // Two columns of category blocks. Categories are kept whole: a block never
    // straddles the gutter, for the same reason the build bar's don't.
    const colW = (W - 90) / 2;
    const cols: { x: number; y: number }[] = [
      { x: left + 30, y: top + 112 },
      { x: left + 60 + colW, y: top + 112 },
    ];
    const COL_OF: Record<string, number> = { logistics: 0, production: 0, defense: 1, economy: 1 };

    for (const cat of META_CATEGORIES) {
      const col = cols[COL_OF[cat.id]];
      this.modal.push(
        this.add.rectangle(col.x, col.y, colW, 20, cat.color, 0.16).setOrigin(0).setDepth(12),
        this.add
          .text(col.x + 8, col.y + 10, cat.name, { ...FONT, fontSize: '11px', fontStyle: 'bold', color: cat.css })
          .setOrigin(0, 0.5)
          .setDepth(13),
      );
      col.y += 26;

      for (const node of META_NODES.filter((n) => n.cat === cat.id)) {
        const have = meta.levels(node.id);
        const price = meta.priceOf(node.id);
        const maxed = price === null;
        const afford = meta.canBuy(node.id);
        const rowY = col.y;

        this.modal.push(
          this.add
            .rectangle(col.x, rowY, colW, 48, 0x1a1d2e, 0.9)
            .setOrigin(0)
            .setStrokeStyle(1, maxed ? cat.color : 0x2b3040, maxed ? 0.7 : 0.5)
            .setDepth(12),
          this.add
            .text(col.x + 10, rowY + 9, node.name, { ...FONT, fontSize: '13px', fontStyle: 'bold', color: '#e8edf5' })
            .setDepth(13),
          this.add
            .text(col.x + 10, rowY + 28, node.desc, { ...FONT, fontSize: '10px', color: '#8892a6' })
            .setDepth(13),
        );

        // Level pips — the at-a-glance "how far in am I" read
        for (let i = 0; i < node.max; i++) {
          this.modal.push(
            this.add
              // Far enough left that a 3-pip node clears the buy button —
              // the third pip used to be drawn underneath it.
              .rectangle(col.x + colW - 176 + i * 13, rowY + 14, 9, 9, i < have ? cat.color : 0x2b3040)
              .setOrigin(0)
              .setDepth(13),
          );
        }

        if (maxed) {
          this.modal.push(
            this.add
              .text(col.x + colW - 66, rowY + 24, 'MAX', { ...FONT, fontSize: '12px', fontStyle: 'bold', color: cat.css })
              .setOrigin(0.5)
              .setDepth(13),
          );
        } else {
          const bx = col.x + colW - 118;
          const frame = this.add
            .rectangle(bx, rowY + 8, 108, 32, afford ? 0x2e7d4f : 0x23273a)
            .setOrigin(0)
            .setStrokeStyle(2, afford ? 0x5ef078 : 0x2b3040)
            .setDepth(13);
          const label = this.add
            .text(bx + 54, rowY + 24, `⚙ ${price}`, {
              ...FONT, fontSize: '13px', fontStyle: 'bold', color: afford ? '#ffffff' : '#6b7689',
            })
            .setOrigin(0.5)
            .setDepth(14);
          if (afford) {
            frame.setInteractive({ useHandCursor: true });
            frame.on('pointerover', () => frame.setFillStyle(0x3a9463));
            frame.on('pointerout', () => frame.setFillStyle(0x2e7d4f));
            frame.on('pointerdown', () => {
              if (!meta.buy(node.id)) return;
              sfx.waveClear();
              // Reopen so the wallet and every row repaint together, and refresh
              // the title screen's WORKSHOP button behind it.
              this.showWorkshop();
            });
          }
          this.modal.push(frame, label);
        }
        col.y += 54;
      }
      col.y += 10;
    }

    this.modalClose(H);
  }

  /**
   * The one thing the game could not previously teach: that towers are fed by a
   * factory, not by money. A four-line hint that faded after fourteen seconds
   * was doing this job for a twelve-building palette.
   */
  private showHowToPlay(): void {
    const H = 660;
    const W = 1000;
    this.openModal(H, W);
    this.modalTitle('HOW TO PLAY', H);
    const top = this.modalTop(H);
    const left = GAME_W / 2 - W / 2 + 44;

    const steps: [string, string][] = [
      ['1.  MINE', 'Put a MINER on an orange ore tile. It digs one ore at a time and pushes it out the side it faces — press R before placing to turn it.'],
      ['2.  BELT IT', 'Drag with BELT selected to paint a line. The belts follow your drag, corners included. Items ride the belt one per tile.'],
      ['3.  MAKE AMMO', 'Point the belt into a PRESS (1 ore → 1 ammo). Ammo feeds guns directly — and it is what every deeper machine runs on: FORGE (2 ammo → shell), ASSEMBLER (2 ammo + 1 crystal → piercing round), CHILLER (1 ammo → 2 coolant).'],
      ['4.  FEED THE GUNS', 'Belt finished rounds into a tower. A tower with no ammo turns grey and stops firing — that, not money, is what loses runs. Use SPLITTERS to serve your guns and your deeper machines from one press line.'],
      ['5.  SEND THE WAVE', 'Press SPACE when you are ready. Sending early pays a bonus that ticks down while you build. Kills and clears pay for the next expansion.'],
      ['6.  RESEARCH', 'Build a LAB and belt finished rounds into it instead of into a gun. It converts them to research, and every level lets you pick one of three permanent upgrades. That is the standing decision of the whole game: arm the guns now, or buy power for the rest of the run.'],
    ];
    let y = top + 84;
    for (const [head, body] of steps) {
      this.modal.push(
        this.add.text(left, y, head, { ...FONT, fontSize: '15px', fontStyle: 'bold', color: '#ffe066' }).setDepth(12),
        this.add
          .text(left + 130, y, body, { ...FONT, fontSize: '12px', color: '#cdd6e4', wordWrap: { width: W - 200 }, lineSpacing: 3 })
          .setDepth(12),
      );
      y += 72;
    }

    this.modal.push(
      this.add
        .text(left, y + 6, 'COUNTERS', { ...FONT, fontSize: '15px', fontStyle: 'bold', color: '#ffe066' })
        .setDepth(12),
      this.add
        .text(
          left + 130,
          y + 6,
          'ARMORED waves shrug off bullets — answer them with cannons or lancers.  SWIFT waves come fast and\n' +
            'many — splash damage shines.  BOSS waves cost 5 lives if they get through.  A CRYO field deals no\n' +
            'damage but slows everything at a choke point, which multiplies every gun covering it.',
          { ...FONT, fontSize: '12px', color: '#cdd6e4', lineSpacing: 3 },
        )
        .setDepth(12),
      this.add
        .text(
          GAME_W / 2,
          top + H - 96,
          IS_TOUCH
            ? 'The build bar is split LOGISTICS · PRODUCTION · GUNS. Tap a slot then tap the map (tap it again to cancel) · ROTATE turns it\nSELL then tap to refund half · tap a tower to upgrade · the [?] button in-game reopens this reference'
            : 'The build bar is split LOGISTICS · PRODUCTION · GUNS — keys 1-9 are the factory, ZXCV the guns · H reopens this in-game\nR rotate (also turns whatever is under the cursor) · right-click sells · click a tower to upgrade · L logistics · F speed · P pause',
          { ...FONT, fontSize: '11px', color: '#8892a6', align: 'center' },
        )
        .setOrigin(0.5)
        .setDepth(12),
    );
    this.modalClose(H);
  }

  // ---------- map picker & audio ----------

  /**
   * Layout choice for the next fresh run. It only applies to NEW RUN —
   * continuing a save always returns to the map that run was started on.
   */
  private buildMapPicker(y: number): void {
    const current = lastPickedMap() ?? DEFAULT_MAP_ID;
    this.add
      .text(GAME_W / 2, y - 16, 'MAP', { ...FONT, fontSize: '11px', fontStyle: 'bold', color: '#8892a6' })
      .setOrigin(0.5);
    const blurb = this.add
      .text(GAME_W / 2, y + 50, '', { ...FONT, fontSize: '11px', color: '#8892a6' })
      .setOrigin(0.5);

    const W = 176;
    const gap = 8;
    const total = MAPS.length * W + (MAPS.length - 1) * gap;
    const frames = new Map<string, { frame: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text }>();

    const select = (id: string) => {
      setPendingMap(id);
      for (const [mapId, { frame, label }] of frames) {
        const on = mapId === id;
        frame.setStrokeStyle(2, on ? 0xffe066 : 0x2b3040).setFillStyle(on ? 0x272c42 : 0x1e2233);
        label.setColor(on ? '#ffe066' : '#cdd6e4');
      }
      blurb.setText(MAPS.find((m) => m.id === id)?.blurb ?? '');
    };

    MAPS.forEach((map, i) => {
      const x = GAME_W / 2 - total / 2 + i * (W + gap);
      const frame = this.add
        .rectangle(x, y, W, 34, 0x1e2233)
        .setOrigin(0)
        .setStrokeStyle(2, 0x2b3040)
        .setInteractive({ useHandCursor: true });
      const label = this.add
        .text(x + W / 2, y + 17, map.name, { ...FONT, fontSize: '13px', fontStyle: 'bold', color: '#cdd6e4' })
        .setOrigin(0.5);
      frame.on('pointerover', () => blurb.setText(map.blurb));
      frame.on('pointerout', () => blurb.setText(MAPS.find((m) => m.id === (lastPickedMap() ?? DEFAULT_MAP_ID))?.blurb ?? ''));
      frame.on('pointerdown', () => {
        sfx.place();
        select(map.id);
      });
      frames.set(map.id, { frame, label });
    });
    select(MAPS.some((m) => m.id === current) ? current : DEFAULT_MAP_ID);
  }

  /** Ten-segment master volume. Clicking a segment sets the level and previews it. */
  private buildVolumeControl(y: number): void {
    const SEGMENTS = 10;
    const SW = 22;
    const gap = 4;
    const total = SEGMENTS * SW + (SEGMENTS - 1) * gap;
    const x0 = GAME_W / 2 - total / 2;
    const bars: Phaser.GameObjects.Rectangle[] = [];

    this.add
      .text(x0 - 14, y + 8, '♪', { ...FONT, fontSize: '15px', fontStyle: 'bold', color: '#cdd6e4' })
      .setOrigin(1, 0.5);
    const readout = this.add
      .text(x0 + total + 14, y + 8, '', { ...FONT, fontSize: '12px', fontStyle: 'bold', color: '#cdd6e4' })
      .setOrigin(0, 0.5);

    const paint = () => {
      const level = isMuted() ? 0 : getVolume();
      const lit = Math.round(level * SEGMENTS);
      bars.forEach((bar, i) => bar.setFillStyle(i < lit ? 0x5ef078 : 0x2b3040));
      readout.setText(lit === 0 ? 'MUTED' : `${lit * 10}%`).setColor(lit === 0 ? '#8892a6' : '#cdd6e4');
    };

    for (let i = 0; i < SEGMENTS; i++) {
      const bar = this.add
        .rectangle(x0 + i * (SW + gap), y, SW, 16, 0x2b3040)
        .setOrigin(0)
        .setInteractive({ useHandCursor: true });
      bar.on('pointerdown', () => {
        const level = (i + 1) / SEGMENTS;
        // clicking the lit end again mutes: a one-click off switch
        if (!isMuted() && Math.abs(getVolume() - level) < 0.001) toggleMute();
        else setVolume(level);
        paint();
        sfx.place();
      });
      bars.push(bar);
    }
    paint();
  }

  // ---------- achievements ----------

  private showAchievements(): void {
    const H = 560;
    this.openModal(H);
    this.modalTitle('ACHIEVEMENTS', H);

    const colW = 470;
    const x0 = GAME_W / 2 - colW + 10;
    ACHIEVEMENTS.forEach((a, i) => {
      const x = x0 + (i % 2) * colW;
      const y = this.modalTop(H) + 70 + Math.floor(i / 2) * 52;
      const got = progress.unlocked.has(a.id);
      const cur = Math.min(progress.stats[a.stat], a.goal);
      const detail = a.unlock ? `${a.desc} — ${a.unlock.label}` : a.desc;
      this.modal.push(
        this.add.text(x, y, got ? '★' : '☆', { ...FONT, fontSize: '20px', color: got ? '#ffe066' : '#3a3f52' }).setDepth(12),
        this.add.text(x + 30, y - 2, a.name, { ...FONT, fontSize: '13px', fontStyle: 'bold', color: got ? '#e8edf5' : '#8892a6' }).setDepth(12),
        this.add.text(x + 30, y + 15, `${detail}  (${cur}/${a.goal})`, { ...FONT, fontSize: '10px', color: '#8892a6' }).setDepth(12),
        this.add.rectangle(x + 30, y + 30, 400, 3, 0x1e2233).setOrigin(0, 0.5).setDepth(12),
        this.add
          .rectangle(x + 30, y + 30, Math.round(400 * (cur / a.goal)), 3, got ? 0xffe066 : 0x5ef078)
          .setOrigin(0, 0.5)
          .setDepth(12),
      );
    });
    this.modalClose(H);
  }

  // ---------- leaderboard ----------

  private async showLeaderboard(): Promise<void> {
    const H = 560;
    this.openModal(H);
    this.modalTitle('LEADERBOARD — BEST WAVE', H);
    const loading = this.add
      .text(GAME_W / 2, GAME_H / 2, 'loading…', { ...FONT, fontSize: '14px', color: '#8892a6' })
      .setOrigin(0.5)
      .setDepth(12);
    this.modal.push(loading);
    this.modalClose(H);

    const [rows, me] = await Promise.all([fetchLeaderboard(20), currentUser()]);
    if (!loading.active) return; // modal was closed while loading
    loading.destroy();
    if (rows.length === 0) {
      this.modal.push(
        this.add
          .text(GAME_W / 2, GAME_H / 2, 'No scores yet — sign in and clear a wave to claim the top spot!', { ...FONT, fontSize: '13px', color: '#cdd6e4' })
          .setOrigin(0.5)
          .setDepth(12),
      );
      return;
    }
    rows.forEach((r, i) => {
      const col = i < 10 ? 0 : 1;
      const y = this.modalTop(H) + 70 + (i % 10) * 36;
      const x = GAME_W / 2 - 460 + col * 480;
      const mine = me !== null && r.user_id === me.id;
      const color = mine ? '#5ef078' : i === 0 ? '#ffe066' : '#e8edf5';
      this.modal.push(
        this.add.text(x, y, `${String(i + 1).padStart(2, ' ')}.`, { ...FONT, fontSize: '14px', color: '#8892a6' }).setDepth(12),
        this.add.text(x + 44, y, r.display_name + (mine ? '  (you)' : ''), { ...FONT, fontSize: '14px', fontStyle: mine ? 'bold' : 'normal', color }).setDepth(12),
        this.add.text(x + 360, y, `wave ${r.best_wave}`, { ...FONT, fontSize: '14px', fontStyle: 'bold', color }).setDepth(12),
      );
    });
  }

  // ---------- account ----------

  private async showAccount(): Promise<void> {
    const user = await currentUser(); // resolve first so the layout matches the auth state
    const H = 520;
    this.openModal(H, 560);
    this.modalTitle(user ? 'ACCOUNT' : 'SIGN IN', H);

    const cx = GAME_W / 2;
    const top = GAME_H / 2 - H / 2;
    const status = this.add
      .text(cx, top + H - 92, '', { ...FONT, fontSize: '12px', color: '#ffd75e', align: 'center', wordWrap: { width: 480 } })
      .setOrigin(0.5)
      .setDepth(12);
    this.modal.push(status);

    const note = (y: number, text: string, color = '#8892a6', size = '11px') => {
      this.modal.push(
        this.add.text(cx, y, text, { ...FONT, fontSize: size, color, align: 'center' }).setOrigin(0.5).setDepth(12),
      );
    };
    const inputRow = (y: number, placeholder: string, btnText: string, onSubmit: (value: string) => void) => {
      const input = anchorInput(this, cx - 85, y, 250, 38, placeholder);
      input.node.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') onSubmit(input.node.value.trim());
      });
      this.modal.push(input);
      this.modalButton(cx + 130, y, 150, btnText, () => onSubmit(input.node.value.trim()));
    };
    const withEmail = (value: string, send: () => void) => {
      if (value.includes('@')) send();
      else status.setText('Enter a valid email first');
    };

    if (!user) {
      let y = top + 92;
      note(y, 'Optional — guests keep local saves. An account adds\ncross-device saves, the leaderboard, and synced achievements.', '#cdd6e4', '12px');
      y += 54;
      this.modalButton(cx, y, 440, 'SIGN IN WITH GOOGLE', () => {
        status.setText('Redirecting to Google…');
        void signInGoogle().then((err) => err && status.setText(err));
      });
      y += 66;
      inputRow(y, 'you@example.com', 'MAGIC LINK', (value) =>
        withEmail(value, () => {
          status.setText('Sending…');
          void signInMagicLink(value).then((err) => status.setText(err ?? 'Check your email for the sign-in link!'));
        }),
      );
      y += 72;
      this.modalButton(cx, y, 440, 'CLOUD BACKUP WITHOUT EMAIL', () => {
        status.setText('Creating anonymous account…');
        void signInAnon().then((err) => err && status.setText(err));
      });
      y += 34;
      note(y, 'device-bound; upgrade to Google/email later to keep it forever', '#8892a6', '10px');
    } else {
      let y = top + 88;
      this.modal.push(
        this.add
          .text(cx, y, accountLabel(user), { ...FONT, fontSize: '15px', fontStyle: 'bold', color: '#5ef078' })
          .setOrigin(0.5)
          .setDepth(12),
      );
      if (isAnonymous(user)) {
        y += 34;
        note(y, 'Anonymous account — link it to keep your progress\neven if you clear browser data or switch devices.', '#ffd75e');
        y += 46;
        this.modalButton(cx, y, 440, 'LINK GOOGLE ACCOUNT', () => {
          status.setText('Redirecting to Google…');
          void linkGoogle().then((err) => err && status.setText(err));
        });
        y += 66;
        inputRow(y, 'you@example.com', 'LINK EMAIL', (value) =>
          withEmail(value, () => {
            status.setText('Linking…');
            void linkEmail(value).then((err) =>
              status.setText(
                err
                  ? `${err} — if that email already has an account, sign out and sign in with it; local progress merges automatically.`
                  : 'Confirmation email sent — click the link to finish.',
              ),
            );
          }),
        );
        y += 72;
      } else {
        y += 52;
        inputRow(y, 'display name (leaderboard)', 'SET NAME', (value) => {
          void setDisplayName(value).then((err) => status.setText(err ?? 'Name updated!'));
        });
        y += 80;
      }
      this.modalButton(cx, y, 440, 'SIGN OUT', () => {
        status.setText('Signing out…');
        void signOut();
      });
    }
    this.modalClose(H);
  }
}
