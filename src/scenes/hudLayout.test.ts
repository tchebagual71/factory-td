import { describe, expect, it } from 'vitest';
import { BUILD_CATEGORIES, BUILD_INFO, buildGroupSizes } from '../data/buildings';
import { hudLayout, HudLayoutOpts, overlaps, Rect, slotContent, topStrip } from './hudLayout';

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
    opts: { gameW: GAME_W, barY: BAR_Y, barH: 170, roomy: true, touch: true, groups: GROUPS },
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

  it('always provides the three touch-only controls', () => {
    for (const d of touchDevices) {
      expect(hudLayout(d.opts).touch, d.name).toHaveLength(3);
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
    for (const r of [s.help, s.mute, s.survey]) {
      expect(r.h).toBeGreaterThanOrEqual(44);
      expect(r.w).toBeGreaterThanOrEqual(44);
    }
  });

  it('stays compact on pointer devices, where hover and a keyboard exist', () => {
    expect(topStrip(GAME_W, false).h).toBeLessThan(topStrip(GAME_W, true).h);
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
