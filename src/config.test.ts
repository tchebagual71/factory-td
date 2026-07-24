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
    expect(portrait.UI_H).toBe(landscape.UI_H);
  });

  it('detects touch from either the event hook or the pointer count', async () => {
    expect((await loadConfig({ innerWidth: 1024, innerHeight: 768, touch: true })).IS_TOUCH).toBe(true);
    expect((await loadConfig({ innerWidth: 1920, innerHeight: 1080 })).IS_TOUCH).toBe(false);
  });
});
