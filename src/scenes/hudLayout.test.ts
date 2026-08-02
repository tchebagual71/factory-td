import { describe, expect, it } from 'vitest';
import { BUILD_CATEGORIES, BUILD_INFO, buildGroupSizes } from '../data/buildings';
import {
  cardDrawLayout,
  fittedScale,
  fitCardCopy,
  gameOverLayout,
  hudCardCopyLimits,
  hudLayout,
  inspectorLayout,
  HudLayoutOpts,
  comboAnchor,
  COMBO_METER_MAX_W,
  legendBand,
  overlayZones,
  overlaps,
  overlayHit,
  Rect,
  reportCard,
  renderedSize,
  slotContent,
  stripHit,
  topStrip,
} from './hudLayout';

const GAME_W = 1280;
const BAR_Y = 640;
/** The real palette shape, so a new building or category can never silently break the bar. */
const GROUPS = buildGroupSizes();
const SLOTS = BUILD_INFO.length;

/** The screen shapes the game actually has to survive. */
const DEVICES: { name: string; opts: HudLayoutOpts }[] = [
  {
    name: '16:9 desktop',
    opts: { gameW: GAME_W, barY: BAR_Y, barH: 80, roomy: false, touch: false, groups: GROUPS },
  },
  {
    name: 'iPad landscape (4:3, touch)',
    opts: { gameW: GAME_W, barY: BAR_Y, barH: 300, roomy: true, touch: true, groups: GROUPS },
  },
  {
    name: 'phone landscape (tabbed, touch)',
    opts: { gameW: GAME_W, barY: BAR_Y, barH: 168, roomy: true, touch: true, groups: GROUPS, tabbed: true },
  },
  {
    name: 'boxy tablet, no touch',
    opts: { gameW: GAME_W, barY: BAR_Y, barH: 300, roomy: true, touch: false, groups: GROUPS },
  },
];

function allRects(o: HudLayoutOpts): { label: string; rect: Rect }[] {
  const l = hudLayout(o);
  return [
    ...l.slots.map((rect, i) => ({ label: `slot ${i}`, rect })),
    ...l.touch.map((rect, i) => ({ label: `touch ${i}`, rect })),
    ...l.toggles.map((rect, i) => ({ label: `toggle ${i}`, rect })),
    { label: 'send', rect: l.send },
    { label: 'preview', rect: l.preview },
  ];
}

describe.each(DEVICES.map((d): [string, HudLayoutOpts] => [d.name, d.opts]))('HUD on %s', (_name, opts) => {
  const l = hudLayout(opts);
  const rects = allRects(opts);

  it('keeps every control inside the bar', () => {
    for (const { label, rect } of [...rects, ...l.groupHeaders.map((rect, i) => ({ label: `header ${i}`, rect }))]) {
      expect(rect.x, `${label} off the left edge`).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.w, `${label} off the right edge`).toBeLessThanOrEqual(opts.gameW);
      expect(rect.y, `${label} above the bar`).toBeGreaterThanOrEqual(opts.barY);
      expect(rect.y + rect.h, `${label} below the bar`).toBeLessThanOrEqual(opts.barY + opts.barH);
    }
  });

  it('never overlaps two controls', () => {
    // In tabbed mode only one shelf is on screen, so slots from different
    // categories deliberately share coordinates — they can never collide.
    const shelfOf = (label: string): number => {
      const m = /^slot (\d+)$/.exec(label);
      if (!m) return -1;
      let n = Number(m[1]);
      for (let g = 0; g < GROUPS.length; g++) {
        if (n < GROUPS[g]) return g;
        n -= GROUPS[g];
      }
      return -1;
    };
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        // the preview strip is a label above the send button, not a control
        if (rects[i].label === 'preview' || rects[j].label === 'preview') continue;
        if (opts.tabbed) {
          const a = shelfOf(rects[i].label);
          const b = shelfOf(rects[j].label);
          if (a >= 0 && b >= 0 && a !== b) continue;
        }
        expect(
          overlaps(rects[i].rect, rects[j].rect),
          `${rects[i].label} overlaps ${rects[j].label}`,
        ).toBe(false);
      }
    }
  });

  it('gives every control a positive, clickable size', () => {
    for (const { label, rect } of rects) {
      expect(rect.w, `${label} width`).toBeGreaterThan(20);
      expect(rect.h, `${label} height`).toBeGreaterThan(12);
    }
  });

  it('lays out one slot per build option', () => {
    expect(l.slots).toHaveLength(SLOTS);
  });
});

