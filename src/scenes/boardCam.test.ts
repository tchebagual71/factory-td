import { afterEach, describe, expect, it, vi } from 'vitest';
import { GRID_H, GRID_W, PLAYFIELD_H, TILE } from '../config';
import {
  BOARD_H,
  BOARD_W,
  BoardCam,
  MAX_ZOOM,
  MIN_ZOOM,
  boardToScreen,
  clampCam,
  clampZoom,
  defaultCam,
  isDefault,
  panBy,
  screenToBoard,
  zoomAbout,
} from './boardCam';

const VW = GRID_W * TILE;
const VH = PLAYFIELD_H;

describe('board camera', () => {
  it('starts framing the whole board, exactly as it always did', () => {
    const c = defaultCam();
    expect(c.zoom).toBe(1);
    expect(isDefault(c)).toBe(true);
    // at zoom 1 the viewport corners map to the board corners
    expect(screenToBoard(c, 0, 0, VW, VH)).toEqual({ x: 0, y: 0 });
    expect(screenToBoard(c, VW, VH, VW, VH)).toEqual({ x: BOARD_W, y: BOARD_H });
  });

  it('is a no-op transform at the default camera', () => {
    const c = defaultCam();
    for (const [x, y] of [[0, 0], [640, 320], [1279, 639]]) {
      expect(boardToScreen(c, x, y, VW, VH)).toEqual({ x, y });
    }
  });

  /**
   * The load-bearing property, and the same one `isoMath` is held to: if
   * picking and drawing ever disagree, one of them stopped using this module.
   */
  it('round-trips every cell centre at every zoom level', () => {
    for (const zoom of [1, 1.5, 2, 2.75, 3]) {
      const c = clampCam({ zoom, x: 700, y: 300 }, VW, VH);
      for (let tx = 0; tx < GRID_W; tx++) {
        for (let ty = 0; ty < GRID_H; ty++) {
          const bx = tx * TILE + TILE / 2;
          const by = ty * TILE + TILE / 2;
          const s = boardToScreen(c, bx, by, VW, VH);
          const back = screenToBoard(c, s.x, s.y, VW, VH);
          expect(back.x, `x at zoom ${zoom} tile ${tx},${ty}`).toBeCloseTo(bx, 9);
          expect(back.y, `y at zoom ${zoom} tile ${tx},${ty}`).toBeCloseTo(by, 9);
        }
      }
    }
  });

  it('clamps zoom into the usable band', () => {
    expect(clampZoom(0.1)).toBe(MIN_ZOOM);
    expect(clampZoom(99)).toBe(MAX_ZOOM);
    expect(clampZoom(NaN)).toBe(MIN_ZOOM);
    expect(clampZoom(2)).toBe(2);
  });

  it('never zooms out past the board — there is nothing out there', () => {
    expect(MIN_ZOOM).toBe(1);
    const c = zoomAbout(defaultCam(), 0.2, VW / 2, VH / 2, VW, VH);
    expect(c.zoom).toBe(1);
  });

  it('pins the centre at zoom 1, where there is nothing to pan along', () => {
    const c = clampCam({ zoom: 1, x: 0, y: 0 }, VW, VH);
    expect(c.x).toBe(BOARD_W / 2);
    expect(c.y).toBe(BOARD_H / 2);
  });

  it('never lets the viewport leave the board', () => {
    for (const zoom of [1, 1.5, 2, 3]) {
      for (const [x, y] of [[-9999, -9999], [9999, 9999], [0, 640], [1280, 0]]) {
        const c = clampCam({ zoom, x, y }, VW, VH);
        const tl = screenToBoard(c, 0, 0, VW, VH);
        const br = screenToBoard(c, VW, VH, VW, VH);
        expect(tl.x, `left at zoom ${zoom}`).toBeGreaterThanOrEqual(-1e-9);
        expect(tl.y, `top at zoom ${zoom}`).toBeGreaterThanOrEqual(-1e-9);
        expect(br.x, `right at zoom ${zoom}`).toBeLessThanOrEqual(BOARD_W + 1e-9);
        expect(br.y, `bottom at zoom ${zoom}`).toBeLessThanOrEqual(BOARD_H + 1e-9);
      }
    }
  });

  it('survives junk without producing NaN', () => {
    const c = clampCam({ zoom: NaN, x: NaN, y: NaN }, VW, VH);
    expect(Number.isFinite(c.zoom)).toBe(true);
    expect(Number.isFinite(c.x)).toBe(true);
    expect(Number.isFinite(c.y)).toBe(true);
  });
});

