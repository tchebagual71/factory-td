import { describe, expect, it } from 'vitest';
import { BUILD_INFO, buildGroupSizes } from '../data/buildings';
import { ACHIEVEMENTS } from '../data/achievements';
import { MISSIONS } from '../data/missions';
import { fitCardCopy, hudCardCopyLimits } from './hudLayout';
import { controlVisual, UI_COLOR } from './uiTheme';
import { UIScene } from './UIScene';

class PaletteObject {
  fill: number | undefined;
  stroke: number | undefined;
  text: string | undefined;
  color: string | undefined;
  interactive = false;
  handlers = new Map<string, () => void>();

  setOrigin(): this { return this; }
  setStrokeStyle(_width: number, color: number): this { this.stroke = color; return this; }
  setInteractive(): this { this.interactive = true; return this; }
  on(event: string, handler: () => void): this { this.handlers.set(event, handler); return this; }
  setFillStyle(color: number): this { this.fill = color; return this; }
  setScale(): this { return this; }
  setText(text: string): this { this.text = text; return this; }
  setColor(color: string): this { this.color = color; return this; }
}

describe('UIScene description handoff', () => {
  it('does not write coach copy before the coach text exists', () => {
    const showDesc = (UIScene.prototype as unknown as { showDesc(text: string): void }).showDesc;

    expect(() => showDesc.call({ descText: undefined }, 'Build the line.')).not.toThrow();
  });

  it('gives a hovered build slot the semantic bright hover border', () => {
    const frames: PaletteObject[] = [];
    const object = () => new PaletteObject();
    const scene = Object.assign(Object.create(UIScene.prototype), {
      add: {
        container: () => ({ add: () => undefined }),
        rectangle: (_x: number, _y: number, _w: number, _h: number, fill: number) => {
          const frame = object();
          frame.fill = fill;
          frames.push(frame);
          return frame;
        },
        image: object,
        text: object,
      },
      slotColor: new Map(),
      // Tabbed bars record which shelf each slot belongs to, so the stub needs
      // somewhere for buildPalette to put that.
      slotShelf: [],
      tabParts: [],
      paletteFrames: new Map(),
      paletteButtons: new Map(),
      paletteState: new Map(),
      showDesc: () => undefined,
      showHint: () => undefined,
    });
    const buildPalette = (UIScene.prototype as unknown as { buildPalette(layout: unknown): void }).buildPalette;
    buildPalette.call(scene, {
      slots: BUILD_INFO.map((_, index) => ({ x: index * 80, y: 0, w: 76, h: 64 })),
      groupHeaders: buildGroupSizes().map((_, index) => ({ x: index * 200, y: 0, w: 180, h: 11 })),
    });
    const frame = frames.find((candidate) => candidate.interactive);

    expect(frame).toBeDefined();
    frame!.handlers.get('pointerover')!();
    expect(frame!.stroke).toBe(controlVisual('hover').stroke);
  });

  it('keeps a selected build slot gold rim through hover and hover-out', () => {
    const frames: PaletteObject[] = [];
    const object = () => new PaletteObject();
    const scene = Object.assign(Object.create(UIScene.prototype), {
      add: {
        container: () => ({ add: () => undefined }),
        rectangle: (_x: number, _y: number, _w: number, _h: number, fill: number) => {
          const frame = object();
          frame.fill = fill;
          frames.push(frame);
          return frame;
        },
        image: object,
        text: object,
      },
      slotColor: new Map(),
      // Tabbed bars record which shelf each slot belongs to, so the stub needs
      // somewhere for buildPalette to put that.
      slotShelf: [],
      tabParts: [],
      paletteFrames: new Map(),
      paletteButtons: new Map(),
      paletteState: new Map(),
      showDesc: () => undefined,
      showHint: () => undefined,
    });
    const proto = UIScene.prototype as unknown as {
      buildPalette(layout: unknown): void;
      refreshSelection(type: 'belt'): void;
    };
    proto.buildPalette.call(scene, {
      slots: BUILD_INFO.map((_, index) => ({ x: index * 80, y: 0, w: 76, h: 64 })),
      groupHeaders: buildGroupSizes().map((_, index) => ({ x: index * 200, y: 0, w: 180, h: 11 })),
    });
    proto.refreshSelection.call(scene, 'belt');
    const frame = scene.paletteFrames.get('belt') as PaletteObject;
    const state = scene.paletteState.get('belt') as PaletteObject;
    frame.handlers.get('pointerover')!();
    expect(frame.stroke).toBe(UI_COLOR.money.hex);
    frame.handlers.get('pointerout')!();

    expect(frame.stroke).toBe(UI_COLOR.money.hex);
    expect(state.text).toBe('SELECTED');
  });

  it('clamps every current mission and toast string inside desktop and touch card budgets', () => {
    for (const touch of [false, true]) {
      const limits = hudCardCopyLimits(touch);
      const assertFits = (text: string, budget: number) => {
        const fitted = fitCardCopy(text, budget, 1);
        expect(fitted.split('\n')).toHaveLength(1);
        expect(fitted.length).toBeLessThanOrEqual(budget);
      };
      for (const mission of MISSIONS) {
        assertFits(touch ? `${mission.name} +$999` : `CONTRACT · ${mission.name}   +$999`, limits.missionTitle);
        assertFits(`${mission.desc} · 999/999 delivered`, limits.missionDetail);
        assertFits(`MISSION COMPLETE  ${mission.name}`, limits.toastName);
        assertFits(`${mission.desc} — +$999`, limits.toastDetail);
      }
      for (const achievement of ACHIEVEMENTS) {
        assertFits(`★ ${achievement.name}`, limits.toastName);
        assertFits(achievement.unlock ? `${achievement.desc} — ${achievement.unlock.label}` : achievement.desc, limits.toastDetail);
      }
    }
  });
});