describe.each(DEVICES.filter((d) => !d.opts.tabbed).map((d): [string, HudLayoutOpts] => [d.name, d.opts]))(
  'categorised palette on %s',
  (_name, opts) => {
    const l = hudLayout(opts);

    it('gives every category its own header, sized to its block', () => {
      expect(l.groupHeaders).toHaveLength(GROUPS.length);
      let first = 0;
      GROUPS.forEach((count, gi) => {
        const block = l.slots.slice(first, first + count);
        const header = l.groupHeaders[gi];
        expect(Math.min(...block.map((s) => s.x)), `header ${gi} left`).toBe(header.x);
        expect(Math.max(...block.map((s) => s.x + s.w)), `header ${gi} right`).toBe(header.x + header.w);
        // the header sits above its slots, never on top of them
        for (const s of block) expect(s.y, `header ${gi} overlaps a slot`).toBeGreaterThanOrEqual(header.y + header.h);
        first += count;
      });
    });

    it('keeps each category contiguous and in order, left to right', () => {
      let first = 0;
      const rights: number[] = [];
      const lefts: number[] = [];
      for (const count of GROUPS) {
        const block = l.slots.slice(first, first + count);
        lefts.push(Math.min(...block.map((s) => s.x)));
        rights.push(Math.max(...block.map((s) => s.x + s.w)));
        first += count;
      }
      for (let i = 1; i < lefts.length; i++) {
        // a visible gutter between blocks: that separation IS the categorisation
        expect(lefts[i], `block ${i} must start right of block ${i - 1}`).toBeGreaterThan(rights[i - 1] + 8);
      }
    });

    it('never straddles a category across two blocks', () => {
      // every slot belongs to exactly the block its index says it does
      let first = 0;
      GROUPS.forEach((count, gi) => {
        const header = l.groupHeaders[gi];
        for (let i = first; i < first + count; i++) {
          expect(l.slots[i].x, `slot ${i} outside block ${gi}`).toBeGreaterThanOrEqual(header.x);
          expect(l.slots[i].x + l.slots[i].w, `slot ${i} outside block ${gi}`).toBeLessThanOrEqual(header.x + header.w);
        }
        first += count;
      });
    });

    it('uses one uniform slot size across every category', () => {
      const [{ w, h }] = l.slots;
      for (const s of l.slots) {
        expect(s.w).toBe(w);
        expect(s.h).toBe(h);
      }
    });
  },
);

describe('slot contents', () => {
  // Every slot height the four device shapes actually produce, plus the extremes.
  const heights = [
    ...DEVICES.map((d) => hudLayout(d.opts).slots[0].h),
    40,
    52,
    64,
    140,
  ];

  it.each(heights)('stacks icon, name and price inside a %ipx slot', (h) => {
    const c = slotContent(h);
    const costBottom = c.costY + c.costSize + 3;
    const iconTop = c.iconY - (c.iconScale * 32) / 2;
    const iconBottom = c.iconY + (c.iconScale * 32) / 2;

    expect(iconTop, 'icon clipped at the top').toBeGreaterThanOrEqual(0);
    expect(iconBottom, 'icon runs into the row below').toBeLessThanOrEqual(c.showName ? c.nameY : c.costY);
    if (c.showName) {
      expect(c.nameY + c.nameSize + 3, 'name runs into the price').toBeLessThanOrEqual(c.costY);
    }
    expect(costBottom, 'price falls out of the slot').toBeLessThanOrEqual(h);
  });

  it('keeps the building name on every slot size the real devices produce', () => {
    for (const d of DEVICES) {
      expect(slotContent(hudLayout(d.opts).slots[0].h).showName, d.name).toBe(true);
    }
  });

  it('never scales the artwork past legibility', () => {
    for (const h of heights) {
      const { iconScale } = slotContent(h);
      expect(iconScale).toBeGreaterThanOrEqual(0.7);
      expect(iconScale).toBeLessThanOrEqual(2);
    }
  });

  it('gives a roomy slot bigger art and bigger type than a compact one', () => {
    const small = slotContent(52);
    const large = slotContent(131);
    expect(large.iconScale).toBeGreaterThan(small.iconScale);
    expect(large.nameSize).toBeGreaterThan(small.nameSize);
  });
});

/**
 * The tabbed bar exists to buy the board back on a phone: thirteen slots in two
 * rows made the build bar 40% of the screen and left the board under a third of
 * it. One shelf at a time is five slots, which fits one row in a much shorter
 * bar.
 */
describe('tabbed palette (phone)', () => {
  const device = DEVICES.find((d) => d.opts.tabbed)!;
  const l = hudLayout(device.opts);

  it('is actually exercised — the shipped phone bar is tabbed', () => {
    expect(device, 'no tabbed device in DEVICES').toBeDefined();
    expect(l.tabs).toHaveLength(GROUPS.length);
    expect(l.paletteRows).toBe(1);
  });

  it('still lays out every build option', () => {
    expect(l.slots).toHaveLength(SLOTS);
  });

  it('puts one shelf on a single row, inside the bar', () => {
    let first = 0;
    for (const count of GROUPS) {
      const shelf = l.slots.slice(first, first + count);
      const y = shelf[0].y;
      for (const s of shelf) {
        expect(s.y, 'a shelf must be one row').toBe(y);
        expect(s.y + s.h).toBeLessThanOrEqual(device.opts.barY + device.opts.barH);
        expect(s.x).toBeGreaterThanOrEqual(0);
        expect(s.x + s.w).toBeLessThanOrEqual(device.opts.gameW);
      }
      // within a shelf the slots must still not collide
      for (let i = 0; i < shelf.length; i++) {
        for (let j = i + 1; j < shelf.length; j++) {
          expect(overlaps(shelf[i], shelf[j]), 'two slots on one shelf overlap').toBe(false);
        }
      }
      first += count;
    }
  });

  it('sits the tabs above the slots, without overlapping them or each other', () => {
    for (let i = 0; i < l.tabs.length; i++) {
      for (let j = i + 1; j < l.tabs.length; j++) {
        expect(overlaps(l.tabs[i], l.tabs[j]), `tab ${i} overlaps tab ${j}`).toBe(false);
      }
      for (const s of l.slots) {
        expect(overlaps(l.tabs[i], s), `tab ${i} overlaps a slot`).toBe(false);
      }
    }
  });

  /** The whole point: bigger slots than the two-row bar it replaced. */
  it('buys bigger slots than the untabbed bar of the same height', () => {
    const untabbed = hudLayout({ ...device.opts, tabbed: false });
    expect(l.slots[0].h).toBeGreaterThan(untabbed.slots[0].h);
    expect(l.slots[0].w).toBeGreaterThan(untabbed.slots[0].w);
  });
});

