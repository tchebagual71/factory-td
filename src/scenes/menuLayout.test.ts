import { describe, expect, it } from 'vitest';
import { canvasMetrics } from '../config';
import { fittedScale } from './hudLayout';
import { menuLayout, renderedFontSize } from './menuLayout';

describe('responsive menu layout', () => {
  it('preserves the established 1280×720 desktop composition', () => {
    const layout = menuLayout({ gameW: 1280, gameH: 720, touch: false, hasSave: true });

    expect(layout.compact).toBe(false);
    expect(layout.cameraZoom).toBe(1);
    expect(layout.title).toEqual({ y: 130, size: 64 });
    expect(layout.subtitle).toEqual({ y: 185, size: 15 });
    expect(layout.main).toMatchObject({
      continueY: 265,
      newRunY: 327,
      actionsY: 389,
      secondaryY: 451,
      buttonH: 50,
      fullLabelSize: 16,
      halfLabelSize: 14,
    });
    expect(layout.map.y).toBe(525);
    expect(layout.settings.y).toBe(613);
    expect(layout.footer).toEqual({ y: 694, size: 11, short: false });
  });

  it.each([
    ['844×390 phone', 844, 390],
    ['852×393 phone', 852, 393],
    ['932×430 phone', 932, 430],
  ])('keeps type physically readable on an %s', (_name, viewportW, viewportH) => {
    const canvas = canvasMetrics({ width: viewportW, height: viewportH, touch: true });
    const fit = fittedScale(canvas.gameW, canvas.gameH, viewportW, viewportH);
    const layout = menuLayout({ ...canvas, touch: true, hasSave: true });

    expect(layout.compact).toBe(true);
    expect(layout.cameraZoom).toBe(1);
    expect(renderedFontSize(layout.main.fullLabelSize, layout.cameraZoom, fit)).toBeGreaterThanOrEqual(11);
    expect(renderedFontSize(layout.map.blurbSize, layout.cameraZoom, fit)).toBeGreaterThanOrEqual(9);
    expect(renderedFontSize(layout.footer.size, layout.cameraZoom, fit)).toBeGreaterThanOrEqual(9);
  });

  it.each([
    [844, 390],
    [852, 393],
    [932, 430],
  ])('keeps every compact row in bounds without crowding the map at %i×%i', (viewportW, viewportH) => {
    const canvas = canvasMetrics({ width: viewportW, height: viewportH, touch: true });
    const layout = menuLayout({ ...canvas, touch: true, hasSave: true });

    expect(layout.main.secondaryY + layout.main.buttonH / 2).toBeLessThan(layout.map.y - 20);
    expect(layout.map.y + 50 + layout.map.blurbSize).toBeLessThan(layout.settings.y);
    expect(layout.settings.y).toBeLessThan(layout.best.y);
    expect(layout.best.y + layout.best.size).toBeLessThan(layout.footer.y);
    expect(layout.footer.y + layout.footer.size).toBeLessThanOrEqual(layout.designH);
  });

  it('uses the real canvas for an invalid-dimension fallback', () => {
    expect(menuLayout({ gameW: Number.NaN, gameH: 0, touch: true, hasSave: false })).toMatchObject({
      compact: false,
      cameraZoom: 1,
      designW: 1280,
      designH: 720,
    });
  });
});
