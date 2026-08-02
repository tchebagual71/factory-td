import { afterEach, describe, expect, it, vi } from 'vitest';
import { GAME_W, IS_TOUCH, PLAYFIELD_H } from '../config';
import { setReducedFx } from '../utils/feel';
import { boardOverlayVisibility } from './overlayPresentation';
import { overlayPlan } from './overlayPolicy';
import { overlayZones, topStrip } from './hudLayout';
import { GameScene } from './GameScene';

describe('GameScene live overlay input path', () => {
  it('releases dismissed or policy-hidden card regions while shielding visibly presented cards', () => {
    const strip = topStrip(GAME_W, IS_TOUCH);
    const zones = overlayZones(GAME_W, PLAYFIELD_H, strip.stats.y + strip.h, IS_TOUCH);
    const overHud = (GameScene.prototype as unknown as { overHud(x: number, y: number): boolean }).overHud;
    const scene = {
      strip,
      overPanel: () => false,
      boardOverlay: boardOverlayVisibility(overlayPlan({ terminal: false, blocking: false, report: false, transient: false, inspector: false }), true, false),
    };

    expect(overHud.call(scene, zones.objective.x + 2, zones.objective.y + 2)).toBe(true);
    expect(overHud.call(scene, zones.coach.x + 2, zones.coach.y + 2)).toBe(true);

    // UIScene's policy broadcast after coach dismissal and a report/toast transition.
    scene.boardOverlay = boardOverlayVisibility(overlayPlan({ terminal: false, blocking: false, report: true, transient: true, inspector: false }), false, true);
    expect(overHud.call(scene, zones.objective.x + 2, zones.objective.y + 2)).toBe(false);
    expect(overHud.call(scene, zones.coach.x + 2, zones.coach.y + 2)).toBe(false);
  });
});

describe('GameScene screenshake policy', () => {
  afterEach(() => setReducedFx(false));

  it('delegates once to the main camera when effects are enabled', () => {
    setReducedFx(false);
    const cameraShake = vi.fn();
    const scene = Object.create(GameScene.prototype) as {
      cameras: { main: { shake: typeof cameraShake } };
      shake(duration: number, intensity: number): void;
    };
    scene.cameras = { main: { shake: cameraShake } };

    scene.shake(180, 0.006);

    expect(cameraShake).toHaveBeenCalledOnce();
    expect(cameraShake).toHaveBeenCalledWith(180, 0.006);
  });

  it('does not touch the camera when reduced effects are enabled', () => {
    setReducedFx(true);
    const cameraShake = vi.fn();
    const scene = Object.create(GameScene.prototype) as {
      cameras: { main: { shake: typeof cameraShake } };
      shake(duration: number, intensity: number): void;
    };
    scene.cameras = { main: { shake: cameraShake } };

    scene.shake(180, 0.006);

    expect(cameraShake).not.toHaveBeenCalled();
  });
});
