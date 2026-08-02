/**
 * Pure geometry for the HUD — the bottom build bar and the top status strip.
 * Kept out of UIScene so the layout can be checked at every screen size we care
 * about (see `hudLayout.test.ts`) instead of by squinting at a screenshot —
 * overlapping buttons are invisible in code review and obvious in a test.
 *
 * All coordinates are canvas units. The canvas itself is then letterboxed onto
 * the device by Phaser's FIT scaler.
 */

import { GAME_W, IS_TOUCH } from '../config';

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
  /**
   * One tab per category, when `tabbed`. Empty otherwise.
   *
   * In tabbed mode only the selected category's slots are on screen, so slots
   * from *different* categories deliberately share the same coordinates — they
   * are never visible at the same time.
   */
  tabs: Rect[];
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
  /**
   * Show one category at a time behind tabs instead of all three side by side.
   *
   * Thirteen slots in two rows is what forced the phone's build bar to 40% of
   * the screen, leaving the board — the thing you actually play — with under a
   * third. Tabs cut the widest row from thirteen slots to five, which fits one
   * row of large slots in a much shorter bar. The shelves already existed as a
   * concept, so this promotes them rather than inventing anything to learn.
   */
  tabbed?: boolean;
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
  const tabs: Rect[] = [];

  if (o.tabbed) {
    // One row, sized for the widest category, with a tab strip above it. Slots
    // of different categories share coordinates on purpose — only one category
    // is ever drawn, so they cannot collide on screen.
    const tabH = Math.max(22, Math.min(36, Math.floor(availH * 0.24)));
    const cols = Math.max(1, ...o.groups);
    const tabW = Math.floor((paletteRight - PAD - (o.groups.length - 1) * gap) / o.groups.length);
    const tabbedBw = Math.floor((paletteRight - PAD - (cols - 1) * gap) / cols);
    const tabbedBh = availH - tabH - gap;
    o.groups.forEach((count, gi) => {
      tabs.push({ x: PAD + gi * (tabW + gap), y: top, w: tabW, h: tabH });
      for (let i = 0; i < count; i++) {
        slots.push({
          x: PAD + i * (tabbedBw + gap),
          y: top + tabH + gap,
          w: tabbedBw,
          h: tabbedBh,
        });
      }
    });
  } else {
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
  }

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
    tabs,
    paletteCols: o.tabbed ? o.groups.map(() => Math.max(1, ...o.groups)) : paletteCols,
    paletteRows: o.tabbed ? 1 : paletteRows,
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
  /**
   * Scale the inspector container must be drawn at to fit `inspector`.
   *
   * The panel is authored at a fixed size and scaled as a whole (Phaser
   * transforms child hit areas with the art, so targets grow with it). This zone
   * already knew how much room was left under the toast and clamped `inspector.h`
   * to it — but GameScene drew the panel at its authored 320px anyway, so on a
   * phone the two upgrade buttons, which are the entire point of the panel, were
   * cut off by the build bar. Returning the scale here is what stops the zone and
   * the thing drawn into it from disagreeing again.
   */
  inspectorScale: number;
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
  const toastW = touch ? 300 : 260;
  // On a short board these cards are the difference between a playfield and a
  // wall of panels: at 84px each, the objective and the coach covered a third
  // of a phone's playfield between them. They shrink with the board rather than
  // sitting at a size chosen for a 640px one.
  const cramped = playfieldH < 420;
  const objectiveH = cramped ? 40 : touch ? 84 : 56;
  const toastH = cramped ? 44 : touch ? 78 : 48;
  const inspectorH = touch ? inspectorLayoutDef.panel.h * inspectorLayoutDef.scale : 150;
  const coachH = cramped ? 40 : touch ? 84 : 56;

  const objective: Rect = { x: pad, y: top, w: objectiveW, h: objectiveH };
  const toast: Rect = { x: gameW - pad - toastW, y: top, w: toastW, h: toastH };
  // The room actually left under the toast. If the authored panel is taller than
  // this it has to scale down as a whole — clamping only the zone's height, as
  // this used to, just meant the panel overhung a rectangle nobody enforced.
  const inspectorY = toast.y + toast.h + pad;
  const room = Math.max(0, playfieldH - inspectorY);
  const inspectorScale =
    inspectorLayoutDef.scale * Math.min(1, room / Math.max(1, inspectorLayoutDef.panel.h));
  const inspector: Rect = {
    x: gameW - pad - inspectorLayoutDef.panel.w * inspectorScale - (touch ? 0 : 22),
    y: inspectorY,
    w: inspectorLayoutDef.panel.w * inspectorScale + (touch ? 0 : 22),
    h: touch ? inspectorLayoutDef.panel.h * inspectorScale : Math.min(inspectorH, room),
  };
  const coach: Rect = {
    x: Math.max(pad, Math.floor((gameW - (touch ? 520 : 420)) / 2)),
    y: Math.max(top, playfieldH - pad - coachH),
    w: Math.min(touch ? 520 : 420, Math.max(0, gameW - 2 * pad)),
    h: coachH,
  };
  return { objective, inspector, toast, coach, inspectorScale };
}

