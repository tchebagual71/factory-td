/**
 * Pure geometry for the bottom HUD bar. Kept out of UIScene so the layout can
 * be checked at every screen size we care about (see `hudLayout.test.ts`)
 * instead of by squinting at a screenshot — overlapping buttons are invisible
 * in code review and obvious in a test.
 *
 * All coordinates are canvas units. The canvas itself is then letterboxed onto
 * the device by Phaser's FIT scaler.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HudLayout {
  /** one slot per build option, in BUILD_INFO order */
  slots: Rect[];
  paletteCols: number;
  paletteRows: number;
  /** rotate / sell / pause, touch devices only */
  touch: Rect[];
  preview: Rect;
  send: Rect;
  /** auto, speed, logistics, menu */
  toggles: Rect[];
}

export interface HudLayoutOpts {
  gameW: number;
  /** top edge of the bar (= playfield height) */
  barY: number;
  barH: number;
  roomy: boolean;
  touch: boolean;
  slotCount: number;
}

const PAD = 10;
const CLUSTER_W = 380;
const TOUCH_W = 104;
/** compact bars pack the four toggles into a 2×2 block beside the send button */
const COMPACT_TOGGLE_BLOCK = 188;

export function hudLayout(o: HudLayoutOpts): HudLayout {
  const gap = o.roomy ? 6 : 4;
  const top = o.barY + 8;
  const availH = o.barH - 16;

  const clusterX = o.gameW - PAD - CLUSTER_W;
  const touchX = clusterX - PAD - TOUCH_W;
  const paletteRight = (o.touch ? touchX : clusterX) - PAD;

  // ----- palette -----
  const paletteCols = o.roomy ? Math.ceil(o.slotCount / 2) : o.slotCount;
  const paletteRows = Math.ceil(o.slotCount / paletteCols);
  const bw = Math.floor((paletteRight - PAD + gap) / paletteCols) - gap;
  const bh = Math.floor((availH - (paletteRows - 1) * gap) / paletteRows);
  const slots: Rect[] = [];
  for (let i = 0; i < o.slotCount; i++) {
    slots.push({
      x: PAD + (i % paletteCols) * (bw + gap),
      y: top + Math.floor(i / paletteCols) * (bh + gap),
      w: bw,
      h: bh,
    });
  }

  // ----- touch controls -----
  const touch: Rect[] = [];
  if (o.touch) {
    const th = Math.floor((availH - 2 * gap) / 3);
    for (let i = 0; i < 3; i++) touch.push({ x: touchX, y: top + i * (th + gap), w: TOUCH_W, h: th });
  }

  // ----- wave cluster -----
  const previewH = o.roomy ? 26 : 18;
  const rowH = Math.floor((availH - previewH - gap) / (o.roomy ? 2 : 1));
  const sendY = top + previewH;
  const togglesY = o.roomy ? sendY + rowH + gap : sendY;

  const blockW = o.roomy ? CLUSTER_W : COMPACT_TOGGLE_BLOCK;
  const toggleW = o.roomy ? Math.floor((CLUSTER_W - 3 * gap) / 4) : Math.floor((blockW - gap) / 2);
  const toggleH = o.roomy ? rowH : Math.floor((rowH - gap) / 2);
  const sendW = o.roomy ? CLUSTER_W : CLUSTER_W - blockW - gap;
  const sendX = o.roomy ? clusterX : clusterX + blockW + gap;

  const toggles: Rect[] = [];
  for (let i = 0; i < 4; i++) {
    toggles.push(
      o.roomy
        ? { x: clusterX + i * (toggleW + gap), y: togglesY, w: toggleW, h: toggleH }
        : {
            x: clusterX + (i % 2) * (toggleW + gap),
            y: togglesY + Math.floor(i / 2) * (toggleH + gap),
            w: toggleW,
            h: toggleH,
          },
    );
  }

  return {
    slots,
    paletteCols,
    paletteRows,
    touch,
    preview: { x: clusterX, y: top, w: CLUSTER_W, h: previewH },
    send: { x: sendX, y: sendY, w: sendW, h: rowH },
    toggles,
  };
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
