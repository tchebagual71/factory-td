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

  it.each([
    ['touchcancel', true, false],
    ['pointerupoutside', false, true],
  ] as const)('terminates %s without resolving the captured board intent', (_name, wasCanceled, outside) => {
    const startStroke = vi.fn();
    const scene = Object.assign(Object.create(GameScene.prototype), {
      touchGesture: { kind: 'pending-single' as const, owner: 1, x: 96, y: 112 },
      touchIntent: { kind: 'belt' as const, tx: 3, ty: 4 },
      input: { manager: { pointers: [{ id: 1, isDown: true, y: 112 }] } },
      pendingTap: null,
      sellDown: null,
      dragPan: null,
      pinch: null,
      selected: 'belt',
      startStroke,
      endStroke: vi.fn(),
      endSweep: vi.fn(),
      overHud: vi.fn(() => false),
    });
    const finish = (GameScene.prototype as unknown as {
      finishTouchPointer(
        this: typeof scene,
        p: { id: number; x: number; y: number; wasCanceled: boolean },
        outside: boolean,
      ): void;
    }).finishTouchPointer;

    finish.call(scene, { id: 1, x: 96, y: 112, wasCanceled }, outside);

    expect(startStroke).not.toHaveBeenCalled();
    expect(scene.touchGesture).toEqual({ kind: 'idle' });
    expect(scene.touchIntent).toBeNull();
    expect(scene.dragPan).toBeNull();
    expect(scene.pinch).toBeNull();
  });

  it('classifies a board-first, upgrade-panel-second touch as pinch before upgrading', () => {
    const tryUpgrade = vi.fn();
    const scene = Object.assign(Object.create(GameScene.prototype), {
      touchGesture: { kind: 'pending-single' as const, owner: 1, x: 96, y: 112 },
      touchIntent: { kind: 'belt' as const, tx: 3, ty: 4 },
      input: { manager: { pointers: [
        { id: 1, isDown: true, y: 112 },
        { id: 2, isDown: true, y: 180 },
      ] } },
      pendingTap: null,
      sellDown: null,
      dragPan: null,
      pinch: null,
      endStroke: vi.fn(),
      tryUpgrade,
    });
    const pointerDown = (GameScene.prototype as unknown as {
      handleUpgradePointerDown(
        this: typeof scene,
        p: { id: number; x: number; y: number; wasTouch: boolean },
        choice: 0 | 1,
      ): void;
    }).handleUpgradePointerDown;

    pointerDown.call(scene, { id: 2, x: 1100, y: 180, wasTouch: true }, 0);

    expect(tryUpgrade).not.toHaveBeenCalled();
    expect(scene.touchGesture).toEqual({ kind: 'pinch' });
    expect(scene.touchIntent).toBeNull();
  });

  it('keeps mouse upgrade pointerdown immediate without capturing touch intent', () => {
    const tryUpgrade = vi.fn();
    const captureUpgradeTouch = vi.fn();
    const scene = { tryUpgrade, captureUpgradeTouch };
    const pointerDown = (GameScene.prototype as unknown as {
      handleUpgradePointerDown(
        this: typeof scene,
        p: { wasTouch: boolean },
        choice: 0 | 1,
      ): void;
    }).handleUpgradePointerDown;

    pointerDown.call(scene, { wasTouch: false }, 1);

    expect(tryUpgrade).toHaveBeenCalledOnce();
    expect(tryUpgrade).toHaveBeenCalledWith(1);
    expect(captureUpgradeTouch).not.toHaveBeenCalled();
  });

  it('resolves a touch upgrade only for its owning pointer on the same button release', () => {
    const tryUpgrade = vi.fn();
    const scene = Object.assign(Object.create(GameScene.prototype), {
      touchGesture: { kind: 'idle' as const },
      touchIntent: null,
      input: { manager: { pointers: [{ id: 7, isDown: true, y: 180 }] } },
      pendingTap: null,
      sellDown: null,
      dragPan: null,
      pinch: null,
      endStroke: vi.fn(),
      endSweep: vi.fn(),
      overHud: vi.fn(() => true),
      tryUpgrade,
    });
    const capture = (GameScene.prototype as unknown as {
      captureUpgradeTouch(
        this: typeof scene,
        p: { id: number; x: number; y: number; wasTouch: boolean },
        choice: 0 | 1,
      ): void;
    }).captureUpgradeTouch;
    const finish = (GameScene.prototype as unknown as {
      finishTouchPointer(
        this: typeof scene,
        p: { id: number; x: number; y: number; wasCanceled: boolean },
        outside: boolean,
        upgradeChoice?: 0 | 1,
      ): void;
    }).finishTouchPointer;

    capture.call(scene, { id: 7, x: 1100, y: 180, wasTouch: true }, 1);
    expect(tryUpgrade).not.toHaveBeenCalled();
    expect(scene.touchIntent).toEqual({ kind: 'upgrade', choice: 1, pointerId: 7 });

    finish.call(scene, { id: 8, x: 1100, y: 180, wasCanceled: false }, false, 1);
    expect(tryUpgrade).not.toHaveBeenCalled();
    expect(scene.touchIntent).toEqual({ kind: 'upgrade', choice: 1, pointerId: 7 });

    finish.call(scene, { id: 7, x: 1100, y: 180, wasCanceled: false }, false, 1);
    expect(tryUpgrade).toHaveBeenCalledOnce();
    expect(tryUpgrade).toHaveBeenCalledWith(1);
    expect(scene.touchGesture).toEqual({ kind: 'idle' });
    expect(scene.touchIntent).toBeNull();
  });

  it('cancels a touch upgrade released over the other upgrade button', () => {
    const tryUpgrade = vi.fn();
    const scene = Object.assign(Object.create(GameScene.prototype), {
      touchGesture: { kind: 'idle' as const },
      touchIntent: null,
      input: { manager: { pointers: [{ id: 9, isDown: true, y: 180 }] } },
      pendingTap: null,
      sellDown: null,
      dragPan: null,
      pinch: null,
      endStroke: vi.fn(),
      endSweep: vi.fn(),
      overHud: vi.fn(() => true),
      tryUpgrade,
    });
    const capture = (GameScene.prototype as unknown as {
      captureUpgradeTouch(
        this: typeof scene,
        p: { id: number; x: number; y: number; wasTouch: boolean },
        choice: 0 | 1,
      ): void;
    }).captureUpgradeTouch;
    const finish = (GameScene.prototype as unknown as {
      finishTouchPointer(
        this: typeof scene,
        p: { id: number; x: number; y: number; wasCanceled: boolean },
        outside: boolean,
        upgradeChoice?: 0 | 1,
      ): void;
    }).finishTouchPointer;

    capture.call(scene, { id: 9, x: 1050, y: 180, wasTouch: true }, 0);
    finish.call(scene, { id: 9, x: 1150, y: 180, wasCanceled: false }, false, 1);

    expect(tryUpgrade).not.toHaveBeenCalled();
    expect(scene.touchGesture).toEqual({ kind: 'idle' });
    expect(scene.touchIntent).toBeNull();
  });
});
