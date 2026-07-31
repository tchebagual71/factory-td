import { describe, expect, it } from 'vitest';
import { OverlayScheduler } from './overlayScheduler';

describe('UIScene report → mission toast → ambient scheduler', () => {
  it('holds a synchronous mission toast behind the report then restores ambient after it exits', () => {
    const scene = new OverlayScheduler();
    scene.openReport(); // wavesummary opens the report before GameState.checkMissions emits missioncomplete
    expect(scene.canStartToast(false)).toBe(false);
    expect(scene.ambientOpen).toBe(false);

    scene.closeReport(); // the report tween completes
    expect(scene.canStartToast(false)).toBe(true);
    scene.openToast();
    expect(scene.toastOpen).toBe(true);
    expect(scene.ambientOpen).toBe(false);

    scene.closeToast();
    expect(scene.ambientOpen).toBe(true);
  });
});