describe('zoomAbout', () => {
  /**
   * The thing that makes zoom feel like grabbing the board: whatever is under
   * the pinch midpoint stays under it. Without this the board slides away from
   * your fingers and the gesture feels broken even though the maths "works".
   */
  it('keeps the anchored board point under the anchor', () => {
    for (const [ax, ay] of [[VW / 2, VH / 2], [200, 120], [1100, 500]]) {
      let c = defaultCam();
      const target = screenToBoard(c, ax, ay, VW, VH);
      c = zoomAbout(c, 2, ax, ay, VW, VH);
      const after = boardToScreen(c, target.x, target.y, VW, VH);
      // exact while the clamp is not binding; near the edges the clamp wins,
      // which is the correct trade — staying on the board matters more
      const clamped = clampCam(c, VW, VH);
      if (clamped.x === c.x && clamped.y === c.y) {
        expect(after.x, `anchor x at ${ax},${ay}`).toBeCloseTo(ax, 6);
        expect(after.y, `anchor y at ${ax},${ay}`).toBeCloseTo(ay, 6);
      }
    }
  });

  it('zooms in and back out to where it started', () => {
    const start = clampCam({ zoom: 1.5, x: 640, y: 320 }, VW, VH);
    const inOnce = zoomAbout(start, 1.5, 400, 300, VW, VH);
    const backOut = zoomAbout(inOnce, 1 / 1.5, 400, 300, VW, VH);
    expect(backOut.zoom).toBeCloseTo(start.zoom, 9);
    expect(backOut.x).toBeCloseTo(start.x, 6);
    expect(backOut.y).toBeCloseTo(start.y, 6);
  });
});

describe('panBy', () => {
  it('moves the board with the finger, not against it', () => {
    const start = clampCam({ zoom: 2, x: 640, y: 320 }, VW, VH);
    // dragging right (+dx) should reveal what was to the LEFT, i.e. centre moves left
    const c = panBy(start, 100, 0, VW, VH);
    expect(c.x).toBeLessThan(start.x);
  });

  it('scales the drag by zoom, so a pixel of finger is a pixel of board', () => {
    const start = clampCam({ zoom: 2, x: 640, y: 320 }, VW, VH);
    const c = panBy(start, 100, 0, VW, VH);
    expect(start.x - c.x).toBeCloseTo(50, 9); // 100 screen px at 2× = 50 board px
  });

  it('cannot pan off the board however hard you drag', () => {
    let c: BoardCam = clampCam({ zoom: 3, x: 640, y: 320 }, VW, VH);
    for (let i = 0; i < 200; i++) c = panBy(c, 200, 200, VW, VH);
    const tl = screenToBoard(c, 0, 0, VW, VH);
    expect(tl.x).toBeGreaterThanOrEqual(-1e-9);
    expect(tl.y).toBeGreaterThanOrEqual(-1e-9);
  });

  it('does nothing at zoom 1', () => {
    const c = panBy(defaultCam(), 300, 300, VW, VH);
    expect(isDefault(c)).toBe(true);
  });
});

describe('grid assumptions', () => {
  it('matches the board the rest of the game uses', () => {
    expect(BOARD_W).toBe(GRID_W * TILE);
    expect(BOARD_H).toBe(GRID_H * TILE);
    expect(GRID_H).toBe(20);
    // On a desktop-shaped viewport (what these tests load) the board and the
    // viewport onto it are still the same height, which is why zoom 1 frames
    // everything above. They part company on a phone — see below.
    expect(PLAYFIELD_H).toBe(BOARD_H);
  });
});

/**
 * On a phone the board viewport is deliberately shorter than the board, so the
 * player can be shown ~60% bigger tiles and pan for the rest. That is only an
 * acceptable trade if the whole map stays *reachable* — a tower-defence map you
 * cannot see in full is a map you cannot plan a route against.
 */
describe('a viewport shorter than the board', () => {
  async function loadPhone() {
    vi.resetModules();
    vi.stubGlobal('window', { innerWidth: 932, innerHeight: 390, ontouchstart: () => {} });
    vi.stubGlobal('navigator', { maxTouchPoints: 5 });
    const config = await import('../config');
    const cam = await import('./boardCam');
    return { config, cam };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('can still zoom out far enough to see every row', async () => {
    const { config, cam } = await loadPhone();
    expect(config.PLAYFIELD_H).toBeLessThan(config.BOARD_H);

    const fitted = cam.clampCam({ zoom: cam.MIN_ZOOM, x: 0, y: 0 }, config.GAME_W, config.PLAYFIELD_H);
    const top = cam.screenToBoard(fitted, 0, 0, config.GAME_W, config.PLAYFIELD_H);
    const bottom = cam.screenToBoard(fitted, config.GAME_W, config.PLAYFIELD_H, config.GAME_W, config.PLAYFIELD_H);
    expect(top.y).toBeLessThanOrEqual(0);
    expect(bottom.y).toBeGreaterThanOrEqual(cam.BOARD_H);
  });

  it('opens filling the screen rather than fitting the map', async () => {
    const { cam } = await loadPhone();
    // Fitting everything on open would render the board *smaller* than it was
    // before this change — the opposite of the point.
    expect(cam.defaultCam().zoom).toBe(1);
    expect(cam.MIN_ZOOM).toBeLessThan(1);
  });

  it('lets panning reach the rows that are off screen, and no further', async () => {
    const { config, cam } = await loadPhone();
    const w = config.GAME_W;
    const h = config.PLAYFIELD_H;
    let c = cam.defaultCam();
    for (let i = 0; i < 100; i++) c = cam.panBy(c, 0, 400, w, h);
    expect(cam.screenToBoard(c, 0, 0, w, h).y).toBeCloseTo(0, 6); // the top row, exactly
    for (let i = 0; i < 100; i++) c = cam.panBy(c, 0, -400, w, h);
    expect(cam.screenToBoard(c, 0, h, w, h).y).toBeCloseTo(cam.BOARD_H, 6); // and the bottom
  });
});
