export const TILE = 32;
export const GRID_W = 40;
export const GRID_H = 20;

/**
 * The tile grid itself — 1280×640, fixed for every device, forever. This is
 * *board space*: where buildings, enemies and terrain live.
 *
 * It is deliberately distinct from `GAME_W`/`PLAYFIELD_H` below, which are the
 * *viewport* onto it. They were the same number until the canvas had to fit a
 * phone, and anything drawn in board coordinates must use these two.
 */
export const BOARD_W = GRID_W * TILE; // 1280
export const BOARD_H = GRID_H * TILE; // 640

/** Bar heights: the 16:9 desktop default, and the tallest bar a very boxy screen gets. */
const UI_H_MIN = 80;
const UI_H_MAX = 300;
/** Above this the HUD switches to a roomier two-row layout with touch-sized buttons. */
export const UI_H_ROOMY = 150;

/**
 * Shortest board viewport we will ever hand a player: 10 rows. Below this the
 * board stops reading as a map and becomes a slit you can only navigate by
 * memory, and no amount of extra tile size is worth that.
 */
const MIN_PLAYFIELD_H = 320;

/**
 * A tile this size (css px) is comfortable to aim at. Above it, showing the
 * whole board is worth more than making the tiles bigger; below it, precise
 * placement stops working and the board has to be scrolled instead.
 *
 * ~22px is where a 32px tile stops being a reliable tap target — it is the knob
 * that keeps this whole mechanism *off* on desktop, where the board has always
 * fit comfortably and hiding rows would be a pure regression.
 */
const COMFORTABLE_TILE_CSS = 22;

/**
 * The HUD bar height. Grown so the whole canvas roughly matches the window's
 * aspect ratio before `Scale.FIT` letterboxes anything.
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
  //
  // 168 rather than 220 because the touch palette is now tabbed: one row of
  // large slots instead of two rows of thirteen. That bar was 40% of a phone
  // screen and left the board under a third of it. The touch pad's cells stay
  // comfortably past 40 css px at this height, which is what sets the floor.
  const min = touch ? 168 : UI_H_MIN;
  if (!width || !height) return min;
  // Portrait is handled by the rotate prompt; size for the landscape equivalent.
  const aspect = Math.min(height, width) / Math.max(height, width);
  const wanted = Math.round(BOARD_W * aspect) - BOARD_H;
  return Math.min(UI_H_MAX, Math.max(min, wanted));
}

export interface CanvasMetrics {
  /** canvas width — always the board width, so the board fills it at zoom 1 */
  gameW: number;
  gameH: number;
  /** height of the *viewport onto the board*, which is ≤ BOARD_H */
  playfieldH: number;
  uiH: number;
}

/**
 * How big the canvas is, and how that height is split between board and HUD.
 *
 * `Scale.FIT` letterboxes whatever we hand it, so the canvas aspect has to
 * match the device's or the player loses the difference to black bars. A phone
 * in landscape is around 2.17:1 while the board plus a touch-sized HUD is
 * 1.49:1 — that mismatch was ~38% of the screen width, which is what made the
 * game look shoved into a corner.
 *
 * The width is pinned to the board, so the only give is vertical:
 *
 * 1. the HUD bar absorbs surplus height on boxy screens (as it always has), then
 * 2. on screens still too wide to fit, **the board viewport shortens** — the
 *    board is unchanged, we simply see fewer rows of it at once and pan for the
 *    rest (`boardCam`), which buys back roughly 60% more tile size.
 *
 * Step 2 only engages when the whole-board framing would put a tile under
 * `COMFORTABLE_TILE_CSS`. A 21:9 desktop letterboxes a little and keeps all 20
 * rows, because there a tile is already 48px and hiding rows would buy nothing.
 */
export function canvasMetrics({
  width,
  height,
  touch,
}: {
  width: number;
  height: number;
  touch: boolean;
}): CanvasMetrics {
  const uiH = uiHeightForViewport({ width, height, touch });
  const full: CanvasMetrics = { gameW: BOARD_W, gameH: BOARD_H + uiH, playfieldH: BOARD_H, uiH };
  if (!width || !height) return full;

  // What one tile would measure on this device with the whole board on screen.
  const fullScale = Math.min(width / BOARD_W, height / full.gameH);
  if (fullScale * TILE >= COMFORTABLE_TILE_CSS) return full;

  // Portrait is handled by the rotate prompt; size for the landscape equivalent.
  const aspect = Math.min(width, height) / Math.max(width, height);
  const wantedH = Math.round(BOARD_W * aspect);
  const playfieldH = Math.min(BOARD_H, Math.max(MIN_PLAYFIELD_H, wantedH - uiH));
  return { gameW: BOARD_W, gameH: uiH + playfieldH, playfieldH, uiH };
}

const touchCapable =
  typeof window !== 'undefined' &&
  ('ontouchstart' in window || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0));

/**
 * Width and height the notch and home indicator actually leave us.
 *
 * The page is `viewport-fit=cover`, so `innerWidth` counts pixels behind the
 * notch that the canvas is then inset out of (`#app` in index.html). Sizing the
 * canvas against the larger number and fitting it into the smaller box puts the
 * difference straight back into letterbox bars — on a notched iPhone held in
 * landscape that is ~120px of width, which is the whole margin this change was
 * trying to win. Measured through a probe because `env()` is only readable from
 * CSS; zero wherever the browser doesn't support it, which is the correct
 * answer on every screen without a cutout.
 */
function safeAreaInsets(): { x: number; y: number } {
  if (typeof document === 'undefined' || !document.body) return { x: 0, y: 0 };
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
    'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.appendChild(probe);
  const s = getComputedStyle(probe);
  const px = (v: string): number => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0);
  const insets = {
    x: px(s.paddingLeft) + px(s.paddingRight),
    y: px(s.paddingTop) + px(s.paddingBottom),
  };
  probe.remove();
  return insets;
}

const viewport = ((): { width: number; height: number; touch: boolean } => {
  if (typeof window === 'undefined') return { width: 0, height: 0, touch: touchCapable };
  const inset = safeAreaInsets();
  return {
    width: Math.max(0, window.innerWidth - inset.x),
    height: Math.max(0, window.innerHeight - inset.y),
    touch: touchCapable,
  };
})();

const metrics = canvasMetrics(viewport);

export const UI_H = metrics.uiH;
export const GAME_W = metrics.gameW;
export const GAME_H = metrics.gameH;
/**
 * The viewport onto the board, *not* the board — see `BOARD_H`. Equal to
 * `BOARD_H` everywhere the whole board comfortably fits, which is every desktop
 * and tablet; shorter on a phone, where the rest is reached by panning.
 */
export const PLAYFIELD_H = metrics.playfieldH;

/** True when the HUD has room for the two-row, big-button layout. */
export const ROOMY_UI = UI_H >= UI_H_ROOMY;

/** CSS scale Phaser FIT applies to the logical canvas on this viewport. */
export const DISPLAY_SCALE = ((): number => {
  if (!viewport.width || !viewport.height) return 1;
  return Math.min(viewport.width / GAME_W, viewport.height / GAME_H);
})();

/**
 * The menu lays out in the real game canvas. A previous 720px virtual surface
 * was scaled once here and then again by Phaser FIT, turning small phone copy
 * into roughly 6px text. `menuLayout` now owns the compact composition instead.
 */
export const MENU_SCALE = 1;
export const MENU_W = GAME_W;
export const MENU_H = GAME_H;

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
