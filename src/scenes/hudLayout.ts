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
  /** the full bottom command-deck area */
  deck: Rect;
  /** one slot per build option, in BUILD_INFO order (= category order) */
  slots: Rect[];
  /** one header strip per category, above that category's block of slots */
  groupHeaders: Rect[];
  /** columns/rows used *within* each category block */
  paletteCols: number[];
  paletteRows: number;
  /** rotate / confirm / sell / pause, in that order — touch devices only */
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
/**
 * The touch pad is four equal cells in a 2×2 block, not three in a T.
 *
 * ROTATE used to be one half of a 180px row, which put it at a ~39px target
 * before the canvas fit was corrected and still read as the smallest control on
 * a screen where it is one of the most used — a playtester called it out by
 * name. Squaring the block buys every cell the same generous size and makes
 * room for CONFIRM, which tap-to-place needs.
 */
const TOUCH_W = 232;
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
  // 2×2: the two controls a placement needs (ROTATE, CONFIRM) share the top
  // row, with SELL and PAUSE under them.
  const touch: Rect[] = [];
  if (o.touch) {
    const th = Math.floor((availH - gap) / 2);
    const halfW = Math.floor((TOUCH_W - gap) / 2);
    for (let i = 0; i < 4; i++) {
      touch.push({
        x: touchX + (i % 2) * (halfW + gap),
        y: top + Math.floor(i / 2) * (th + gap),
        w: halfW,
        h: th,
      });
    }
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
    deck: { x: 0, y: o.barY, w: o.gameW, h: o.barH },
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

export interface OverlayZones {
  objective: Rect;
  inspector: Rect;
  toast: Rect;
  coach: Rect;
}

/** Production inspector geometry, shared by GameScene and responsive tests. */
export interface InspectorLayout {
  panel: Rect;
  scale: number;
  buttonA: Rect;
  buttonB: Rect;
}

export function inspectorLayout(touch: boolean): InspectorLayout {
  if (touch) {
    return {
      panel: { x: 0, y: 0, w: 360, h: 320 },
      scale: 1,
      buttonA: { x: 12, y: 228, w: 164, h: 80 },
      buttonB: { x: 184, y: 228, w: 164, h: 80 },
    };
  }
  return {
    panel: { x: 0, y: 0, w: 258, h: 136 },
    scale: 1,
    buttonA: { x: 10, y: 108, w: 114, h: 22 },
    buttonB: { x: 134, y: 108, w: 114, h: 22 },
  };
}

/**
 * Reserved board regions for transient overlays. They share the same anchors as
 * the status strip and playfield so UI messages never cover an inspector.
 */
export function overlayZones(gameW: number, playfieldH: number, stripBottom: number, touch: boolean): OverlayZones {
  const pad = touch ? 12 : 8;
  const top = Math.min(playfieldH, Math.max(0, stripBottom + pad));
  const objectiveW = touch ? 320 : 280;
  const inspectorLayoutDef = inspectorLayout(touch);
  const inspectorW = inspectorLayoutDef.panel.w * inspectorLayoutDef.scale + (touch ? 0 : 22);
  const toastW = touch ? 300 : 260;
  const objectiveH = touch ? 84 : 56;
  const toastH = touch ? 78 : 48;
  const inspectorH = touch ? inspectorLayoutDef.panel.h * inspectorLayoutDef.scale : 150;
  const coachH = touch ? 84 : 56;

  const objective: Rect = { x: pad, y: top, w: objectiveW, h: objectiveH };
  const toast: Rect = { x: gameW - pad - toastW, y: top, w: toastW, h: toastH };
  const inspector: Rect = {
    x: gameW - pad - inspectorW,
    y: toast.y + toast.h + pad,
    w: inspectorW,
    h: Math.max(0, Math.min(inspectorH, playfieldH - (toast.y + toast.h + pad))),
  };
  const coach: Rect = {
    x: Math.max(pad, Math.floor((gameW - (touch ? 520 : 420)) / 2)),
    y: Math.max(top, playfieldH - pad - coachH),
    w: Math.min(touch ? 520 : 420, Math.max(0, gameW - 2 * pad)),
    h: coachH,
  };
  return { objective, inspector, toast, coach };
}

/** The board's pointer guard uses the exact same overlay reservations as the HUD. */
export function overlayHit(
  zones: OverlayZones,
  x: number,
  y: number,
  visible: Pick<Record<keyof OverlayZones, boolean>, 'objective' | 'coach' | 'inspector'>,
): boolean {
  return (visible.objective && contains(zones.objective, x, y)) ||
    (visible.coach && contains(zones.coach, x, y)) ||
    (visible.inspector && contains(zones.inspector, x, y));
}

/**
 * A deterministic, font-agnostic guard for the small HUD cards. Phaser still
 * does the final pixel wrapping, but this bounds a pathological long mission
 * name or coach sentence before it can spill out of its reserved card.
 */
export function fitCardCopy(text: string, charsPerLine: number, maxLines: number): string {
  const width = Math.max(1, Math.floor(charsPerLine));
  const lines = Math.max(1, Math.floor(maxLines));
  const words = text.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= width) {
      line = candidate;
      continue;
    }
    if (line) out.push(line);
    if (out.length === lines) return `${out.slice(0, -1).join('\n')}${out.length > 1 ? '\n' : ''}${out.at(-1)!.slice(0, Math.max(1, width - 1))}…`;
    line = word.length > width ? word.slice(0, Math.max(1, width - 1)) + '…' : word;
  }
  if (line && out.length < lines) out.push(line);
  if (out.length <= lines) return out.join('\n');
  return `${out.slice(0, lines - 1).join('\n')}${lines > 1 ? '\n' : ''}${out[lines - 1].slice(0, Math.max(1, width - 1))}…`;
}

