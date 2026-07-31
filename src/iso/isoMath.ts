import { GRID_H, GRID_W, PLAYFIELD_H, TILE } from '../config';

/**
 * Isometric projection, kept pure so the camera the renderer builds and the
 * maths the mouse is picked with can never drift apart. Everything in here is
 * plain numbers — no Three.js, no Phaser — and the renderer configures its
 * orthographic camera *from* these constants rather than alongside them.
 *
 * ## Coordinate spaces
 *
 * - **board px** — the 2D game's own space: x right, y down, (0,0) top-left of
 *   the playfield, 32px to a tile. Every system in `src/systems` speaks this and
 *   nothing here changes that.
 * - **world** — the 3D scene: `x` = board px x, `z` = board px y, `y` = height
 *   above the ground in the same pixel scale. So a 32px tile is a 32×32 world
 *   footprint and a 22-high machine is 22 world units tall.
 * - **view** — world rotated into the camera's basis: `vx` right across the
 *   screen, `vy` up it. The projection is orthographic, so this is the whole of
 *   it; there is no perspective divide to invert.
 * - **screen** — Phaser *design* pixels (1280 × GAME_H), which is what
 *   `Pointer.x/y` reports regardless of how `Scale.FIT` letterboxes the canvas.
 *   That is the only reason picking works without knowing the canvas size.
 */

/** Camera yaw about world Y. 45° puts the board on its corner — the isometric read. */
export const ISO_YAW = Math.PI / 4;

/**
 * Camera pitch. `atan(1/√2)` ≈ 35.264° is *true* isometric: the three world
 * axes project to exactly 120° apart and a cube's three visible faces come out
 * equal. The 2:1 pixel-art convention (26.57°) is a cheaper approximation of
 * this; we can afford the real one.
 */
export const ISO_PITCH = Math.atan(Math.SQRT1_2);

export interface Vec2 {
  x: number;
  y: number;
}

const SY = Math.sin(ISO_YAW);
const CY = Math.cos(ISO_YAW);
const SP = Math.sin(ISO_PITCH);
const CP = Math.cos(ISO_PITCH);

/**
 * Camera basis, derived exactly as `Object3D.lookAt` derives it, so a Three
 * camera placed at `target + CAM_EYE * d` looking at `target` has precisely
 * these axes. Deriving them here rather than trusting the renderer is what lets
 * `screenToBoard` be the inverse of what is actually drawn.
 */
export const CAM_EYE = { x: SY * CP, y: SP, z: CY * CP };
/** Screen-right in world space. Level with the ground — pitch never rolls the camera. */
export const CAM_RIGHT = { x: CY, y: 0, z: -SY };
/** Screen-up in world space. */
export const CAM_UP = { x: -SY * SP, y: CP, z: -CY * SP };

/** Board centre in world space — what the camera looks at. */
export const BOARD_CX = (GRID_W * TILE) / 2;
export const BOARD_CZ = (GRID_H * TILE) / 2;

/** Tallest thing on the board, for frustum fitting. Towers + a lance in flight. */
const HEADROOM = 90;
/** Breathing room around the board, in view units. */
const MARGIN = 26;

export interface IsoCam {
  /** orthographic frustum in view units, relative to the board centre */
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** the screen rect (design px) the 3D world is drawn into */
  vx: number;
  vy: number;
  vw: number;
  vh: number;
}

/** World point (board px x, height, board px y) → view units, relative to board centre. */
export function toView(x: number, h: number, y: number): Vec2 {
  const dx = x - BOARD_CX;
  const dz = y - BOARD_CZ;
  return {
    x: dx * CAM_RIGHT.x + h * CAM_RIGHT.y + dz * CAM_RIGHT.z,
    y: dx * CAM_UP.x + h * CAM_UP.y + dz * CAM_UP.z,
  };
}

/**
 * Invert `toView` back onto the ground plane (h = 0). Two unknowns, two
 * equations, and because the projection is orthographic this is exact — the
 * same answer a raycast would give, without needing the scene.
 *
 * With `A = x - cx`, `B = y - cz`:
 *   vx = A·cosθ − B·sinθ
 *   vy = −sinφ·(A·sinθ + B·cosθ)
 * which is a plain 2D rotation of (A, B) once the second row is divided by
 * −sinφ, so it inverts by rotating the other way.
 */
