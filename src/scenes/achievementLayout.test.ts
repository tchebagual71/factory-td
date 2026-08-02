import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS } from '../data/achievements';
import { achievementCells, achievementLayout, AchLayoutOpts, CLOSE_BTN } from './achievementLayout';

/**
 * The bug this file exists to prevent: the modal was a fixed 560px tall and the
 * list was drawn as `count / 2` rows of 52px from a fixed offset. At 28
 * achievements that is 728px of content, so the last third rendered below the
 * panel and some of it below the canvas entirely — unreachable, with no error
 * and nothing to notice.
 *
 * Every assertion below runs against the *real* `ACHIEVEMENTS.length`, so the
 * next batch of achievements either fits or fails here.
 */

const COUNT = ACHIEVEMENTS.length;

/**
 * The canvas shapes the game ships on. Width is fixed at 1280 by design;
 * height varies with the elastic HUD bar (see `config.ts`), from the 16:9
 * desktop 720 up to the tall touch layouts.
 */
const DEVICES: { name: string; opts: AchLayoutOpts }[] = [
  { name: '16:9 desktop', opts: { gameW: 1280, gameH: 720, count: COUNT, touch: false } },
  { name: 'iPad landscape (4:3, touch)', opts: { gameW: 1280, gameH: 940, count: COUNT, touch: true } },
  { name: 'phone landscape (touch)', opts: { gameW: 1280, gameH: 810, count: COUNT, touch: true } },
  { name: 'boxy tablet, no touch', opts: { gameW: 1280, gameH: 940, count: COUNT, touch: false } },
];

describe.each(DEVICES.map((d): [string, AchLayoutOpts] => [d.name, d.opts]))(
  'achievement grid on %s',
  (_name, opts) => {
    const grid = achievementLayout(opts);
    const pages = Array.from({ length: grid.pages }, (_, p) =>
      achievementCells(grid, opts.count, p, opts.gameW),
    );

    it('shows at least one full row per page', () => {
      expect(grid.rowsPerPage).toBeGreaterThanOrEqual(1);
      expect(grid.perPage).toBeGreaterThanOrEqual(grid.cols);
    });

    it('reaches every achievement across its pages', () => {
      const seen = pages.flat().map((c) => c.index);
      expect(seen).toHaveLength(COUNT);
      expect(new Set(seen).size, 'no achievement drawn twice').toBe(COUNT);
      expect(Math.min(...seen)).toBe(0);
      expect(Math.max(...seen)).toBe(COUNT - 1);
    });

    it('keeps every row inside the modal, above the pager and CLOSE', () => {
      for (const cell of pages.flat()) {
        expect(cell.y, `row ${cell.index} starts above the content area`).toBeGreaterThanOrEqual(grid.contentTop);
        // A row is the star, two lines of text and a bar — the whole pitch must
        // clear the footer, not just the row's first pixel.
        expect(cell.y + grid.rowH, `row ${cell.index} overruns the footer`).toBeLessThanOrEqual(
          grid.contentBottom + grid.rowH,
        );
        expect(cell.y + grid.rowH, `row ${cell.index} falls off the modal`).toBeLessThanOrEqual(grid.bottom);
      }
    });

    it('keeps every row inside the canvas', () => {
      for (const cell of pages.flat()) {
        expect(cell.y).toBeGreaterThanOrEqual(0);
        expect(cell.y + grid.rowH).toBeLessThanOrEqual(opts.gameH);
        expect(cell.x).toBeGreaterThanOrEqual(0);
        expect(cell.x + grid.colW).toBeLessThanOrEqual(opts.gameW);
      }
    });

    it('never overlaps two rows', () => {
      for (const page of pages) {
        const slots = page.map((c) => `${Math.round(c.x)},${Math.round(c.y)}`);
        expect(new Set(slots).size, 'two achievements share a slot').toBe(page.length);
      }
    });

    it('fills every page but the last', () => {
      for (const page of pages.slice(0, -1)) expect(page.length).toBe(grid.perPage);
      expect(pages[pages.length - 1].length).toBeGreaterThan(0);
    });

    it('leaves the progress bar a sane width inside its column', () => {
      expect(grid.barW).toBeGreaterThan(100);
      expect(grid.barW).toBeLessThan(grid.colW);
    });

    it('keeps the modal on the canvas', () => {
      expect(grid.top).toBeGreaterThanOrEqual(0);
      expect(grid.bottom).toBeLessThanOrEqual(opts.gameH);
      expect(grid.modalW).toBeLessThanOrEqual(opts.gameW);
    });
  },
);

