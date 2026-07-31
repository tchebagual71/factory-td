export const TILE = 32;
export const GRID_W = 40;
export const GRID_H = 20;
export const PLAYFIELD_H = GRID_H * TILE; // 640px — the tile grid, fixed for every device
export const GAME_W = GRID_W * TILE; // 1280

/** Bar heights: the 16:9 desktop default, and the tallest bar a very boxy screen gets. */
const UI_H_MIN = 80;
const UI_H_MAX = 300;
/** Above this the HUD switches to a roomier two-row layout with touch-sized buttons. */
export const UI_H_ROOMY = 150;

/**
 * The playfield is a fixed 1280×640 tile grid, but the HUD bar underneath is
 * elastic: we grow it so the whole canvas roughly matches the window's aspect
 * ratio before `Scale.FIT` letterboxes anything.
 *
 * On a 16:9 monitor that yields the original 1280×720. On a 4:3 iPad it yields
 * a much taller bar, which fills what would otherwise be black bars with a
 * bigger, touch-friendly HUD instead of wasted space.
 */
export function uiHeightForViewport({
  width,
  height,
  touch,
}: {
  width: number;
  height: number;
  touch: boolean;
}): number {
  // Touch always gets the roomy HUD: finger-sized buttons matter more than a
  // few extra rows of board, and there is no keyboard to fall back on.
  const min = touch ? 220 : UI_H_MIN;
  if (!width || !height) return min;
  // Portrait is handled by the rotate prompt; size for the landscape equivalent.
  const aspect = Math.min(height, width) / Math.max(height, width);
  const wanted = Math.round(GAME_W * aspect) - PLAYFIELD_H;
  return Math.min(UI_H_MAX, Math.max(min, wanted));
}

const touchCapable =
  typeof window !== 'undefined' &&
  ('ontouchstart' in window || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0));

const viewport =
  typeof window === 'undefined'
    ? { width: 0, height: 0, touch: touchCapable }
    : { width: window.innerWidth, height: window.innerHeight, touch: touchCapable };

export const UI_H = uiHeightForViewport(viewport);
export const GAME_H = PLAYFIELD_H + UI_H;

/** True when the HUD has room for the two-row, big-button layout. */
export const ROOMY_UI = UI_H >= UI_H_ROOMY;

/**
 * Touch-capable device. Drives on-screen replacements for the keyboard-and-
 * right-click affordances (rotate, sell, pause) — never used to *remove*
 * anything, so a touchscreen laptop keeps both input styles.
 */
export const IS_TOUCH = touchCapable;

export const BELT_SPEED = 70; // px/sec item travel speed

/**
 * Longest real frame, in seconds, that one tick may simulate. Tab-away or a
 * stalled frame would otherwise teleport enemies through towers.
 *
 * Note this is applied *before* the ×1/×2/×3 speed multiplier, so the dt a
 * system actually receives reaches MAX_DT × 3. Anything deriving a bound from a
 * frame length must use the dt it was handed, not this constant.
 */
export const MAX_DT = 0.05;

export const START_MONEY = 450;
export const START_LIVES = 20;
