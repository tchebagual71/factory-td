/**
 * Pure geometry for the HUD — the bottom build bar and the top status strip.
 * Kept out of UIScene so the layout can be checked at every screen size we care
 * about (see `hudLayout.test.ts`) instead of by squinting at a screenshot —
 * overlapping buttons are invisible in code review and obvious in a test.
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
  /** one slot per build option, in BUILD_INFO order (= category order) */
  slots: Rect[];
  /** one header strip per category, above that category's block of slots */
  groupHeaders: Rect[];
  /** columns/rows used *within* each category block */
  paletteCols: number[];
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
  /** slots per category block, in display order; blocks are laid out left to right */
  groups: number[];
}

const PAD = 10;
const CLUSTER_W = 380;
const TOUCH_W = 104;
/** compact bars pack the four toggles into a 2×2 block beside the send button */
const COMPACT_TOGGLE_BLOCK = 188;
/** breathing room between two category blocks — the visual "these are different things" cue */
const GROUP_GAP = 16;

export function hudLayout(o: HudLayoutOpts): HudLayout {
  const gap = o.roomy ? 6 : 4;
  const top = o.barY + 8;
  const availH = o.barH - 16;

  const clusterX = o.gameW - PAD - CLUSTER_W;
  const touchX = clusterX - PAD - TOUCH_W;
  const paletteRight = (o.touch ? touchX : clusterX) - PAD;

  // ----- palette: one grid per category, all sharing a slot size -----
  const paletteRows = o.roomy ? 2 : 1;
  const paletteCols = o.groups.map((n) => Math.ceil(n / paletteRows));
  const totalCols = paletteCols.reduce((a, b) => a + b, 0);
  const intraGaps = totalCols - paletteCols.length; // gaps *inside* blocks
  const blockGaps = Math.max(0, paletteCols.length - 1) * GROUP_GAP;
  // The compact 80px desktop bar has to fit a header, the art, a name and a
  // price into 64px — every pixel spent here comes straight off the icon.
  const headerH = o.roomy ? 15 : 11;

  const bw = Math.floor((paletteRight - PAD - blockGaps - intraGaps * gap) / Math.max(1, totalCols));
  const bh = Math.floor((availH - headerH - (paletteRows - 1) * gap) / paletteRows);

  const slots: Rect[] = [];
  const groupHeaders: Rect[] = [];
  let gx = PAD;
  o.groups.forEach((count, gi) => {
    const cols = paletteCols[gi];
    const blockW = cols * bw + (cols - 1) * gap;
    groupHeaders.push({ x: gx, y: top, w: blockW, h: headerH });
    for (let i = 0; i < count; i++) {
      slots.push({
        x: gx + (i % cols) * (bw + gap),
        y: top + headerH + Math.floor(i / cols) * (bh + gap),
        w: bw,
        h: bh,
      });
    }
    gx += blockW + GROUP_GAP;
  });

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
    groupHeaders,
    paletteCols,
    paletteRows,
    touch,
    preview: { x: clusterX, y: top, w: CLUSTER_W, h: previewH },
    send: { x: sendX, y: sendY, w: sendW, h: rowH },
    toggles,
  };
}

/**
 * Where the icon, name and price sit *inside* one palette slot.
 *
 * Stacked from the bottom up rather than at fractions of the slot height: the
 * category headers cost the compact desktop bar 12px, and fractional placement
 * silently overlapped the price with the name once the slot dropped to 52px.
 * The icon then takes whatever vertical room is left over.
 */
export interface SlotContent {
  /** scale for the 32px building texture */
  iconScale: number;
  /** icon centre, from the slot's top edge */
  iconY: number;
  /** false on a bar too short for three rows — the icon and price win, the name is dropped */
  showName: boolean;
  nameY: number;
  nameSize: number;
  costY: number;
  costSize: number;
}

/** Smallest the 32px building art may be drawn before it stops reading as anything. */
const MIN_ICON_SCALE = 0.7;

/** Rough rendered height of a monospace line at this font size. */
const lineH = (size: number) => size + 3;

export function slotContent(slotH: number): SlotContent {
  const big = slotH >= 78;
  const nameSize = big ? 12 : slotH >= 62 ? 10 : 9;
  const costSize = big ? 13 : slotH >= 62 ? 11 : 10;
  const pad = big ? 5 : 1;

  const costY = slotH - pad - lineH(costSize);
  const nameY = costY - lineH(nameSize);
  // A bar short enough that the name would squeeze the art below legibility
  // drops the name instead — the icon and the price are what you buy from.
  const showName = nameY - 2 >= MIN_ICON_SCALE * 32 + 2;
  const iconRoom = (showName ? nameY : costY) - 2;
  const iconScale = Math.min(2, Math.max(MIN_ICON_SCALE, iconRoom / 32));
  return { iconScale, iconY: iconRoom / 2 + 1, showName, nameY, nameSize, costY, costSize };
}

/**
 * Top status strip. Everything here used to be hand-placed at literal pixel
 * offsets, which is how the mute control ended up a 16px glyph — unhittable on
 * a phone, where the whole canvas is scaled down to fit.
 *
 * Anchored from both ends: the readouts grow from the left, the two icon
 * buttons are pinned to the right, and the research box takes what is left.
 */
export interface TopStripLayout {
  h: number;
  /** money / lives / wave chips */
  stats: Rect;
  survey: Rect;
  research: Rect;
  /** active map name — a label, not a control */
  map: Rect;
  help: Rect;
  mute: Rect;
}

export function topStrip(gameW: number, touch: boolean): TopStripLayout {
  const pad = 8;
  const gap = 8;
  const h = touch ? 44 : 30;
  const y = pad;

  const mute: Rect = { x: gameW - pad - h, y, w: h, h };
  const help: Rect = { x: mute.x - gap - h, y, w: h, h };
  const mapW = touch ? 130 : 150;
  const map: Rect = { x: help.x - gap - mapW, y, w: mapW, h };

  const stats: Rect = { x: pad, y, w: touch ? 396 : 356, h };
  const survey: Rect = { x: stats.x + stats.w + gap, y, w: touch ? 250 : 196, h };
  const researchX = survey.x + survey.w + gap;
  const research: Rect = { x: researchX, y, w: Math.min(236, map.x - gap - researchX), h };

  return { h, stats, survey, research, map, help, mute };
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
