import { describe, expect, it } from 'vitest';

// Appended with the zoom/pan work — see `fitCam`'s IsoCamOpts.

import { GRID_H, GRID_W, PLAYFIELD_H, TILE } from '../config';
import {
  CAM_EYE,
  CAM_RIGHT,
  CAM_UP,
  fitCam,
  groundFromView,
  ISO_PITCH,
  screenToBoard,
  screenToTile,
  toView,
  worldToScreen,
} from './isoMath';

const cam = fitCam();
const dot = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  a.x * b.x + a.y * b.y + a.z * b.z;

describe('camera basis', () => {
  it('is orthonormal', () => {
    for (const v of [CAM_EYE, CAM_RIGHT, CAM_UP]) expect(dot(v, v)).toBeCloseTo(1, 10);
    expect(dot(CAM_EYE, CAM_RIGHT)).toBeCloseTo(0, 10);
    expect(dot(CAM_EYE, CAM_UP)).toBeCloseTo(0, 10);
    expect(dot(CAM_RIGHT, CAM_UP)).toBeCloseTo(0, 10);
  });

  it('keeps screen-right level with the ground, so the horizon never rolls', () => {
    expect(CAM_RIGHT.y).toBe(0);
  });

  it('is true isometric: the three world axes project to equal screen lengths', () => {
    // The defining property of an isometric (as opposed to dimetric) projection.
    // Measured as deltas: toView is affine (it re-centres on the board), so the
    // projected *length of an axis step* is the thing to compare, not the
    // position of a point one unit from the world origin.
    const o = toView(0, 0, 0);
    const axis = (x: number, h: number, z: number) => {
      const v = toView(x, h, z);
      return Math.hypot(v.x - o.x, v.y - o.y);
    };
    const ex = axis(1, 0, 0);
    const ey = axis(0, 1, 0);
    const ez = axis(0, 0, 1);
    expect(ex).toBeCloseTo(ey, 10);
    expect(ey).toBeCloseTo(ez, 10);
  });

  it('looks down at the board rather than at or through it', () => {
    expect(ISO_PITCH).toBeGreaterThan(0.2);
    expect(ISO_PITCH).toBeLessThan(Math.PI / 2);
    expect(CAM_EYE.y).toBeGreaterThan(0);
  });
});

describe('ground picking', () => {
  it('inverts the projection exactly', () => {
    for (const [x, y] of [
      [0, 0],
      [640, 320],
      [1279, 639],
      [37, 611],
    ]) {
      const v = toView(x, 0, y);
      const back = groundFromView(v.x, v.y);
      expect(back.x).toBeCloseTo(x, 8);
      expect(back.y).toBeCloseTo(y, 8);
    }
  });

  it('round-trips board px through the screen', () => {
    for (const [x, y] of [
      [16, 16],
      [1264, 624],
      [512, 96],
    ]) {
      const s = worldToScreen(cam, x, 0, y);
      const back = screenToBoard(cam, s.x, s.y);
      expect(back.x).toBeCloseTo(x, 6);
      expect(back.y).toBeCloseTo(y, 6);
    }
  });

  it('picks the cell a tile centre is drawn at, for every cell on the board', () => {
    for (let ty = 0; ty < GRID_H; ty++) {
      for (let tx = 0; tx < GRID_W; tx++) {
        const s = worldToScreen(cam, tx * TILE + TILE / 2, 0, ty * TILE + TILE / 2);
        expect(screenToTile(cam, s.x, s.y)).toEqual({ tx, ty });
      }
    }
  });

  it('reads off-board for a point past the board edge, so callers can reject it', () => {
    const s = worldToScreen(cam, -TILE / 2, 0, -TILE / 2);
    const t = screenToTile(cam, s.x, s.y);
    expect(t.tx).toBeLessThan(0);
    expect(t.ty).toBeLessThan(0);
  });
});

describe('frustum fitting', () => {
  it('keeps the whole board inside the viewport', () => {
    for (const [x, y] of [
      [0, 0],
      [GRID_W * TILE, 0],
      [0, GRID_H * TILE],
      [GRID_W * TILE, GRID_H * TILE],
    ]) {
      const s = worldToScreen(cam, x, 0, y);
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(GRID_W * TILE);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(PLAYFIELD_H);
    }
  });

  it('leaves headroom above the back edge for a tall tower', () => {
    // A Mk4 tower at the far corner must not have its turret clipped off.
    const s = worldToScreen(cam, GRID_W * TILE, 80, 0);
    expect(s.y).toBeGreaterThanOrEqual(0);
  });

  it('matches the frustum aspect to the viewport, so tiles stay square-on', () => {
    const c = fitCam(0, 0, 1280, 640);
    expect((c.right - c.left) / (c.top - c.bottom)).toBeCloseTo(1280 / 640, 6);
  });

  it('picks correctly in a viewport that is offset and a different shape', () => {
    const c = fitCam(40, 12, 900, 500);
    const s = worldToScreen(c, 700, 0, 200);
    expect(s.x).toBeGreaterThan(40);
    const back = screenToBoard(c, s.x, s.y);
    expect(back.x).toBeCloseTo(700, 6);
    expect(back.y).toBeCloseTo(200, 6);
  });
});

