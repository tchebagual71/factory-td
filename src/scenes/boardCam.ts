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

import { GRID_H, GRID_W, TILE } from '../config';

export interface BoardCam {
  /** 1 = the whole board fits the viewport, as it always did */
  zoom: number;
  /** board px at the centre of the viewport */
  x: number;
  y: number;
}

/**
 * Never below 1: the board is designed to be readable in full, and letting the
 * player zoom *out* past it would only add empty space and a way to get lost.
 */
export const MIN_ZOOM = 1;
/**
 * 3× puts a tile at ~45 css px on a phone — comfortably past the ~44px touch
 * target guideline, which is the whole point of the feature.
 */
export const MAX_ZOOM = 3;

export const BOARD_W = GRID_W * TILE;
export const BOARD_H = GRID_H * TILE;

export function defaultCam(): BoardCam {
  return { zoom: MIN_ZOOM, x: BOARD_W / 2, y: BOARD_H / 2 };
}

export function isDefault(c: BoardCam): boolean {
  return c.zoom === MIN_ZOOM && c.x === BOARD_W / 2 && c.y === BOARD_H / 2;
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