/**
 * Top edge of the `[L]` logistics legend.
 *
 * The legend hung at a fixed offset below the status strip — which is the same
 * band the objective card and the achievement toast already occupy, placed by
 * `overlayZones`. It is ~860px of centred text, so it ran straight across the
 * objective card whenever the overlay was on. Item 26 records moving it off the
 * *strip* for the same reason; it was simply moved onto the next thing down.
 *
 * Deriving it from the zones is what makes "below everything already up there"
 * a rule rather than a number that goes stale the next time a card is added.
 */
export function legendBand(zones: OverlayZones, touch: boolean): { x: number; y: number; w: number } {
  const pad = touch ? 12 : 8;
  const y = Math.max(zones.objective.y + zones.objective.h, zones.toast.y + zones.toast.h) + 6;
  // Width matters as much as the drop. On a short board the upgrade panel starts
  // higher, so clearing the cards vertically is not enough — the legend has to
  // stop before the panel's left edge or it simply collides lower down. The
  // caller word-wraps to this width and centres inside it.
  const x = pad;
  const w = Math.max(0, zones.inspector.x - pad - x);
  return { x, y, w };
}

/**
 * Widest the kill-streak meter ever renders: `200× TOTAL SATURATION` at 20px
 * bold monospace. Declared rather than measured so the anchor stays pure.
 */
export const COMBO_METER_MAX_W = 260;

/**
 * Right edge and top of the kill-streak meter, which is drawn `setOrigin(1, 0)`.
 *
 * It was pinned to `GAME_W - 10` under a comment reading "Top RIGHT ... top-left
 * is the achievement toasts". That is simply wrong: `overlayZones.toast` is at
 * `gameW - pad - toastW`, the *same* corner. Measured on a phone, the meter sat
 * at x 1156–1270 against a toast zone of 968–1268 — so an achievement unlocking
 * mid-streak landed on top of the streak counter, which is precisely the moment
 * both exist to celebrate.
 *
 * It now right-aligns to the *left* of the toast zone, in the gap between the
 * objective card and the toast, which is empty in every layout.
 */
