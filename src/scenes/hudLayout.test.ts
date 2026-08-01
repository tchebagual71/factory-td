import { describe, expect, it } from 'vitest';
import { BUILD_CATEGORIES, BUILD_INFO, buildGroupSizes } from '../data/buildings';
import {
  fittedScale,
  fitCardCopy,
  hudCardCopyLimits,
  hudLayout,
  inspectorLayout,
  HudLayoutOpts,
  overlayZones,
  overlaps,
  overlayHit,
  Rect,
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
    name: 'phone landscape (very wide, touch)',
    opts: { gameW: GAME_W, barY: BAR_Y, barH: 220, roomy: true, touch: true, groups: GROUPS },
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
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        // the preview strip is a label above the send button, not a control
        if (rects[i].label === 'preview' || rects[j].label === 'preview') continue;
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

describe.each(DEVICES.map((d): [string, HudLayoutOpts] => [d.name, d.opts]))(
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
    for (const d of touchDevices) {
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
