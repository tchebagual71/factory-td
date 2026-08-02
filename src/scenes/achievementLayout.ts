/**
 * Geometry for the achievements browser, pure and free of Phaser.
 *
 * The collection outgrew its modal: 28 entries were laid out as 14 rows of 52px
 * from a fixed offset inside a fixed 560px panel, so everything past row ~8 drew
 * below the panel — and past row ~12, below the canvas. Nothing caught it,
 * because a position written inline in a scene has nothing to disagree with.
 *
 * This module owns the answer instead, the same way `hudLayout.ts` owns the HUD:
 * how many rows fit on this device, therefore how many pages the list needs, and
 * where each cell goes. `achievementLayout.test.ts` holds it to the real
 * `ACHIEVEMENTS.length` at every screen shape the game ships on, so adding the
 * 29th achievement fails a test rather than silently drawing off-screen.
 */

/** Vertical pitch of one achievement row (star, name, detail line, progress bar). */
const ROW_H = 52;
/** Distance from the modal's top edge to the first row — clears the title. */
const HEADER_H = 70;
/**
 * Space kept at the bottom for the pager *and* the CLOSE button.
 *
 * 126, not the original 104. The pager used to sit at `bottom - 68` while
 * MenuScene's shared `modalClose` independently placed a 180×44 button at
 * `bottom - 44` — two sources of truth for the same strip, 24px apart, both 44px
 * tall. They overlapped on every device, and `prevX`/`nextX` at only ±92 from
 * centre sat inside the 180-wide button horizontally too. With 28 achievements
 * the list is two pages, so the pager is the *only* route to the second half —
 * and a tap near its inner edge closed the modal instead of paging.
 *
 * The pager now sits a clear 12px above the CLOSE row, and `CLOSE_BTN`/`closeY`
 * below make this module the single owner of that strip. Row count is unchanged
 * at every shipped shape: the extra 22px comes out of slack, not out of a row.
 */
const FOOTER_H = 126;

/**
 * The modal's CLOSE button, owned here rather than by the scene that draws it.
 * MenuScene reads `closeY` for this modal so the two cannot drift apart again.
 */
export const CLOSE_BTN = { w: 180, h: 44 } as const;
/** Horizontal padding inside the modal. */
const PAD = 20;
const COLS = 2;

/** Widest the modal is ever allowed to be, before the screen constrains it. */
const MAX_W = 980;
const MAX_H = 640;

export interface AchCell {
  /** index into the achievements list */
  index: number;
  /** left edge of the row: the star sits here, text and bar are offset from it */
  x: number;
  /** top of the row */
  y: number;
}

export interface AchGrid {
  modalW: number;
  modalH: number;
  /** modal edges in canvas space */
  top: number;
  bottom: number;
  /** y of the first row */
  contentTop: number;
  /** the lowest y a row may start at and still fit entirely above the footer */
  contentBottom: number;
  rowH: number;
  cols: number;
  rowsPerPage: number;
  perPage: number;
  pages: number;
  /** width of one column, and of the progress bar drawn inside it */
  colW: number;
  barW: number;
  /** centre-line for the pager controls; only meaningful when `pages > 1` */
  pagerY: number;
  /** x centres of the ‹ and › buttons */
  prevX: number;
  nextX: number;
  /** finger-sized on touch, compact on desktop */
  pagerBtn: { w: number; h: number };
  /** centre-line of the CLOSE button; the pager is placed clear of it */
  closeY: number;
}

export interface AchLayoutOpts {
  gameW: number;
  gameH: number;
  count: number;
  touch?: boolean;
}

/**
 * Resolve the grid for `count` achievements on a `gameW × gameH` canvas.
 *
 * The modal grows to whatever the screen allows (capped at MAX_H) and the row
 * count follows from the space that leaves — so a tall iPad HUD shows more per
 * page than a 16:9 desktop rather than both being pinned to a guess.
 */
export function achievementLayout({ gameW, gameH, count, touch = false }: AchLayoutOpts): AchGrid {
  const modalW = Math.min(MAX_W, gameW - 40);
  const modalH = Math.min(MAX_H, gameH - 40);
  const top = gameH / 2 - modalH / 2;
  const bottom = gameH / 2 + modalH / 2;

  const contentTop = top + HEADER_H;
  const contentBottom = bottom - FOOTER_H;
  // At least one row even on an absurdly short screen: a page that shows nothing
  // would make the whole list unreachable, which is the bug this replaces.
  const rowsPerPage = Math.max(1, Math.floor((contentBottom - contentTop) / ROW_H));
  const perPage = rowsPerPage * COLS;
  const pages = Math.max(1, Math.ceil(count / perPage));

  const colW = (modalW - PAD * 2) / COLS;
  const pagerBtn = touch ? { w: 56, h: 44 } : { w: 44, h: 32 };
  // The CLOSE row sits on the modal's bottom edge; the pager stacks clear above
  // it rather than beside it, so this never depends on CLOSE's *width*.
  const closeY = bottom - CLOSE_BTN.h;
  const pagerY = closeY - CLOSE_BTN.h / 2 - pagerBtn.h / 2 - 12;

  return {
    modalW,
    modalH,
    top,
    bottom,
    contentTop,
    contentBottom,
    rowH: ROW_H,
    cols: COLS,
    rowsPerPage,
    perPage,
    pages,
    colW,
    // leaves room for the star column on the left and a margin on the right
    barW: colW - 70,
    pagerY,
    prevX: gameW / 2 - 92,
    nextX: gameW / 2 + 92,
    pagerBtn,
    closeY,
  };
}

/**
 * The cells drawn on `page` (0-based). Reading order is left-to-right then down,
 * so the on-screen order matches the order of the achievements list.
 */
export function achievementCells(grid: AchGrid, count: number, page: number, gameW: number): AchCell[] {
  const left = gameW / 2 - grid.modalW / 2 + PAD;
  const start = page * grid.perPage;
  const cells: AchCell[] = [];
  for (let i = start; i < Math.min(start + grid.perPage, count); i++) {
    const withinPage = i - start;
    cells.push({
      index: i,
      x: left + (withinPage % grid.cols) * grid.colW,
      y: grid.contentTop + Math.floor(withinPage / grid.cols) * grid.rowH,
    });
  }
  return cells;
}