export function comboAnchor(zones: OverlayZones, stripBottom: number, touch: boolean): { x: number; y: number } {
  const pad = touch ? 12 : 8;
  return { x: zones.toast.x - pad, y: stripBottom + 8 };
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

/** The research level-up draw: header, then a row of cards. */
export interface CardDrawLayout {
  /** Centred; `y` is the top edge, so the header can shrink without drifting. */
  title: { x: number; y: number; size: number };
  sub: { x: number; y: number; size: number; show: boolean };
  cards: Rect[];
  nameSize: number;
  descSize: number;
  metaSize: number;
  badgeSize: number;
  /**
   * Centre of the description block, as an offset from the card's top edge —
   * drawn with `setOrigin(0.5, 0.5)`.
   *
   * The description used to start at `H / 2` and flow down, which reads as a
   * short line stranded in a mostly empty card: a one-line effect left the
   * bottom 40% blank. Centring it in the room left between the name and the
   * "already taken" footer is what makes the card look composed rather than
   * unfinished, and it is why this is geometry rather than a magic number at
   * the call site.
   */
  descCy: number;
}

/**
 * The level-up draw, sized to the board it has to sit on.
 *
 * This was three 280×210 cards nailed to `y: 190` — coordinates chosen when
 * every canvas was 1280×720. Since item 40 the *viewport* onto the board can be
 * as short as `MIN_PLAYFIELD_H` (320), and a card row ending at y=400 then
 * renders 80px underneath the build bar: the single most important reward moment
 * in the game, half-hidden, on the device most people would play it on.
 *
 * So it is derived, and bounded by `playfieldH` rather than the canvas — the
 * bottom bar is opaque and owns everything below it. Space is spent in priority
 * order, because the cards are the thing being read and the header is chrome:
 *
 * 1. the subtitle is dropped first (the title already says what this is),
 * 2. then the type scale steps down,
 * 3. and the cards take **all** the height that leaves.
 *
 * The card height is a hard `min` against the room actually available, never a
 * floor, so this cannot overflow the playfield however short it gets.
 */
export function cardDrawLayout(
  gameW: number,
  playfieldH: number,
  stripBottom: number,
  count: number,
  touch: boolean,
): CardDrawLayout {
  const n = Math.max(1, Math.floor(count));
  const pad = 16;
  const top = Math.max(0, stripBottom) + pad;
  const bottom = Math.max(top, playfieldH - pad);
  const avail = bottom - top;

  // A phone's playfield is ~320–420px against a desktop's 640. Below this the
  // header has to give way rather than eat the cards.
  const cramped = avail < 320;
  const showSub = avail >= 260;
  const titleSize = cramped ? 20 : 30;
  const subSize = cramped ? 11 : 13;
  const headerH = titleSize + 6 + (showSub ? subSize + 12 : 10);

  // 184, not the 210 the fixed layout used. Seen side by side on a real render,
  // 210 left a dead band across the bottom third of every card: the worst case
  // this has to hold is a two-line name, a three-line effect and the "already
  // taken" footer, which is ~150. A card sized to content reads as composed; one
  // sized to a guess reads as unfinished.
  const cardH = Math.min(touch ? 208 : 184, Math.max(0, avail - headerH));
  const cardsTop = top + headerH;

  const gap = cramped ? 14 : 28;
  const cardW = Math.max(
    0,
    Math.min(280, Math.floor((gameW - 2 * pad - (n - 1) * gap) / n)),
  );
  const rowW = n * cardW + (n - 1) * gap;
  const x0 = Math.round((gameW - rowW) / 2);

  const cards: Rect[] = [];
  for (let i = 0; i < n; i += 1) {
    cards.push({ x: x0 + i * (cardW + gap), y: cardsTop, w: cardW, h: cardH });
  }

  const nameSize = cramped ? 14 : 16;
  const descSize = cramped ? 11 : 13;
  const metaSize = cramped ? 10 : 11;
  const badgeSize = cramped ? 9 : 11;

  // Room the name occupies at the top (badge inset + badge + gap + up to two
  // wrapped lines) and the footer at the bottom; the description centres in
  // whatever is left between them.
  const nameBlockH = 12 + badgeSize + 10 + nameSize * 2.2;
  const footerH = 28;
  const descCy = nameBlockH + Math.max(0, cardH - nameBlockH - footerH) / 2;

  return {
    title: { x: gameW / 2, y: top, size: titleSize },
    sub: { x: gameW / 2, y: top + titleSize + 6, size: subSize, show: showSub },
    cards,
    nameSize,
    descSize,
    metaSize,
    badgeSize,
    descCy,
  };
}

/** The post-wave report card, plus where its entrance animation starts. */
export interface ReportCardLayout extends Rect {
  /** `y` the card animates *from*; it settles on `y`. */
  fromY: number;
}

/**
 * The wave report card — low in the board viewport, never on the build bar.
 *
 * The creation site already clamped this correctly, and then a tween threw the
 * clamp away by animating to a literal `y: 360`. On a phone the card is built at
 * 252 and slid to 360, which puts its bottom edge at 518 against a 422 playfield
 * — **96px behind the build bar, after every single wave**. Desktop hid it,
 * because there 360 happens to sit 12px above the computed 372.
 *
 * So the destination is derived here and the entrance is expressed as an offset
 * from it, which is the only arrangement where the animation cannot contradict
 * the layout. Same lesson as items 44 and 45: a fixed `y` in an overlay is a bug
 * signature — including one hiding inside a tween.
 */
export function reportCard(gameW: number, playfieldH: number, w = 288, h = 158): ReportCardLayout {
  const pad = 12;
  const y = Math.max(pad, Math.min(372, playfieldH - h - pad));
  return { x: Math.round(gameW / 2 - w / 2), y, w, h, fromY: y + 24 };
}

/** The end-of-run card. `y` values are row *centres*, matching `setOrigin(0.5)`. */
export interface GameOverLayout {
  title: { y: number; size: number };
  sub: { y: number; size: number };
  best: { y: number; size: number };
  scrap: { y: number; size: number };
  grade: { y: number; size: number; show: boolean };
  /** Two buttons, centred at `gameW / 2 ± dx`. */
  buttons: { y: number; w: number; h: number; dx: number; size: number };
}

/**
 * The end-of-run card — the "one more run" hook, and the screen that must never
 * be unreachable.
 *
 * Every row used to be a fixed `y`, with REBUILD and MENU at 480. `GAME_H` is
 * `uiH + playfieldH` and bottoms out around **400** (a 1400×420 browser window
 * takes the short-board path at `COMFORTABLE_TILE_CSS`), which put both buttons
 * 106px off the bottom of the canvas: a defeat screen with no way out of it, on
 * the one screen a player most wants to leave.
 *
 * So the stack is *centred and measured* rather than positioned. Space is spent
 * in the same priority order the card draw uses — shrink first, drop the grade
 * block only if shrinking will not do it — with two hard rules:
 *
 * - **the buttons are never dropped and never scaled below a finger**, because
 *   losing them is a softlock rather than a cosmetic regression, and
 * - if the stack still cannot fit, it is shifted up so the buttons stay on
 *   canvas and the *title* clips instead. A clipped headline is readable; an
 *   unreachable button is not.
 *
 * At every canvas the game actually produces the scale is 1, so this is the
 * shipped desktop card exactly — only its anchor changed.
 */
export function gameOverLayout(gameW: number, gameH: number, touch: boolean): GameOverLayout {
  const pad = 16;
  const avail = Math.max(0, gameH - 2 * pad);

  // The shipped 1280×720 proportions, kept as the natural size.
  const TITLE = 48, SUB = 18, BEST = 16, SCRAP = 17, GRADE = 12;
  const GRADE_LINES = 3, LINE = 1.35;
  // Touch has room to spare here (the stack needs ~290 of ~557) and no keyboard
  // fallback, so its buttons are bigger rather than merely scaled.
  const BTN_H = touch ? 64 : 52;
  const BTN_W = touch ? 260 : 220;
  const GAP = [22, 10, 12, 20, 26]; // after title / sub / best / scrap / grade

  const stackH = (k: number, grade: boolean): number => {
    const g = GAP.map((v) => v * k);
    let h = TITLE * k + g[0] + SUB * k + g[1] + BEST * k + g[2] + SCRAP * k;
    h += grade ? g[3] + GRADE * k * GRADE_LINES * LINE : 0;
    return h + g[4] + BTN_H * k;
  };

  const MIN_K = 0.6;
  let grade = true;
  let k = Math.min(1, avail / Math.max(1, stackH(1, true)));
  if (k < MIN_K) {
    grade = false;
    k = Math.min(1, avail / Math.max(1, stackH(1, false)));
  }
  k = Math.max(MIN_K, k);

  const g = GAP.map((v) => v * k);
  const total = stackH(k, grade);
  let cursor = Math.max(pad, (gameH - total) / 2);

  const row = (h: number, gap: number): number => {
    const centre = cursor + h / 2;
    cursor += h + gap;
    return centre;
  };

  const title = { y: row(TITLE * k, g[0]), size: Math.round(TITLE * k) };
  const sub = { y: row(SUB * k, g[1]), size: Math.round(SUB * k) };
  const best = { y: row(BEST * k, g[2]), size: Math.round(BEST * k) };
  const scrap = { y: row(SCRAP * k, grade ? g[3] : 0), size: Math.round(SCRAP * k) };
  const gradeH = GRADE * k * GRADE_LINES * LINE;
  const gradeRow = { y: grade ? row(gradeH, g[4]) : cursor, size: Math.round(GRADE * k), show: grade };
  if (!grade) cursor += g[4];
  const btnH = BTN_H * k;
  const buttons = {
    y: cursor + btnH / 2,
    w: BTN_W * k,
    h: btnH,
    dx: (BTN_W * k) / 2 + 15 * k,
    size: Math.round(20 * k),
  };

  // Last resort: keep the buttons on canvas, clipping the headline instead.
  const overflow = buttons.y + btnH / 2 - (gameH - pad);
  if (overflow > 0) {
    for (const r of [title, sub, best, scrap, gradeRow, buttons]) r.y -= overflow;
  }

  return { title, sub, best, scrap, grade: gradeRow, buttons };
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

/**
 * The one top strip the whole game uses.
 *
 * GameScene and UIScene each used to build their own from the same arguments,
 * which was fine only while there were no arguments that could differ. Now that
 * the geometry depends on the device's canvas scale, two independent calls are
 * a standing invitation for `stripHit` to shield pixels the HUD is not drawing
 * on — so the derived value is computed once, here, and imported by both.
 *
 * Everything above stays pure and takes its inputs explicitly; this is the only
 * device-bound line in the module.
 */
export const STRIP: TopStripLayout = topStrip(GAME_W, IS_TOUCH);

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