describe('touch ergonomics', () => {
  const touchDevices = DEVICES.filter((d) => d.opts.touch);

  it('always provides the four touch-only controls', () => {
    for (const d of touchDevices) {
      expect(hudLayout(d.opts).touch, d.name).toHaveLength(4);
    }
  });

  /**
   * ROTATE was singled out by a playtester as too small to hit or read, and it
   * is one of the most-used controls on a device with no `R` key. The pad is a
   * 2×2 block of equal cells so it cannot quietly become the runt again.
   */
  it('gives every pad cell the same generous size', () => {
    for (const d of touchDevices) {
      const [rotate, confirm, sell, pause] = hudLayout(d.opts).touch;
      for (const r of [confirm, sell, pause]) {
        expect(r.w, d.name).toBe(rotate.w);
        expect(r.h, d.name).toBe(rotate.h);
      }
      // and comfortably past the 44px guideline, not merely at it
      expect(rotate.w, d.name).toBeGreaterThanOrEqual(100);
      // two rows of two, not a row of four
      expect(confirm.y, d.name).toBe(rotate.y);
      expect(sell.y, d.name).toBeGreaterThan(rotate.y);
      expect(pause.y, d.name).toBe(sell.y);
    }
  });

  it('omits them entirely on pointer devices, which have the keyboard instead', () => {
    for (const d of DEVICES.filter((x) => !x.opts.touch)) {
      expect(hudLayout(d.opts).touch, d.name).toHaveLength(0);
    }
  });

  it('makes every touch target a comfortable size', () => {
    // ~44 canvas px; FIT only ever scales the whole canvas, so relative
    // comfort is preserved whatever the device does with it
    for (const d of touchDevices) {
      const l = hudLayout(d.opts);
      for (const rect of [...l.slots, ...l.touch, ...l.toggles, l.send]) {
        expect(rect.w, `${d.name} target width`).toBeGreaterThanOrEqual(44);
        expect(rect.h, `${d.name} target height`).toBeGreaterThanOrEqual(40);
      }
    }
  });

  it('uses two roomy rows rather than one cramped strip', () => {
    for (const d of touchDevices.filter((x) => !x.opts.tabbed)) {
      const l = hudLayout(d.opts);
      expect(l.paletteRows, d.name).toBe(2);
    }
  });
});

describe('responsive command deck', () => {
  it('keeps objective, inspector, toast, and coach safe zones disjoint', () => {
    const zones = overlayZones(1280, 640, topStrip(1280, true).stats.y + topStrip(1280, true).h, true);
    expect(overlaps(zones.objective, zones.inspector)).toBe(false);
    expect(overlaps(zones.toast, zones.inspector)).toBe(false);
    expect(zones.coach.y + zones.coach.h).toBeLessThanOrEqual(640);
  });

  it('keeps landscape-phone controls at least 36 CSS pixels in both dimensions', () => {
    const opts = { gameW: 1280, barY: 640, barH: 220, roomy: true, touch: true, groups: GROUPS };
    const layout = hudLayout(opts);
    const scale = fittedScale(1280, 860, 844, 390);
    for (const rect of [...layout.slots, ...layout.touch, ...layout.toggles, layout.send]) {
      expect(renderedSize(rect, scale).w).toBeGreaterThanOrEqual(36);
      expect(renderedSize(rect, scale).h).toBeGreaterThanOrEqual(36);
    }
  });
});

describe('compact desktop bar', () => {
  const l = hudLayout(DEVICES[0].opts);

  it('keeps the single-row palette of the original layout', () => {
    expect(l.paletteRows).toBe(1);
    expect(l.paletteCols).toEqual(GROUPS);
  });

  it('packs the toggles into a 2×2 block beside the send button', () => {
    const [a, b, c, d] = l.toggles;
    expect(a.y).toBe(b.y);
    expect(c.y).toBeGreaterThan(a.y);
    expect(d.y).toBe(c.y);
    for (const t of l.toggles) expect(overlaps(t, l.send)).toBe(false);
  });
});

