/**
 * Board camera: zoom and pan, kept pure so picking and drawing can never drift.
 *
 * ## Why this exists
 *
 * The board is a fixed 40×20 grid letterboxed onto the device by `Scale.FIT`.
 * On a phone in landscape that puts a 32px tile at roughly 15 css pixels —
 * about a third of a fingertip — so precise placement was effectively a
 * desktop-only feature. Zoom is the fix, and it is the interface every player
 * already knows from every map and every factory game.
 *
 * ## The contract
 *
 * `boardToScreen` and `screenToBoard` are exact inverses, and **Phaser is
 * driven from these numbers rather than read back from**: GameScene calls
 * `setZoom(zoom)` + `centerOn(x, y)`, which makes the camera's mid-point
 * exactly `(x, y)` and its scale exactly `zoom`. That is what lets the formula
 * below be the single source of truth for both the flat renderer and the
 * isometric one, the same way `isoMath` already is for 3D.
 *
 * Everything here is plain numbers — no Phaser, no Three — so the round trip
 * is checked in `boardCam.test.ts` rather than by squinting at a screenshot.
 */

import { BOARD_H, BOARD_W, PLAYFIELD_H } from '../config';

export { BOARD_H, BOARD_W };

export interface BoardCam {
  /** 1 = one board pixel per canvas pixel — the board spans the viewport width */
  zoom: number;
  /** board px at the centre of the viewport */
  x: number;
  y: number;
}

/**
 * The zoom at which the *whole* board is on screen at once.
 *
 * On every viewport tall enough to hold all 20 rows this is exactly 1, which is
 * how it always behaved. On a phone the viewport is deliberately shorter than
 * the board (see `canvasMetrics`), so fitting everything means zooming out —
 * and the player must be able to, or a map they cannot see in full is a map
 * they cannot plan on.
 */
export const FIT_ZOOM = Math.min(1, PLAYFIELD_H / BOARD_H);

/**
 * Never below the fit: zooming out past the whole board would only add empty
 * space and a way to get lost.
 */
export const MIN_ZOOM = FIT_ZOOM;
/**
 * 3× puts a tile at ~45 css px on a phone — comfortably past the ~44px touch
 * target guideline, which is the whole point of the feature.
 */
export const MAX_ZOOM = 3;

/**
 * Open at 1, not at `FIT_ZOOM`. Where the two differ, the board is wider than
 * the viewport is tall, and 1 is the framing that spends the whole screen on
 * the board at a legible tile size — which is the reason the viewport was
 * shortened in the first place. Fitting everything is one pinch away.
 */
export const DEFAULT_ZOOM = 1;

export function defaultCam(): BoardCam {
  return { zoom: DEFAULT_ZOOM, x: BOARD_W / 2, y: BOARD_H / 2 };
}

export function isDefault(c: BoardCam): boolean {
  return c.zoom === DEFAULT_ZOOM && c.x === BOARD_W / 2 && c.y === BOARD_H / 2;
}

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return MIN_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/**
 * Keep the viewport inside the board, so panning can never reveal the void
 * beyond the grid. At zoom 1 the visible region is the whole board and the
 * centre is pinned; as you zoom in the centre gains room to move.
 */
export function clampCam(c: BoardCam, viewW: number, viewH: number): BoardCam {
  const zoom = clampZoom(c.zoom);
  const halfW = viewW / 2 / zoom;
  const halfH = viewH / 2 / zoom;
  // When the visible span exceeds the board on an axis, there is nothing to
  // pan along — pin to the centre rather than letting it drift.
  const spanX = Math.max(0, BOARD_W / 2 - halfW);
  const spanY = Math.max(0, BOARD_H / 2 - halfH);
  const cx = BOARD_W / 2;
  const cy = BOARD_H / 2;
  return {
    zoom,
    x: Math.min(cx + spanX, Math.max(cx - spanX, Number.isFinite(c.x) ? c.x : cx)),
    y: Math.min(cy + spanY, Math.max(cy - spanY, Number.isFinite(c.y) ? c.y : cy)),
  };
}

/** Board px → viewport px. Matches Phaser's `centerOn` + `setZoom` exactly. */
export function boardToScreen(c: BoardCam, bx: number, by: number, viewW: number, viewH: number) {
  return {
    x: (bx - c.x) * c.zoom + viewW / 2,
    y: (by - c.y) * c.zoom + viewH / 2,
  };
}

/** Viewport px → board px. Exact inverse of `boardToScreen`. */
export function screenToBoard(c: BoardCam, sx: number, sy: number, viewW: number, viewH: number) {
  return {
    x: (sx - viewW / 2) / c.zoom + c.x,
    y: (sy - viewH / 2) / c.zoom + c.y,
  };
}

/**
 * Zoom about a fixed point — the pinch midpoint, or the cursor.
 *
 * Anchoring is what makes zoom feel like manipulating the board rather than
 * watching it change size: whatever is under your fingers stays under them.
 */
export function zoomAbout(
  c: BoardCam,
  factor: number,
  anchorSx: number,
  anchorSy: number,
  viewW: number,
  viewH: number,
): BoardCam {
  const before = screenToBoard(c, anchorSx, anchorSy, viewW, viewH);
  const zoom = clampZoom(c.zoom * factor);
  // Solve for the centre that keeps `before` under the anchor at the new zoom.
  const next: BoardCam = {
    zoom,
    x: before.x - (anchorSx - viewW / 2) / zoom,
    y: before.y - (anchorSy - viewH / 2) / zoom,
  };
  return clampCam(next, viewW, viewH);
}

/** Drag the board by a screen-space delta (a pan gesture). */
export function panBy(c: BoardCam, dxScreen: number, dyScreen: number, viewW: number, viewH: number): BoardCam {
  return clampCam({ zoom: c.zoom, x: c.x - dxScreen / c.zoom, y: c.y - dyScreen / c.zoom }, viewW, viewH);
}