describe('isometric zoom & pan', () => {
  /**
   * The whole reason zoom is safe to add here: `screenToBoard` derives from the
   * returned IsoCam, so it inverts the zoomed projection with no extra code.
   * If this ever fails, picking and drawing have stopped sharing a camera.
   */
  it('keeps picking an exact inverse of drawing at every zoom and pan', () => {
    for (const zoom of [1, 1.6, 2.4, 3]) {
      for (const [panX, panY] of [[640, 320], [300, 200], [1000, 500]]) {
        const c = fitCam(0, 0, GRID_W * TILE, PLAYFIELD_H, { zoom, panX, panY });
        for (let tx = 0; tx < GRID_W; tx += 3) {
          for (let ty = 0; ty < GRID_H; ty += 3) {
            const bx = tx * TILE + TILE / 2;
            const by = ty * TILE + TILE / 2;
            const s = worldToScreen(c, bx, 0, by);
            const back = screenToBoard(c, s.x, s.y);
            expect(back.x, `x @z${zoom} pan${panX},${panY} tile ${tx},${ty}`).toBeCloseTo(bx, 6);
            expect(back.y, `y @z${zoom} pan${panX},${panY} tile ${tx},${ty}`).toBeCloseTo(by, 6);
          }
        }
      }
    }
  });

  it('reproduces the original framing byte for byte at the defaults', () => {
    expect(fitCam(0, 0, 1280, 640, {})).toEqual(fitCam(0, 0, 1280, 640));
    expect(fitCam(0, 0, 1280, 640, { zoom: 1, panX: 640, panY: 320 })).toEqual(fitCam(0, 0, 1280, 640));
  });

  it('narrows the frustum in proportion to the zoom', () => {
    const one = fitCam(0, 0, 1280, 640);
    const two = fitCam(0, 0, 1280, 640, { zoom: 2 });
    expect((two.right - two.left) * 2).toBeCloseTo(one.right - one.left, 6);
    expect((two.top - two.bottom) * 2).toBeCloseTo(one.top - one.bottom, 6);
  });

  /**
   * Panning is a pure translation of the board under the screen, by exactly
   * the pan delta. That — not "the pan point lands dead centre" — is the
   * property anchored zoom relies on, and it is what lets GameScene solve for
   * the pan that keeps a pinch midpoint pinned in a single step instead of
   * iterating.
   *
   * (The pan point does *not* land at the viewport centre, because the base
   * frustum is centred on a bounding box that includes HEADROOM. Preserving
   * that bias is deliberate: it is what keeps the default framing unchanged.)
   */
  it('translates the board under a fixed pixel by exactly the pan delta', () => {
    const base = { zoom: 2, panX: 640, panY: 320 };
    const a = fitCam(0, 0, 1280, 640, base);
    const d = { x: 73, y: -41 };
    const b = fitCam(0, 0, 1280, 640, { zoom: 2, panX: base.panX + d.x, panY: base.panY + d.y });
    for (const [sx, sy] of [[640, 320], [200, 100], [1100, 560]]) {
      const pa = screenToBoard(a, sx, sy);
      const pb = screenToBoard(b, sx, sy);
      expect(pb.x - pa.x, `dx at ${sx},${sy}`).toBeCloseTo(d.x, 6);
      expect(pb.y - pa.y, `dy at ${sx},${sy}`).toBeCloseTo(d.y, 6);
    }
  });

  it('centres the panned-to point horizontally', () => {
    const c = fitCam(0, 0, 1280, 640, { zoom: 2, panX: 300, panY: 200 });
    expect(worldToScreen(c, 300, 0, 200).x).toBeCloseTo(640, 4);
  });

  it('keeps tiles square-on when zoomed, rather than shearing the isometry', () => {
    const c = fitCam(0, 0, 1280, 640, { zoom: 2.5 });
    expect((c.right - c.left) / (c.top - c.bottom)).toBeCloseTo(1280 / 640, 6);
  });

  it('ignores junk zoom and pan rather than producing an unusable camera', () => {
    const c = fitCam(0, 0, 1280, 640, { zoom: NaN, panX: NaN, panY: NaN });
    expect(c).toEqual(fitCam(0, 0, 1280, 640));
    expect(fitCam(0, 0, 1280, 640, { zoom: 0 })).toEqual(fitCam(0, 0, 1280, 640));
    expect(fitCam(0, 0, 1280, 640, { zoom: -3 })).toEqual(fitCam(0, 0, 1280, 640));
  });

  it('still screens the centre tile to the middle of the viewport when unzoomed', () => {
    const c = fitCam(0, 0, 1280, 640);
    const s = worldToScreen(c, 640, 0, 320);
    expect(s.x).toBeCloseTo(640, 4);
  });
});
