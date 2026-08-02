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

  it('cancels a pending touch intent without mutating the board', () => {
    const endStroke = vi.fn();
    const scene = {
      touchIntent: { kind: 'belt', tx: 3, ty: 4 },
      pendingTap: { tx: 3, ty: 4 },
      sellDown: { tx: 3, ty: 4, right: false },
      dragPan: { x: 96, y: 128 },
      pinch: { dist: 64, mx: 120, my: 80 },
      endStroke,
    };
    const cancel = (GameScene.prototype as unknown as {
      cancelTouchBoardAction(this: typeof scene): void;
    }).cancelTouchBoardAction;

    cancel.call(scene);

    expect(scene.touchIntent).toBeNull();
    expect(scene.pendingTap).toBeNull();
    expect(scene.sellDown).toBeNull();
    expect(scene.dragPan).toBeNull();
    expect(scene.pinch).toBeNull();
    expect(endStroke).toHaveBeenCalledOnce();
  });

  const resolve = (GameScene.prototype as unknown as {
    resolveTouchTap(this: Record<string, unknown>): void;
  }).resolveTouchTap;

  it('resolves a classified belt tap exactly once on release', () => {
    const scene = {
      selected: 'belt',
      touchIntent: { kind: 'belt', tx: 3, ty: 4 },
      startStroke: vi.fn(),
      endStroke: vi.fn(),
    };

    resolve.call(scene);

    expect(scene.startStroke).toHaveBeenCalledWith(3, 4);
    expect(scene.endStroke).toHaveBeenCalledOnce();
    expect(scene.touchIntent).toBeNull();
  });

  it('stages a classified build tap without purchasing it', () => {
    const scene = {
      selected: 'tower',
      pending: null,
      touchIntent: { kind: 'build', tx: 5, ty: 6, type: 'tower' },
      stagePending: vi.fn(),
      commitPending: vi.fn(),
    };

    resolve.call(scene);

    expect(scene.stagePending).toHaveBeenCalledWith(5, 6);
    expect(scene.commitPending).not.toHaveBeenCalled();
  });

  it('routes classified survey, sell, and inspect taps to their existing seams', () => {
    const building = { type: 'tower' };
    const survey = {
      surveyMode: true,
      pending: null,
      touchIntent: { kind: 'survey', tx: 7, ty: 8 },
      stagePending: vi.fn(),
      commitPending: vi.fn(),
    };
    resolve.call(survey);
    expect(survey.stagePending).toHaveBeenCalledWith(7, 8, false, 'survey');

    const sell = {
      sellMode: true,
      touchIntent: { kind: 'sell', tx: 9, ty: 10 },
      grid: { cellAt: () => ({ building }) },
      beginSaleGroup: vi.fn(),
      requestSell: vi.fn(),
    };
    resolve.call(sell);
    expect(sell.requestSell).toHaveBeenCalledWith(building);

    const inspect = {
      time: { now: 900 },
      pressAt: 800,
      touchIntent: { kind: 'inspect', tx: 11, ty: 12 },
      resolveInspectTap: vi.fn(),
    };
    resolve.call(inspect);
    expect(inspect.resolveInspectTap).toHaveBeenCalledWith(11, 12, 100);
  });

  it('begins a classified belt drag at its captured origin before painting the current tile', () => {
    const scene = {
      selected: 'belt',
      touchIntent: { kind: 'belt', tx: 3, ty: 4 },
      tileAt: vi.fn(() => ({ tx: 6, ty: 7 })),
      startStroke: vi.fn(),
      paintBeltTo: vi.fn(),
    };
    const begin = (GameScene.prototype as unknown as {
      beginTouchDrag(this: typeof scene, p: { x: number; y: number }): void;
    }).beginTouchDrag;

    begin.call(scene, { x: 192, y: 224 });

    expect(scene.startStroke).toHaveBeenCalledWith(3, 4);
    expect(scene.paintBeltTo).toHaveBeenCalledWith(6, 7);
  });
});