/** Text budgets matched to the live card widths and type scale. */
export function hudCardCopyLimits(touch: boolean): Record<'missionTitle' | 'missionDetail' | 'coachAction' | 'coachContext' | 'toastName' | 'toastDetail', number> {
  return touch
    ? { missionTitle: 17, missionDetail: 34, coachAction: 36, coachContext: 46, toastName: 25, toastDetail: 34 }
    : { missionTitle: 24, missionDetail: 38, coachAction: 48, coachContext: 58, toastName: 31, toastDetail: 42 };
}

/** Scale produced by Phaser's FIT-style canvas fitting. */
export function fittedScale(canvasW: number, canvasH: number, viewportW: number, viewportH: number): number {
  if (![canvasW, canvasH, viewportW, viewportH].every(Number.isFinite) || canvasW <= 0 || canvasH <= 0 || viewportW < 0 || viewportH < 0) {
    return 0;
  }
  return Math.max(0, Math.min(viewportW / canvasW, viewportH / canvasH));
}

export function renderedSize(rect: Rect, scale: number): Pick<Rect, 'w' | 'h'> {
  const safeScale = Number.isFinite(scale) && scale >= 0 ? scale : 0;
  return { w: rect.w * safeScale, h: rect.h * safeScale };
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
  /** flat ↔ 3D isometric. A chip rather than keyboard-only: touch has no `G`. */
  view: Rect;
}

export function topStrip(gameW: number, touch: boolean): TopStripLayout {
  const pad = 8;
  const gap = 8;
  const h = touch ? 44 : 30;
  const y = pad;

  const mute: Rect = { x: gameW - pad - h, y, w: h, h };
  const help: Rect = { x: mute.x - gap - h, y, w: h, h };
  // Wider than the square icon buttons because it carries a word ("2D"/"3D"),
  // and it is the one chip a touch player has no keyboard fallback for.
  const viewW = touch ? 56 : 44;
  const view: Rect = { x: help.x - gap - viewW, y, w: viewW, h };
  const mapW = touch ? 130 : 150;
  const map: Rect = { x: view.x - gap - mapW, y, w: mapW, h };

  const stats: Rect = { x: pad, y, w: touch ? 396 : 356, h };
  const survey: Rect = { x: stats.x + stats.w + gap, y, w: touch ? 250 : 196, h };
  const researchX = survey.x + survey.w + gap;
  const research: Rect = { x: researchX, y, w: Math.min(236, map.x - gap - researchX), h };

  return { h, stats, survey, research, map, help, mute, view };
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function contains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

/**
 * Is this point over a *clickable* chip in the top strip?
 *
 * The strip floats over the playfield, and the board's own pointer handler only
 * excluded the bottom bar (`y >= PLAYFIELD_H`). So with a building armed, going
 * for SURVEY or `?` or the mute toggle also planted that building on the tile
 * underneath — a $160 cryo tower for a mis-aimed tap at the help button, in the
 * top-right corner where nobody was looking.
 *
 * Only the interactive chips count. The money/lives/wave readouts and the map
 * name are labels, and blocking those would carve two unbuildable rows out of
 * the top of the board for no reason.
 */
export function stripHit(s: TopStripLayout, x: number, y: number): boolean {
  return [s.survey, s.help, s.mute, s.view].some((r) => contains(r, x, y));
}