describe('top status strip', () => {
  for (const touch of [false, true]) {
    const name = touch ? 'touch' : 'pointer';
    const s = topStrip(GAME_W, touch);
    const rects: [string, Rect][] = [
      ['stats', s.stats],
      ['survey', s.survey],
      ['research', s.research],
      ['map', s.map],
      ['help', s.help],
      ['mute', s.mute],
      ['view', s.view],
    ];

    it(`fits inside the canvas on ${name}`, () => {
      for (const [label, r] of rects) {
        expect(r.x, `${label} left`).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w, `${label} right`).toBeLessThanOrEqual(GAME_W);
        expect(r.w, `${label} width`).toBeGreaterThan(0);
      }
    });

    it(`never overlaps two chips on ${name}`, () => {
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          expect(overlaps(rects[i][1], rects[j][1]), `${rects[i][0]} overlaps ${rects[j][0]}`).toBe(false);
        }
      }
    });

    it(`keeps every chip on one row on ${name}`, () => {
      for (const [, r] of rects) expect(r.y).toBe(s.stats.y);
    });
  }

  it('sizes the icon buttons for fingers on touch', () => {
    const s = topStrip(GAME_W, true);
    // The view chip is included deliberately: on touch there is no `G` key, so
    // this chip is the *only* way to reach the 3D board mid-run.
    for (const r of [s.help, s.mute, s.survey, s.view]) {
      expect(r.h).toBeGreaterThanOrEqual(44);
      expect(r.w).toBeGreaterThanOrEqual(44);
    }
  });

  it('stays compact on pointer devices, where hover and a keyboard exist', () => {
    expect(topStrip(GAME_W, false).h).toBeLessThan(topStrip(GAME_W, true).h);
  });

  /**
   * The strip floats over the playfield, so the board's pointer handler has to
   * know to keep its hands off. Without this, arming a building and then going
   * for SURVEY / `?` / mute / the view chip *also* planted that building on the
   * tile underneath — $160 of cryo tower for a tap on the help button.
   */
  describe('does not let a chip double as a board click', () => {
    for (const touch of [false, true]) {
      const s = topStrip(GAME_W, touch);
      const name = touch ? 'touch' : 'pointer';

      it(`shields every interactive chip on ${name}`, () => {
        for (const [label, r] of [
          ['survey', s.survey],
          ['help', s.help],
          ['mute', s.mute],
          ['view', s.view],
        ] as [string, Rect][]) {
          // all four corners and the centre, so a near-miss at an edge counts too
          for (const [x, y] of [
            [r.x, r.y],
            [r.x + r.w - 1, r.y],
            [r.x, r.y + r.h - 1],
            [r.x + r.w - 1, r.y + r.h - 1],
            [r.x + r.w / 2, r.y + r.h / 2],
          ]) {
            expect(stripHit(s, x, y), `${label} at ${x},${y} is not shielded`).toBe(true);
          }
        }
      });

      it(`leaves the board clickable everywhere else on ${name}`, () => {
        // labels must NOT be shielded: doing so would carve unbuildable rows
        // out of the top of the board for no reason
        expect(stripHit(s, s.stats.x + 4, s.stats.y + 4), 'stats readout').toBe(false);
        expect(stripHit(s, s.map.x + 4, s.map.y + 4), 'map name').toBe(false);
        // and nothing below the strip is shielded at all
        expect(stripHit(s, s.help.x + 2, s.stats.y + s.h + 1), 'below the strip').toBe(false);
      });
    }
  });
});

describe('board overlay hit zones', () => {
  it('shields the objective and coach cards, but not the empty board between them', () => {
    const zones = overlayZones(GAME_W, 640, topStrip(GAME_W, false).stats.y + topStrip(GAME_W, false).h, false);
    expect(overlayHit(zones, zones.objective.x + 1, zones.objective.y + 1, { objective: true, coach: true, inspector: false })).toBe(true);
    expect(overlayHit(zones, zones.coach.x + 1, zones.coach.y + 1, { objective: true, coach: true, inspector: false })).toBe(true);
    expect(overlayHit(zones, GAME_W / 2, 240, { objective: true, coach: true, inspector: false })).toBe(false);
  });

  it('keeps the production inspector inside its reserved zone on desktop and touch', () => {
    for (const touch of [false, true]) {
      const zones = overlayZones(GAME_W, 640, topStrip(GAME_W, touch).stats.y + topStrip(GAME_W, touch).h, touch);
      const layout = inspectorLayout(touch);
      expect(layout.panel.w * layout.scale).toBeLessThanOrEqual(zones.inspector.w);
      expect(layout.panel.h * layout.scale).toBeLessThanOrEqual(zones.inspector.h);
      expect(overlayHit(zones, zones.inspector.x + 1, zones.inspector.y + 1, { objective: true, coach: true, inspector: true })).toBe(true);
    }
  });

  it('keeps touch inspector buttons at least 36 CSS pixels at 844×390 DPR2', () => {
    const layout = inspectorLayout(true);
    const touchCanvasH = 640 + 220; // uiHeightForViewport({ width: 844, height: 390, touch: true })
    const scale = fittedScale(GAME_W, touchCanvasH, 844, 390);
    expect(renderedSize(layout.buttonA, scale).h).toBeGreaterThanOrEqual(36);
    expect(renderedSize(layout.buttonB, scale).h).toBeGreaterThanOrEqual(36);
  });

  it('keeps the visible touch coach dismiss target at least 36 CSS pixels', () => {
    const touchCanvasH = 640 + 220;
    const scale = fittedScale(GAME_W, touchCanvasH, 844, 390);
    expect(80 * scale).toBeGreaterThanOrEqual(36);
  });
});

describe('small-card copy fitting', () => {
  it('wraps long contract and coach text without exceeding their allotted line count', () => {
    const long = 'Route finished ammunition through a splitter and into every defense tower before the armored boss arrives.';
    for (const [chars, lines] of [[30, 2], [52, 2]] as const) {
      const fitted = fitCardCopy(long, chars, lines);
      expect(fitted.split('\n')).toHaveLength(lines);
      expect(fitted.split('\n').every((line) => line.length <= chars)).toBe(true);
      expect(fitted.endsWith('…')).toBe(true);
    }
  });

  it('gives primary and supporting touch card text distinct 18/16 budgets', () => {
    const limits = hudCardCopyLimits(true);
    expect(limits.missionTitle).toBeLessThan(limits.missionDetail);
    expect(limits.toastName).toBeLessThan(limits.toastDetail);
  });
});

