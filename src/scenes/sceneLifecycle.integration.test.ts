import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameState, WaveTally } from '../state/GameState';
import { GameScene } from './GameScene';
import { UIScene } from './UIScene';
import { OverlayScheduler } from './overlayScheduler';

const tally = (): WaveTally => ({ kills: 0, leaked: 0, income: 0, fired: {}, produced: {}, delivered: {}, toLab: {}, magStart: 0, magEnd: 0, starved: 0 });

afterEach(() => {
  vi.restoreAllMocks();
  GameState.events.off('missioncomplete').off('inspector').off('boardoverlay').off('boardoverlayrequest');
});

describe('production scene lifecycle seams', () => {
  it('runs UIScene’s wired wavesummary method in report → synchronous mission toast → ambient order', () => {
    const ui = new UIScene() as unknown as { onWaveSummary(w: number, t: WaveTally): void; queueWaveSummary(w: number, t: WaveTally): void };
    const scheduler = new OverlayScheduler();
    let toastQueued = false;
    ui.queueWaveSummary = () => scheduler.openReport();
    GameState.events.on('missioncomplete', () => {
      expect(scheduler.reportOpen).toBe(true);
      toastQueued = true;
    });
    vi.spyOn(GameState, 'checkMissions').mockImplementation(() => GameState.events.emit('missioncomplete'));

    ui.onWaveSummary(7, tally());
    expect(toastQueued).toBe(true);
    expect(scheduler.canStartToast(false)).toBe(false);
    scheduler.closeReport();
    expect(scheduler.canStartToast(false)).toBe(true);
    scheduler.openToast();
    scheduler.closeToast();
    expect(scheduler.ambientOpen).toBe(true);
  });

  it('runs GameScene’s production panel lifecycle and emits open/close state on the real event bus', () => {
    const game = new GameScene() as unknown as { panel: { setVisible(on: boolean): void }; inspectorOpen: boolean; setPanelVisible(on: boolean): void };
    const states: boolean[] = [];
    game.panel = { setVisible: () => undefined };
    GameState.events.on('inspector', (on: boolean) => states.push(on));
    game.setPanelVisible(true);
    game.setPanelVisible(false);
    game.setPanelVisible(false); // restart/close idempotence: no duplicate edge
    expect(states).toEqual([true, false]);
  });
});
