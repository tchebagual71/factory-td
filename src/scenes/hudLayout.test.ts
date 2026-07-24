import { describe, expect, it } from 'vitest';
import { hudLayout, HudLayoutOpts, overlaps, Rect } from './hudLayout';

const GAME_W = 1280;
const BAR_Y = 640;
const SLOTS = 12; // BUILD_INFO length

/** The screen shapes the game actually has to survive. */
const DEVICES: { name: string; opts: HudLayoutOpts }[] = [
  {
    name: '16:9 desktop',
    opts: { gameW: GAME_W, barY: BAR_Y, barH: 80, roomy: false, touch: false, slotCount: SLOTS },
  },
  {
    name: 'iPad landscape (4:3, touch)',
    opts: { gameW: GAME_W, barY: BAR_Y, barH: 300, roomy: true, touch: true, slotCount: SLOTS },
  },
  {
    name: 'phone landscape (very wide, touch)',
    opts: { gameW: GAME_W, barY: BAR_Y, barH: 170, roomy: true, touch: true, slotCount: SLOTS },
  },
  {
    name: 'boxy tablet, no touch',
    opts: { gameW: GAME_W, barY: BAR_Y, barH: 300, roomy: true, touch: false, slotCount: SLOTS },
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
    for (const { label, rect } of rects) {
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
    expect(l.paletteCols * l.paletteRows).toBeGreaterThanOrEqual(SLOTS);
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

  it('uses two roomy rows rather than one cramped strip of twelve', () => {
    for (const d of touchDevices) {
      const l = hudLayout(d.opts);
      expect(l.paletteRows, d.name).toBe(2);
      expect(l.paletteCols, d.name).toBe(6);
    }
  });
});

describe('compact desktop bar', () => {
  const l = hudLayout(DEVICES[0].opts);

  it('keeps the single-row palette of the original layout', () => {
    expect(l.paletteRows).toBe(1);
    expect(l.paletteCols).toBe(SLOTS);
  });

  it('packs the toggles into a 2×2 block beside the send button', () => {
    const [a, b, c, d] = l.toggles;
    expect(a.y).toBe(b.y);
    expect(c.y).toBeGreaterThan(a.y);
    expect(d.y).toBe(c.y);
    for (const t of l.toggles) expect(overlaps(t, l.send)).toBe(false);
  });
});