describe('build categories', () => {
  it('groups every build option into exactly one category', () => {
    expect(buildGroupSizes().reduce((a, b) => a + b, 0)).toBe(BUILD_INFO.length);
    for (const b of BUILD_INFO) {
      expect(BUILD_CATEGORIES.some((c) => c.id === b.cat), `${b.type} has no category`).toBe(true);
    }
  });

  it('keeps BUILD_INFO sorted by category, which the bar layout assumes', () => {
    const order = BUILD_INFO.map((b) => BUILD_CATEGORIES.findIndex((c) => c.id === b.cat));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('separates the guns from the factory', () => {
    const guns = BUILD_INFO.filter((b) => b.cat === 'defense').map((b) => b.type);
    expect(guns).toEqual(['tower', 'cannon', 'lancer', 'cryo']);
    // and nothing that shoots is filed under the factory half
    for (const b of BUILD_INFO.filter((x) => x.cat !== 'defense')) {
      expect(guns).not.toContain(b.type);
    }
  });

  it('gives every category at least one slot, so no header is ever empty', () => {
    for (const n of buildGroupSizes()) expect(n).toBeGreaterThan(0);
  });

  it('assigns a unique hotkey to every build option', () => {
    const keys = BUILD_INFO.map((b) => b.hotkey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps the number row for the factory and letters for the guns', () => {
    for (const b of BUILD_INFO) {
      const numeric = /^[0-9]$/.test(b.hotkey);
      expect(numeric, `${b.type} hotkey ${b.hotkey}`).toBe(b.cat !== 'defense');
    }
  });
});

/**
 * The research level-up draw.
 *
 * This was three 280x210 cards nailed to y:190, chosen when every canvas was
 * 1280x720. Since item 40 the board viewport can be as short as 320px, and that
 * row then ends 80px underneath the build bar — the game's single biggest reward
 * moment, half-hidden, on the device most people play it on.
 *
 * `stripBottom` values are the real `topStrip` heights plus its 8px inset.
 */
describe('research card draw', () => {
  const BOARDS: { name: string; playfieldH: number; stripBottom: number; touch: boolean }[] = [
    { name: '16:9 desktop', playfieldH: 640, stripBottom: 38, touch: false },
    { name: 'iPad landscape', playfieldH: 640, stripBottom: 52, touch: true },
    { name: 'phone landscape', playfieldH: 421, stripBottom: 52, touch: true },
    // MIN_PLAYFIELD_H — the shortest board the game will ever hand a player.
    { name: 'shortest board', playfieldH: 320, stripBottom: 52, touch: true },
  ];

  describe.each(BOARDS.map((b) => [b.name, b] as const))('on %s', (_name, b) => {
    const l = cardDrawLayout(GAME_W, b.playfieldH, b.stripBottom, 3, b.touch);

    /** The regression this layout exists to prevent. */
    it('keeps every card clear of the build bar and the status strip', () => {
      for (const [i, c] of l.cards.entries()) {
        expect(c.y, `card ${i} top`).toBeGreaterThanOrEqual(b.stripBottom);
        expect(c.y + c.h, `card ${i} bottom`).toBeLessThanOrEqual(b.playfieldH);
      }
    });

    it('keeps the header above the cards', () => {
      expect(l.title.y).toBeGreaterThanOrEqual(b.stripBottom);
      expect(l.title.y + l.title.size).toBeLessThanOrEqual(l.cards[0].y);
      if (l.sub.show) expect(l.sub.y + l.sub.size).toBeLessThanOrEqual(l.cards[0].y);
    });

    it('fits the row on screen without overlapping cards', () => {
      expect(l.cards[0].x).toBeGreaterThanOrEqual(0);
      const last = l.cards[l.cards.length - 1];
      expect(last.x + last.w).toBeLessThanOrEqual(GAME_W);
      for (let i = 1; i < l.cards.length; i += 1) {
        expect(overlaps(l.cards[i - 1], l.cards[i]), `cards ${i - 1}/${i}`).toBe(false);
      }
    });

    it('centres the row', () => {
      const last = l.cards[l.cards.length - 1];
      const leftMargin = l.cards[0].x;
      const rightMargin = GAME_W - (last.x + last.w);
      expect(Math.abs(leftMargin - rightMargin)).toBeLessThanOrEqual(1);
    });

    /** Fitting is worthless if what fits is unreadable. */
    it('leaves the cards a legible size', () => {
      for (const c of l.cards) {
        expect(c.w).toBeGreaterThanOrEqual(200);
        expect(c.h).toBeGreaterThanOrEqual(150);
      }
      expect(l.nameSize).toBeGreaterThanOrEqual(12);
      expect(l.descSize).toBeGreaterThanOrEqual(10);
    });
  });

  /**
   * Width, gap and type scale are the shipped desktop values. The height is
   * deliberately 184 rather than the old 210: on a real render 210 left a dead
   * band across the bottom third of every card (worst-case content is ~150).
   */
  it('keeps the shipped desktop width, gap and type scale', () => {
    const l = cardDrawLayout(GAME_W, 640, 38, 3, false);
    expect(l.cards.map((c) => ({ w: c.w, h: c.h }))).toEqual([
      { w: 280, h: 184 }, { w: 280, h: 184 }, { w: 280, h: 184 },
    ]);
    expect(l.cards[1].x - (l.cards[0].x + l.cards[0].w)).toBe(28); // the original gap
    expect(l.title.size).toBe(30);
    expect(l.sub.show).toBe(true);
  });

  it('centres the description in the room left between name and footer', () => {
    for (const [h, sb, touch] of [[640, 38, false], [421, 52, true], [320, 52, true]] as const) {
      const l = cardDrawLayout(GAME_W, h, sb, 3, touch);
      const card = l.cards[0];
      // inside the card, and clear of both the name block and the footer
      expect(l.descCy, `h=${h}`).toBeGreaterThan(l.badgeSize + l.nameSize);
      expect(l.descCy, `h=${h}`).toBeLessThan(card.h);
      expect(l.descCy + l.descSize, `h=${h}`).toBeLessThanOrEqual(card.h);
    }
  });

  /**
   * Space is spent in priority order: the subtitle goes first, then the type
   * scale, and the cards take everything that leaves. Proving the *order* is
   * what stops a future tweak paying for chrome with card height.
   */
  it('drops the subtitle before it shrinks the cards, on a short board', () => {
    const tall = cardDrawLayout(GAME_W, 640, 52, 3, true);
    const short = cardDrawLayout(GAME_W, 320, 52, 3, true);
    expect(tall.sub.show).toBe(true);
    expect(short.sub.show).toBe(false);
    expect(short.title.size).toBeLessThan(tall.title.size);
    expect(short.cards[0].h).toBeGreaterThan(150);
  });

  it('never overflows, however absurd the board', () => {
    for (const h of [0, 60, 120, 200, 260, 320, 480, 640]) {
      for (const n of [1, 2, 3]) {
        const l = cardDrawLayout(GAME_W, h, 52, n, true);
        expect(l.cards).toHaveLength(n);
        for (const c of l.cards) {
          expect(c.h, `h=${h} n=${n}`).toBeGreaterThanOrEqual(0);
          expect(c.y + c.h, `h=${h} n=${n}`).toBeLessThanOrEqual(Math.max(h, l.cards[0].y));
        }
      }
    }
  });

  it('widens each card when fewer are dealt', () => {
    const three = cardDrawLayout(GAME_W, 640, 38, 3, false);
    const one = cardDrawLayout(GAME_W, 640, 38, 1, false);
    expect(one.cards).toHaveLength(1);
    expect(one.cards[0].w).toBeGreaterThanOrEqual(three.cards[0].w);
  });
});

/**
 * The end-of-run card.
 *
 * Every row was a fixed `y`, with REBUILD/MENU at 480 — chosen when the canvas
 * was always 720 tall. `GAME_H` is `uiH + playfieldH` and bottoms out near 400
 * (a 1400x420 window takes the short-board path), which put both buttons 106px
 * off the canvas: a defeat screen with no way out of it.
 */
describe('game over card', () => {
  // GAME_H values the shipped `canvasMetrics` actually produces, plus the floor.
  const CANVASES: { name: string; gameH: number; touch: boolean }[] = [
    { name: 'short-wide desktop window', gameH: 400, touch: false },
    { name: 'iPhone landscape', gameH: 589, touch: true },
    { name: '16:9 desktop', gameH: 720, touch: false },
    { name: 'iPad landscape', gameH: 889, touch: true },
  ];

  describe.each(CANVASES.map((c) => [c.name, c] as const))('on %s', (_name, c) => {
    const l = gameOverLayout(GAME_W, c.gameH, c.touch);
    const b = l.buttons;

    /** The regression. Losing these is a softlock, not a cosmetic bug. */
    it('keeps both buttons fully on canvas', () => {
      expect(b.y - b.h / 2).toBeGreaterThanOrEqual(0);
      expect(b.y + b.h / 2).toBeLessThanOrEqual(c.gameH);
      expect(GAME_W / 2 - b.dx - b.w / 2).toBeGreaterThanOrEqual(0);
      expect(GAME_W / 2 + b.dx + b.w / 2).toBeLessThanOrEqual(GAME_W);
    });

    it('keeps the two buttons apart', () => {
      const leftRight = GAME_W / 2 - b.dx + b.w / 2;
      const rightLeft = GAME_W / 2 + b.dx - b.w / 2;
      expect(rightLeft).toBeGreaterThan(leftRight);
    });

    it('stacks the rows in reading order without overlapping', () => {
      const rows = [l.title, l.sub, l.best, l.scrap, ...(l.grade.show ? [l.grade] : [])];
      for (let i = 1; i < rows.length; i += 1) {
        expect(rows[i].y, `row ${i}`).toBeGreaterThan(rows[i - 1].y);
        expect(rows[i].y - rows[i].size / 2).toBeGreaterThanOrEqual(rows[i - 1].y + rows[i - 1].size / 2 - 1);
      }
      expect(b.y - b.h / 2).toBeGreaterThanOrEqual(rows[rows.length - 1].y);
    });

    it('keeps the whole card on canvas, headline included', () => {
      expect(l.title.y - l.title.size / 2).toBeGreaterThanOrEqual(0);
    });

    it('leaves every row legible', () => {
      for (const r of [l.title, l.sub, l.best, l.scrap]) expect(r.size).toBeGreaterThanOrEqual(9);
      expect(b.h).toBeGreaterThanOrEqual(30);
      expect(b.w).toBeGreaterThanOrEqual(120);
    });
  });

  it('keeps the shipped proportions on every real canvas — nothing shrinks in practice', () => {
    for (const c of CANVASES) {
      const l = gameOverLayout(GAME_W, c.gameH, c.touch);
      expect(l.title.size, c.name).toBe(48);
      expect(l.sub.size, c.name).toBe(18);
      expect(l.scrap.size, c.name).toBe(17);
      expect(l.grade.show, c.name).toBe(true);
    }
  });

  it('centres the stack', () => {
    const l = gameOverLayout(GAME_W, 720, false);
    const top = l.title.y - l.title.size / 2;
    const bottom = l.buttons.y + l.buttons.h / 2;
    expect(Math.abs(top - (720 - bottom))).toBeLessThanOrEqual(2);
  });

  it('gives touch bigger buttons than the mouse, since it has room and no keyboard', () => {
    const touch = gameOverLayout(GAME_W, 889, true).buttons;
    const mouse = gameOverLayout(GAME_W, 720, false).buttons;
    expect(touch.h).toBeGreaterThan(mouse.h);
    expect(touch.w).toBeGreaterThan(mouse.w);
  });

  /**
   * Priority order: the verdict is a diagnosis, the buttons are the way out.
   * Proving the order is what stops a later tweak paying for the grade block
   * with the player's ability to leave.
   */
  it('drops the verdict before it shrinks anything, and never drops the buttons', () => {
    for (const gameH of [120, 180, 240, 300, 360, 400, 480, 589, 720, 889, 1200]) {
      for (const touch of [false, true]) {
        const l = gameOverLayout(GAME_W, gameH, touch);
        expect(l.buttons.h, `h=${gameH}`).toBeGreaterThan(0);
        expect(l.buttons.y + l.buttons.h / 2, `h=${gameH} touch=${touch}`).toBeLessThanOrEqual(gameH);
        expect(l.buttons.y - l.buttons.h / 2, `h=${gameH} touch=${touch}`).toBeGreaterThanOrEqual(0);
      }
    }
    // and the verdict is what gives way first
    expect(gameOverLayout(GAME_W, 200, false).grade.show).toBe(false);
    expect(gameOverLayout(GAME_W, 720, false).grade.show).toBe(true);
  });
});

/**
 * The post-wave report card — the most frequent overlay in the game.
 *
 * The creation site clamped this correctly and a tween then animated to a
 * literal `y: 360`, undoing it. On a phone (playfield 422) the card settled at
 * 360..518 — 96px behind the build bar, after every wave. Desktop hid the bug
 * because 360 sits just above the computed 372 there.
 */
describe('wave report card', () => {
  const BOARDS: [string, number][] = [
    ['16:9 desktop', 640],
    ['iPhone landscape', 422],
    ['shortest board', 320],
  ];

  it.each(BOARDS)('stays inside the playfield on %s', (_name, playfieldH) => {
    const r = reportCard(GAME_W, playfieldH);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.y + r.h, 'card runs under the build bar').toBeLessThanOrEqual(playfieldH);
  });

  /** The entrance must not be able to contradict the layout. */
  it.each(BOARDS)('animates from a point that also clears the bar on %s', (_name, playfieldH) => {
    const r = reportCard(GAME_W, playfieldH);
    expect(r.fromY).toBeGreaterThan(r.y); // slides up into place
    expect(r.fromY - r.y).toBeLessThanOrEqual(32); // a nudge, not a flight
  });

  it('keeps the shipped desktop position', () => {
    const r = reportCard(GAME_W, 640);
    expect(r.y).toBe(372);
    expect({ w: r.w, h: r.h }).toEqual({ w: 288, h: 158 });
    expect(r.x).toBe(Math.round(GAME_W / 2 - 288 / 2));
  });

  it('is centred horizontally', () => {
    for (const [, playfieldH] of BOARDS) {
      const r = reportCard(GAME_W, playfieldH);
      expect(Math.abs(r.x - (GAME_W - (r.x + r.w)))).toBeLessThanOrEqual(1);
    }
  });

  it('never overflows however short the board', () => {
    for (const h of [0, 80, 140, 200, 320, 422, 640]) {
      const r = reportCard(GAME_W, h);
      expect(r.y, `h=${h}`).toBeGreaterThanOrEqual(0);
      if (h >= r.h + 24) expect(r.y + r.h, `h=${h}`).toBeLessThanOrEqual(h);
    }
  });
});

/**
 * The upgrade panel.
 *
 * `overlayZones` already clamped `inspector.h` to the room left under the toast,
 * but GameScene drew the panel at its authored height regardless — a 320px panel
 * into a 268px gap on a phone, putting both upgrade buttons (the entire point of
 * the panel) behind the build bar. The zone now carries the scale the panel must
 * be drawn at, so the two cannot disagree.
 */
describe('upgrade panel fits its zone', () => {
  const SHAPES: [string, number, boolean][] = [
    ['16:9 desktop', 640, false],
    ['iPad landscape', 640, true],
    ['iPhone landscape', 422, true],
    ['shortest board', 320, true],
  ];

  it.each(SHAPES)('never overhangs the build bar on %s', (_name, playfieldH, touch) => {
    const z = overlayZones(GAME_W, playfieldH, touch ? 52 : 38, touch);
    expect(z.inspector.y + z.inspector.h, 'panel runs under the bar').toBeLessThanOrEqual(playfieldH);
    expect(z.inspectorScale).toBeGreaterThan(0);
    expect(z.inspectorScale).toBeLessThanOrEqual(inspectorLayout(touch).scale);
  });

  it.each(SHAPES)('draws the authored panel at exactly the zone size on %s', (_name, playfieldH, touch) => {
    const z = overlayZones(GAME_W, playfieldH, touch ? 52 : 38, touch);
    const panel = inspectorLayout(touch).panel;
    // The buttons are laid out inside the authored panel, so if the panel's
    // scaled height fits the zone, so does every control in it.
    const drawnH = panel.h * z.inspectorScale;
    expect(z.inspector.y + drawnH).toBeLessThanOrEqual(playfieldH + 0.5);
    const btn = inspectorLayout(touch).buttonB;
    expect(z.inspector.y + (btn.y + btn.h) * z.inspectorScale).toBeLessThanOrEqual(playfieldH + 0.5);
  });

  it('leaves desktop and iPad completely unscaled', () => {
    expect(overlayZones(GAME_W, 640, 38, false).inspectorScale).toBe(1);
    expect(overlayZones(GAME_W, 640, 52, true).inspectorScale).toBe(1);
  });

  it('keeps the panel a usable size where it does scale', () => {
    const z = overlayZones(GAME_W, 422, 52, true);
    expect(z.inspectorScale).toBeLessThan(1);       // it really is scaling here
    expect(z.inspectorScale).toBeGreaterThan(0.7);  // and not into illegibility
    const btn = inspectorLayout(true).buttonB;
    expect(btn.h * z.inspectorScale, 'upgrade button below a finger').toBeGreaterThanOrEqual(44);
  });

  it('stays right-anchored as it scales', () => {
    for (const [, playfieldH, touch] of SHAPES) {
      const z = overlayZones(GAME_W, playfieldH, touch ? 52 : 38, touch);
      expect(z.inspector.x + z.inspector.w).toBeCloseTo(GAME_W - (touch ? 12 : 8), 5);
    }
  });
});

/**
 * The `[L]` logistics legend.
 *
 * It hung at a fixed offset below the status strip — the same band the objective
 * card and the toast already occupy — and is ~860px of centred text, so it lay
 * straight across the objective card whenever the overlay was on. Item 26 moved
 * it off the *strip* for exactly this reason; it landed on the next thing down.
 */
describe('logistics legend', () => {
  const SHAPES: [string, number, number, boolean][] = [
    ['16:9 desktop', 640, 38, false],
    ['iPad landscape', 640, 52, true],
    ['iPhone landscape', 422, 52, true],
    ['shortest board', 320, 52, true],
  ];

  it.each(SHAPES)('sits below the objective card and the toast on %s', (_n, playfieldH, stripBottom, touch) => {
    const z = overlayZones(GAME_W, playfieldH, stripBottom, touch);
    const b = legendBand(z, touch);
    expect(b.y, 'runs over the objective card').toBeGreaterThanOrEqual(z.objective.y + z.objective.h);
    expect(b.y, 'runs over the toast').toBeGreaterThanOrEqual(z.toast.y + z.toast.h);
  });

  /**
   * Clearing the cards vertically is not enough: on a short board the upgrade
   * panel starts higher, so a full-width legend just collides with it lower
   * down. Width is part of the answer, which is why `legendBand` owns both.
   */
  it.each(SHAPES)('stops before the upgrade panel on %s', (_n, playfieldH, stripBottom, touch) => {
    const z = overlayZones(GAME_W, playfieldH, stripBottom, touch);
    const b = legendBand(z, touch);
    expect(b.x + b.w).toBeLessThanOrEqual(z.inspector.x);
  });

  it.each(SHAPES)('stays on the board and readable on %s', (_n, playfieldH, stripBottom, touch) => {
    const z = overlayZones(GAME_W, playfieldH, stripBottom, touch);
    const b = legendBand(z, touch);
    expect(b.y).toBeLessThan(playfieldH);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.w, 'too narrow to read').toBeGreaterThan(400);
  });
});

/**
 * The kill-streak meter.
 *
 * It was pinned to `GAME_W - 10` under a comment claiming the achievement toasts
 * were top-left. They are not — `overlayZones.toast` is `gameW - pad - toastW`,
 * the same corner. Measured on a phone the meter sat at x 1156–1270 against a
 * toast zone of 968–1268, so an achievement unlocking mid-streak landed on the
 * streak counter: two pieces of celebration feedback colliding at the exact
 * moment both fire.
 */
describe('kill streak meter', () => {
  const SHAPES: [string, number, number, boolean][] = [
    ['16:9 desktop', 640, 38, false],
    ['iPad landscape', 640, 52, true],
    ['iPhone landscape', 422, 52, true],
    ['shortest board', 320, 52, true],
  ];

  const meterRect = (z: ReturnType<typeof overlayZones>, stripBottom: number, touch: boolean) => {
    const a = comboAnchor(z, stripBottom, touch);
    return { x: a.x - COMBO_METER_MAX_W, y: a.y, w: COMBO_METER_MAX_W, h: 26 };
  };

  it.each(SHAPES)('never overlaps the achievement toast on %s', (_n, playfieldH, stripBottom, touch) => {
    const z = overlayZones(GAME_W, playfieldH, stripBottom, touch);
    expect(overlaps(meterRect(z, stripBottom, touch), z.toast), 'meter under the toast').toBe(false);
  });

  it.each(SHAPES)('never overlaps the objective card on %s', (_n, playfieldH, stripBottom, touch) => {
    const z = overlayZones(GAME_W, playfieldH, stripBottom, touch);
    expect(overlaps(meterRect(z, stripBottom, touch), z.objective), 'meter over the objective').toBe(false);
  });

  it.each(SHAPES)('stays on screen and below the strip on %s', (_n, playfieldH, stripBottom, touch) => {
    const z = overlayZones(GAME_W, playfieldH, stripBottom, touch);
    const r = meterRect(z, stripBottom, touch);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(GAME_W);
    expect(r.y).toBeGreaterThanOrEqual(stripBottom);
    expect(r.y + r.h).toBeLessThanOrEqual(playfieldH);
  });
});
