import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The canvas is sized once at module load from the window's aspect ratio, so
 * these load a fresh copy of `config` per simulated device. The playfield is
 * always the same 1280×640 tile grid — only the HUD bar underneath flexes.
 */
async function loadConfig(win?: { innerWidth: number; innerHeight: number; touch?: boolean }) {
  vi.resetModules();
  if (win) {
    vi.stubGlobal('window', {
      innerWidth: win.innerWidth,
      innerHeight: win.innerHeight,
      ...(win.touch ? { ontouchstart: () => {} } : {}),
    });
    vi.stubGlobal('navigator', { maxTouchPoints: win.touch ? 5 : 0 });
  } else {
    vi.stubGlobal('window', undefined);
  }
  return import('./config');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('canvas sizing', () => {
  it('calculates a touch-safe, aspect-aware HUD height for each viewport', async () => {
    const { uiHeightForViewport } = await loadConfig();
    // 168, not 220: the touch palette is tabbed (one shelf at a time), so the
    // bar no longer needs two rows of thirteen slots. That bar was 40% of a
    // phone screen — see `uiHeightForViewport`.
    expect(uiHeightForViewport({ width: 844, height: 390, touch: true })).toBeGreaterThanOrEqual(168);
    expect(uiHeightForViewport({ width: 1440, height: 900, touch: false })).toBe(160);
    expect(uiHeightForViewport({ width: 1920, height: 1080, touch: false })).toBe(80);
  });

  it('keeps the classic 1280×720 on a 16:9 desktop', async () => {
    const c = await loadConfig({ innerWidth: 1920, innerHeight: 1080 });
    expect(c.GAME_W).toBe(1280);
    expect(c.UI_H).toBe(80);
    expect(c.GAME_H).toBe(720);
    expect(c.ROOMY_UI).toBe(false);
  });

  it('falls back to the desktop size with no window (tests / SSR)', async () => {
    const c = await loadConfig();
    expect(c.GAME_H).toBe(720);
    expect(c.IS_TOUCH).toBe(false);
  });

  it('spends a 4:3 tablet’s extra height on HUD instead of letterbox bars', async () => {
    const c = await loadConfig({ innerWidth: 1024, innerHeight: 768, touch: true });
    // 4:3 wants a 960-tall canvas; the grid takes 640 and the bar would take
    // the remaining 320, clamped to the 300px ceiling
    expect(c.UI_H).toBe(300);
    expect(c.ROOMY_UI).toBe(true);
    // and the canvas is much closer to the device aspect than a fixed 720 would be
    const canvasAspect = c.GAME_H / c.GAME_W;
    expect(Math.abs(canvasAspect - 768 / 1024)).toBeLessThan(Math.abs(720 / 1280 - 768 / 1024));
  });

  it('never lets the bar swallow the board, however boxy the screen', async () => {
    const c = await loadConfig({ innerWidth: 1000, innerHeight: 1000, touch: true });
    expect(c.UI_H).toBeLessThanOrEqual(300);
    expect(c.PLAYFIELD_H).toBe(640); // the grid never shrinks
  });

  it('gives a wide phone the roomy touch HUD even though its aspect wants a thin one', async () => {
    const c = await loadConfig({ innerWidth: 844, innerHeight: 390, touch: true });
    expect(c.IS_TOUCH).toBe(true);
    expect(c.ROOMY_UI).toBe(true); // finger-sized buttons beat a few more rows of board
    expect(c.UI_H).toBeGreaterThan(80);
  });

  it('treats a portrait phone as its landscape equivalent (a rotate prompt covers portrait)', async () => {
    const landscape = await loadConfig({ innerWidth: 844, innerHeight: 390, touch: true });
    const portrait = await loadConfig({ innerWidth: 390, innerHeight: 844, touch: true });
    // The whole canvas, not just the bar: loading in portrait and then turning
    // the phone must not leave the board a different shape than loading in
    // landscape did, because the canvas is sized once at module load.
    expect([portrait.UI_H, portrait.PLAYFIELD_H, portrait.GAME_H]).toEqual([
      landscape.UI_H,
      landscape.PLAYFIELD_H,
      landscape.GAME_H,
    ]);
  });

  it('detects touch from either the event hook or the pointer count', async () => {
    expect((await loadConfig({ innerWidth: 1024, innerHeight: 768, touch: true })).IS_TOUCH).toBe(true);
    expect((await loadConfig({ innerWidth: 1920, innerHeight: 1080 })).IS_TOUCH).toBe(false);
  });
});

/**
 * `Scale.FIT` letterboxes whatever it is handed, so any mismatch between the
 * canvas aspect and the device's is lost to black bars — on an iPhone in
 * landscape that was ~38% of the screen width. These check the canvas actually
 * covers the viewport, and that the price is only paid where it buys something.
 */
describe('filling the device screen', () => {
  /** Fraction of the viewport each axis covers once Scale.FIT has fitted the canvas. */
  function coverage(c: { GAME_W: number; GAME_H: number }, width: number, height: number) {
    const scale = Math.min(width / c.GAME_W, height / c.GAME_H);
    return { x: (c.GAME_W * scale) / width, y: (c.GAME_H * scale) / height, tile: 32 * scale };
  }

  // The screens this has to survive, and whether the board should shorten.
  const phones = [
    ['iPhone 15 Pro landscape', 932, 390],
    ['iPhone SE landscape', 667, 375],
    ['Pixel-ish landscape', 844, 390],
  ] as const;

  for (const [name, w, h] of phones) {
    it(`covers the screen on a ${name}`, async () => {
      const c = await loadConfig({ innerWidth: w, innerHeight: h, touch: true });
      const cover = coverage(c, w, h);
      // Both axes, because covering one by shrinking the other is not a fix.
      expect(cover.x).toBeGreaterThan(0.98);
      expect(cover.y).toBeGreaterThan(0.98);
    });

    it(`buys a bigger tile on a ${name} by showing fewer rows`, async () => {
      const c = await loadConfig({ innerWidth: w, innerHeight: h, touch: true });
      // The board is untouched; only the viewport onto it is shorter.
      expect(c.BOARD_H).toBe(640);
      expect(c.PLAYFIELD_H).toBeLessThan(c.BOARD_H);
      // …and never so short it stops reading as a map.
      expect(c.PLAYFIELD_H).toBeGreaterThanOrEqual(320);

      const before = 32 * Math.min(w / c.BOARD_W, h / (c.BOARD_H + c.UI_H));
      expect(coverage(c, w, h).tile).toBeGreaterThan(before);
    });
  }

  /**
   * The gate that keeps this off desktop. A 21:9 monitor letterboxes a little,
   * but a tile is already 48px there — hiding six rows would cost real
   * information to buy legibility nobody was short of.
   */
  it('keeps the whole board on a widescreen desktop, where tiles are already big', async () => {
    const c = await loadConfig({ innerWidth: 2560, innerHeight: 1080 });
    expect(c.PLAYFIELD_H).toBe(c.BOARD_H);
    expect(c.GAME_H).toBe(720);
    expect(coverage(c, 2560, 1080).tile).toBeGreaterThanOrEqual(22);
  });

  it('leaves the 16:9 desktop canvas exactly as it was', async () => {
    const c = await loadConfig({ innerWidth: 1920, innerHeight: 1080 });
    expect([c.GAME_W, c.GAME_H, c.PLAYFIELD_H, c.UI_H]).toEqual([1280, 720, 640, 80]);
  });

  it('leaves the tablet canvas exactly as it was', async () => {
    const c = await loadConfig({ innerWidth: 1024, innerHeight: 768, touch: true });
    expect([c.GAME_W, c.GAME_H, c.PLAYFIELD_H, c.UI_H]).toEqual([1280, 940, 640, 300]);
  });

  /**
   * The title screen used to preserve a 720px virtual surface and shrink it a
   * second time after Phaser fitted the canvas. That made 11px copy roughly 6px
   * on a phone. It now lays out directly in the actual canvas.
   */
  it('does not apply a second menu scale on a short phone canvas', async () => {
    for (const [, w, h] of phones) {
      const c = await loadConfig({ innerWidth: w, innerHeight: h, touch: true });
      expect(c.MENU_SCALE).toBe(1);
      expect(c.MENU_W).toBe(c.GAME_W);
      expect(c.MENU_H).toBe(c.GAME_H);
    }
  });

  it('does not scale the title screen where the canvas is already tall enough', async () => {
    for (const win of [{ innerWidth: 1920, innerHeight: 1080 }, { innerWidth: 1024, innerHeight: 768, touch: true }]) {
      const c = await loadConfig(win);
      expect(c.MENU_SCALE).toBe(1);
      expect(c.MENU_H).toBe(c.GAME_H);
    }
  });
});