export function groundFromView(vx: number, vy: number): Vec2 {
  const k = -vy / SP;
  return {
    x: BOARD_CX + vx * CY + k * SY,
    y: BOARD_CZ - vx * SY + k * CY,
  };
}

/**
 * Fit the board (plus its headroom) into a screen rect. Called once at startup
 * and again on resize; the result is handed to both the Three camera and the
 * picking maths below.
 */
/**
 * Zoom and pan for the isometric camera.
 *
 * This is the whole of it: the orthographic frustum shrinks by `zoom` and its
 * centre slides to wherever the board point `(panX, panY)` projects. Because
 * `worldToScreen` and `screenToBoard` both derive from the returned `IsoCam`,
 * picking stays an exact inverse of drawing for free — there is no second
 * place that has to be taught about zoom.
 *
 * At the defaults this reproduces the original framing byte for byte, which is
 * why the pan is applied as a *delta* from the board centre rather than by
 * re-centring on it: the base centre includes the HEADROOM bounding box and is
 * not the same point as `toView(BOARD_CX, 0, BOARD_CZ)`.
 */
export interface IsoCamOpts {
  zoom?: number;
  /** board px the camera looks at; defaults to the board centre */
  panX?: number;
  panY?: number;
}

export function fitCam(
  vx = 0,
  vy = 0,
  vw = GRID_W * TILE,
  vh = PLAYFIELD_H,
  opts: IsoCamOpts = {},
): IsoCam {
  const w = GRID_W * TILE;
  const d = GRID_H * TILE;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  // Eight corners of the board's bounding box — the top ones matter because a
  // tall tower at the back of the board projects well above the ground plane.
  for (const x of [0, w]) {
    for (const y of [0, d]) {
      for (const h of [0, HEADROOM]) {
        const v = toView(x, h, y);
        minX = Math.min(minX, v.x);
        maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y);
        maxY = Math.max(maxY, v.y);
      }
    }
  }
  minX -= MARGIN;
  maxX += MARGIN;
  minY -= MARGIN;
  maxY += MARGIN;

  // Grow the short axis so the frustum matches the viewport's aspect: scaling
  // one axis alone would shear the isometry.
  const want = vw / vh;
  let halfW = (maxX - minX) / 2;
  let halfH = (maxY - minY) / 2;
  if (halfW / halfH < want) halfW = halfH * want;
  else halfH = halfW / want;

  const zoom = Number.isFinite(opts.zoom) && (opts.zoom as number) > 0 ? (opts.zoom as number) : 1;
  halfW /= zoom;
  halfH /= zoom;

  // Pan as a delta from the board centre, so the default is bit-identical to
  // the original framing.
  const panX = Number.isFinite(opts.panX) ? (opts.panX as number) : BOARD_CX;
  const panY = Number.isFinite(opts.panY) ? (opts.panY as number) : BOARD_CZ;
  const p = toView(panX, 0, panY);
  const p0 = toView(BOARD_CX, 0, BOARD_CZ);

  const cx = (minX + maxX) / 2 + (p.x - p0.x);
  const cy = (minY + maxY) / 2 + (p.y - p0.y);
  return { left: cx - halfW, right: cx + halfW, top: cy + halfH, bottom: cy - halfH, vx, vy, vw, vh };
}

/** World point → screen (design px). */
export function worldToScreen(cam: IsoCam, x: number, h: number, y: number): Vec2 {
  const v = toView(x, h, y);
  return {
    x: cam.vx + ((v.x - cam.left) / (cam.right - cam.left)) * cam.vw,
    y: cam.vy + ((cam.top - v.y) / (cam.top - cam.bottom)) * cam.vh,
  };
}

/** Screen (design px) → the board px point under it. Exact inverse of `worldToScreen` at h = 0. */
export function screenToBoard(cam: IsoCam, sx: number, sy: number): Vec2 {
  const vX = cam.left + ((sx - cam.vx) / cam.vw) * (cam.right - cam.left);
  const vY = cam.top - ((sy - cam.vy) / cam.vh) * (cam.top - cam.bottom);
  return groundFromView(vX, vY);
}

/**
 * Screen (design px) → grid cell. May be off-board; callers already validate
 * against `GridSystem.inBounds`, exactly as the 2D `floor(px / TILE)` path did.
 */
export function screenToTile(cam: IsoCam, sx: number, sy: number): { tx: number; ty: number } {
  const p = screenToBoard(cam, sx, sy);
  return { tx: Math.floor(p.x / TILE), ty: Math.floor(p.y / TILE) };
}