describe('pager', () => {
  it('gives touch players a finger-sized target', () => {
    const touch = achievementLayout({ gameW: 1280, gameH: 940, count: COUNT, touch: true });
    expect(touch.pagerBtn.h).toBeGreaterThanOrEqual(44);
    expect(touch.pagerBtn.w).toBeGreaterThanOrEqual(44);
  });

  it('puts prev and next either side of centre without overlapping', () => {
    const g = achievementLayout({ gameW: 1280, gameH: 720, count: COUNT, touch: false });
    expect(g.prevX).toBeLessThan(g.nextX);
    expect(g.nextX - g.prevX).toBeGreaterThan(g.pagerBtn.w);
  });

  it('sits below the last row and above the modal edge', () => {
    const g = achievementLayout({ gameW: 1280, gameH: 720, count: COUNT, touch: false });
    expect(g.pagerY).toBeGreaterThan(g.contentBottom);
    expect(g.pagerY).toBeLessThan(g.bottom);
  });
});

describe('growth headroom', () => {
  it('still paginates correctly well past the current roster', () => {
    // The roadmap explicitly contemplates ~50 achievements. Pagination must not
    // need revisiting when that lands.
    for (const count of [1, 2, 29, 50, 137]) {
      const g = achievementLayout({ gameW: 1280, gameH: 720, count, touch: false });
      const seen = Array.from({ length: g.pages }, (_, p) => achievementCells(g, count, p, 1280)).flat();
      expect(seen, `count ${count}`).toHaveLength(count);
      expect(new Set(seen.map((c) => c.index)).size).toBe(count);
    }
  });

  it('needs more than one page at the current count, or the test above is vacuous', () => {
    const desktop = achievementLayout({ gameW: 1280, gameH: 720, count: COUNT, touch: false });
    expect(COUNT).toBeGreaterThan(desktop.rowsPerPage * desktop.cols - desktop.perPage + 1);
    expect(desktop.pages).toBeGreaterThanOrEqual(1);
  });
});

/**
 * The pager and the CLOSE button share the modal's bottom strip.
 *
 * They used to be placed by two different rules — `pagerY = bottom - 68` here,
 * and MenuScene's `modalClose` independently at `bottom - 44` — both 44px tall
 * and 24px apart, so they overlapped on every device. With 28 achievements the
 * list is two pages, making the pager the only route to the second half, and a
 * tap near its inner edge closed the modal instead of paging.
 */
describe('pager clears the CLOSE button', () => {
  const rect = (cx: number, cy: number, w: number, h: number) =>
    ({ l: cx - w / 2, r: cx + w / 2, t: cy - h / 2, b: cy + h / 2 });
  const hits = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) =>
    a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

  const SHAPES: { name: string; gameW: number; gameH: number; touch: boolean }[] = [
    { name: '16:9 desktop', gameW: 1280, gameH: 720, touch: false },
    { name: 'iPad landscape', gameW: 1280, gameH: 889, touch: true },
    { name: 'phone landscape (scaled menu camera)', gameW: 1562, gameH: 720, touch: true },
    { name: 'boxy tablet', gameW: 1280, gameH: 940, touch: false },
  ];

  it.each(SHAPES.map((s) => [s.name, s] as const))('on %s', (_name, s) => {
    const g = achievementLayout({ gameW: s.gameW, gameH: s.gameH, count: ACHIEVEMENTS.length, touch: s.touch });
    const close = rect(s.gameW / 2, g.closeY, CLOSE_BTN.w, CLOSE_BTN.h);
    const prev = rect(g.prevX, g.pagerY, g.pagerBtn.w, g.pagerBtn.h);
    const next = rect(g.nextX, g.pagerY, g.pagerBtn.w, g.pagerBtn.h);
    expect(hits(prev, close), 'PREV overlaps CLOSE').toBe(false);
    expect(hits(next, close), 'NEXT overlaps CLOSE').toBe(false);
    // and neither lands on the last row of achievements
    expect(prev.t).toBeGreaterThanOrEqual(g.contentBottom - 0.5);
    // everything stays inside the modal
    expect(close.b).toBeLessThanOrEqual(g.bottom + 0.5);
    expect(prev.t).toBeGreaterThanOrEqual(g.top);
  });

  it('still needs a pager at all — the list really is multi-page', () => {
    const g = achievementLayout({ gameW: 1280, gameH: 720, count: ACHIEVEMENTS.length, touch: false });
    expect(g.pages).toBeGreaterThan(1);
  });

  it('did not cost a row to fix', () => {
    for (const s of SHAPES) {
      const g = achievementLayout({ gameW: s.gameW, gameH: s.gameH, count: ACHIEVEMENTS.length, touch: s.touch });
      expect(g.rowsPerPage, s.name).toBeGreaterThanOrEqual(7);
    }
  });
});
