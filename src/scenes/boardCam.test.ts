import { describe, expect, it } from 'vitest';
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
    expect(BOARD_H).toBe(PLAYFIELD_H);
    expect(GRID_H).toBe(20);
  });
});
