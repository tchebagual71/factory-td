import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameState, WaveTally } from '../state/GameState';
import { GameScene } from './GameScene';
import { UIScene } from './UIScene';
import { OverlayScheduler } from './overlayScheduler';

const tally = (): WaveTally => ({ kills: 0, leaked: 0, income: 0, fired: {}, produced: {}, delivered: {}, toLab: {}, magStart: 0, magEnd: 0, starved: 0 });

class InputEmitter {
  private handlers = new Map<string, ((...args: unknown[]) => void)[]>();

  on(event: string, handler: (...args: unknown[]) => void): this {
    const handlers = this.handlers.get(event) ?? [];
    handlers.push(handler);
    this.handlers.set(event, handlers);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) handler(...args);
  }
}

class InteractiveFrame extends InputEmitter {
  setOrigin(): this { return this; }
  setStrokeStyle(): this { return this; }
  setInteractive(): this { return this; }
  setFillStyle(): this { return this; }
}

class ButtonLabel {
  setOrigin(): this { return this; }
}

afterEach(() => {
  vi.restoreAllMocks();
  GameState.events
    .off('missioncomplete')
    .off('inspector')
    .off('boardoverlay')
    .off('boardoverlayrequest')
    .off('ui:touchdown')
    .off('ui:touchup')
    .off('ui:touchupoutside');
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
      activeTouchPointers: new Set([1]),
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
      activeTouchPointers: new Set([1]),
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
    const tower = { type: 'tower', x: 4, y: 5, mk: 2, path: null };
    const scene = Object.assign(Object.create(GameScene.prototype), {
      touchGesture: { kind: 'idle' as const },
      touchIntent: null,
      touchDeliveries: new WeakMap<object, Set<string>>(),
      activeTouchPointers: new Set<number>(),
      input: { manager: { pointers: [{ id: 7, isDown: true, y: 180 }] } },
      pendingTap: null,
      sellDown: null,
      dragPan: null,
      pinch: null,
      selTower: tower,
      towerSelectionVersion: 3,
      grid: { cellAt: () => ({ building: tower }) },
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
    expect(scene.touchIntent).toEqual({
      kind: 'upgrade',
      choice: 1,
      pointerId: 7,
      target: tower,
      mk: 2,
      path: null,
      selectionVersion: 3,
    });

    finish.call(scene, { id: 8, x: 1100, y: 180, wasCanceled: false }, false, 1);
    expect(tryUpgrade).not.toHaveBeenCalled();
    expect(scene.touchIntent).toMatchObject({ kind: 'upgrade', choice: 1, pointerId: 7, target: tower });

    finish.call(scene, { id: 7, x: 1100, y: 180, wasCanceled: false }, false, 1);
    expect(tryUpgrade).toHaveBeenCalledOnce();
    expect(tryUpgrade).toHaveBeenCalledWith(1);
    expect(scene.touchGesture).toEqual({ kind: 'idle' });
    expect(scene.touchIntent).toBeNull();
  });

  it('cancels a touch upgrade released over the other upgrade button', () => {
    const tryUpgrade = vi.fn();
    const tower = { type: 'tower', x: 4, y: 5, mk: 2, path: null };
    const scene = Object.assign(Object.create(GameScene.prototype), {
      touchGesture: { kind: 'idle' as const },
      touchIntent: null,
      touchDeliveries: new WeakMap<object, Set<string>>(),
      activeTouchPointers: new Set<number>(),
      input: { manager: { pointers: [{ id: 9, isDown: true, y: 180 }] } },
      pendingTap: null,
      sellDown: null,
      dragPan: null,
      pinch: null,
      selTower: tower,
      towerSelectionVersion: 1,
      grid: { cellAt: () => ({ building: tower }) },
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

  const upgradeDrifts: [string, {
    selected?: 'other';
    mk?: number;
    path?: string;
    selectionVersion?: number;
    missing?: boolean;
  }][] = [
    ['selected tower changed', { selected: 'other' }],
    ['tower mark changed', { mk: 3 }],
    ['tower path changed', { path: 'sniper' }],
    ['selection version changed', { selectionVersion: 5 }],
    ['tower disappeared', { missing: true }],
  ];

  it.each(upgradeDrifts)('drops a captured upgrade when the %s before release', (_name, drift) => {
    const tower = { type: 'tower', x: 4, y: 5, mk: 2, path: null as null | string };
    const other = { type: 'tower', x: 6, y: 7, mk: 1, path: null };
    const tryUpgrade = vi.fn();
    const scene = {
      selTower: drift.selected ? other : tower,
      towerSelectionVersion: drift.selectionVersion ?? 4,
      grid: { cellAt: () => (drift.missing ? null : { building: tower }) },
      touchIntent: {
        kind: 'upgrade',
        choice: 0,
        pointerId: 7,
        target: tower,
        mk: 2,
        path: null,
        selectionVersion: 4,
      },
      tryUpgrade,
    };
    if (drift.mk) tower.mk = drift.mk;
    if (drift.path) tower.path = drift.path;

    resolve.call(scene);

    expect(tryUpgrade).not.toHaveBeenCalled();
    expect(scene.touchIntent).toBeNull();
  });

  it('classifies a HUD touch before the shared button action can commit board state', () => {
    const boardPointer = {
      id: 1, x: 96, y: 112, isDown: true, wasTouch: true, wasCanceled: false, event: {},
    };
    const hudPointer = {
      id: 2, x: 400, y: 700, isDown: true, wasTouch: true, wasCanceled: false, event: {},
    };
    const scene = Object.assign(Object.create(GameScene.prototype), {
      touchGesture: { kind: 'idle' as const },
      touchIntent: null,
      touchDeliveries: new WeakMap<object, Set<string>>(),
      activeTouchPointers: new Set<number>(),
      input: { manager: { pointers: [boardPointer, hudPointer] } },
      pendingTap: null,
      sellDown: null,
      dragPan: null,
      pinch: null,
      endStroke: vi.fn(),
      endSweep: vi.fn(),
    });
    const setupGame = (GameScene.prototype as unknown as {
      setupForwardedTouchLifecycle(this: typeof scene): void;
    }).setupForwardedTouchLifecycle;
    const routeDown = (GameScene.prototype as unknown as {
      routeTouchPointerDown(this: typeof scene, p: typeof boardPointer, capture?: () => void): void;
    }).routeTouchPointerDown;
    const frame = new InteractiveFrame();
    const ui = Object.assign(Object.create(UIScene.prototype), {
      hudTouchPointers: new Set<number>(),
      add: {
        rectangle: () => frame,
        text: () => new ButtonLabel(),
      },
    });
    const hudButton = (UIScene.prototype as unknown as {
      hudButton(
        this: typeof ui,
        x: number, y: number, w: number, h: number, text: string, fontSize: number,
        action: () => void,
      ): { frame: InteractiveFrame };
    }).hudButton;
    const commitPending = vi.fn();

    setupGame.call(scene);
    routeDown.call(scene, boardPointer, () => {
      scene.touchIntent = { kind: 'build', tx: 3, ty: 4, type: 'tower' };
    });
    hudButton.call(ui, 0, 0, 48, 48, 'PLACE', 14, () => {
      expect(scene.touchGesture).toEqual({ kind: 'pinch' });
      expect(scene.touchIntent).toBeNull();
      commitPending();
    });

    frame.emit('pointerdown', hudPointer);

    expect(commitPending).toHaveBeenCalledOnce();
  });

  it.each([
    ['ordinary release', false],
    ['canceled release', true],
  ] as const)('forwards an empty-over %s for a previously captured HUD touch', (_name, wasCanceled) => {
    const uiInput = new InputEmitter();
    const ui = Object.assign(Object.create(UIScene.prototype), {
      input: uiInput,
      events: new InputEmitter(),
      hudTouchPointers: new Set<number>(),
    });
    const setupUi = (UIScene.prototype as unknown as {
      setupTouchForwarding(this: typeof ui): void;
    }).setupTouchForwarding;
    const hudPointer = {
      id: 2, x: 400, y: 700, isDown: true, wasTouch: true, wasCanceled: false, event: {},
    };
    const boardPointer = {
      id: 1, x: 96, y: 112, isDown: false, wasTouch: true, wasCanceled: false, event: {},
    };
    const scene = Object.assign(Object.create(GameScene.prototype), {
      touchGesture: { kind: 'idle' as const },
      touchIntent: null,
      touchDeliveries: new WeakMap<object, Set<string>>(),
      activeTouchPointers: new Set<number>(),
      input: { manager: { pointers: [boardPointer, hudPointer] } },
      pendingTap: null,
      sellDown: null,
      dragPan: null,
      pinch: null,
      endStroke: vi.fn(),
      endSweep: vi.fn(),
      overHud: vi.fn(() => false),
    });
    const setupGame = (GameScene.prototype as unknown as {
      setupForwardedTouchLifecycle(this: typeof scene): void;
    }).setupForwardedTouchLifecycle;
    const routeDown = (GameScene.prototype as unknown as {
      routeTouchPointerDown(this: typeof scene, p: typeof boardPointer, capture?: () => void): void;
    }).routeTouchPointerDown;

    setupGame.call(scene);
    setupUi.call(ui);
    uiInput.emit('pointerdown', hudPointer, [{}]);
    expect(scene.touchGesture).toMatchObject({ kind: 'pending-single', owner: 2 });

    hudPointer.isDown = false;
    hudPointer.wasCanceled = wasCanceled;
    hudPointer.event = {};
    uiInput.emit('pointerup', hudPointer, []);

    expect(scene.touchGesture).toEqual({ kind: 'idle' });
    expect(scene.touchIntent).toBeNull();

    boardPointer.isDown = true;
    boardPointer.event = {};
    routeDown.call(scene, boardPointer, () => {
      scene.touchIntent = { kind: 'belt', tx: 8, ty: 9 };
    });
    expect(scene.touchGesture).toMatchObject({ kind: 'pending-single', owner: 1 });
    expect(scene.touchIntent).toEqual({ kind: 'belt', tx: 8, ty: 9 });
  });

  it('clears captured HUD ownership when UIScene sleeps before pointerup', () => {
    const uiInput = new InputEmitter();
    const sceneEvents = new InputEmitter();
    const ui = Object.assign(Object.create(UIScene.prototype), {
      input: uiInput,
      events: sceneEvents,
      hudTouchPointers: new Set<number>(),
    });
    const setupUi = (UIScene.prototype as unknown as {
      setupTouchForwarding(this: typeof ui): void;
    }).setupTouchForwarding;
    const hudPointer = {
      id: 2, x: 400, y: 700, isDown: true, wasTouch: true, wasCanceled: false, event: {},
    };

    setupUi.call(ui);
    uiInput.emit('pointerdown', hudPointer, [{}]);
    expect(ui.hudTouchPointers).toEqual(new Set([2]));

    sceneEvents.emit('sleep');

    expect(ui.hudTouchPointers).toEqual(new Set());
  });

  it('keeps pinch ownership when the board finger releases before a held HUD finger', () => {
    const uiInput = new InputEmitter();
    const ui = Object.assign(Object.create(UIScene.prototype), {
      input: uiInput,
      events: new InputEmitter(),
      hudTouchPointers: new Set<number>(),
    });
    const setupUi = (UIScene.prototype as unknown as {
      setupTouchForwarding(this: typeof ui): void;
    }).setupTouchForwarding;
    const boardPointer = {
      id: 1, x: 96, y: 112, isDown: true, wasTouch: true, wasCanceled: false, event: {},
    };
    const hudPointer = {
      id: 2, x: 400, y: 700, isDown: true, wasTouch: true, wasCanceled: false, event: {},
    };
    const thirdPointer = {
      id: 3, x: 160, y: 128, isDown: false, wasTouch: true, wasCanceled: false, event: {},
    };
    const scene = Object.assign(Object.create(GameScene.prototype), {
      touchGesture: { kind: 'idle' as const },
      touchIntent: null,
      touchDeliveries: new WeakMap<object, Set<string>>(),
      activeTouchPointers: new Set<number>(),
      input: { manager: { pointers: [boardPointer, hudPointer, thirdPointer] } },
      pendingTap: null,
      sellDown: null,
      dragPan: null,
      pinch: null,
      endStroke: vi.fn(),
      endSweep: vi.fn(),
      overHud: vi.fn(() => false),
    });
    const setupGame = (GameScene.prototype as unknown as {
      setupForwardedTouchLifecycle(this: typeof scene): void;
    }).setupForwardedTouchLifecycle;
    const routeDown = (GameScene.prototype as unknown as {
      routeTouchPointerDown(this: typeof scene, p: typeof boardPointer, capture?: () => void): void;
    }).routeTouchPointerDown;
    const finish = (GameScene.prototype as unknown as {
      finishTouchPointer(this: typeof scene, p: typeof boardPointer, outside: boolean): void;
    }).finishTouchPointer;
    const thirdMutation = vi.fn();

    setupGame.call(scene);
    setupUi.call(ui);
    routeDown.call(scene, boardPointer, () => {
      scene.touchIntent = { kind: 'belt', tx: 3, ty: 4 };
    });
    uiInput.emit('pointerdown', hudPointer, [{}]);
    expect(scene.touchGesture).toEqual({ kind: 'pinch' });

    boardPointer.isDown = false;
    boardPointer.event = {};
    finish.call(scene, boardPointer, false);
    expect(scene.touchGesture).toEqual({ kind: 'pinch' });

    thirdPointer.isDown = true;
    thirdPointer.event = {};
    routeDown.call(scene, thirdPointer, thirdMutation);
    expect(thirdMutation).not.toHaveBeenCalled();
    expect(scene.touchGesture).toEqual({ kind: 'pinch' });

    thirdPointer.isDown = false;
    thirdPointer.event = {};
    finish.call(scene, thirdPointer, false);
    expect(scene.touchGesture).toEqual({ kind: 'pinch' });

    hudPointer.isDown = false;
    hudPointer.event = {};
    uiInput.emit('pointerup', hudPointer, []);
    expect(scene.touchGesture).toEqual({ kind: 'idle' });

    thirdPointer.isDown = true;
    thirdPointer.event = {};
    routeDown.call(scene, thirdPointer, thirdMutation);
    routeDown.call(scene, thirdPointer, thirdMutation);
    expect(thirdMutation).toHaveBeenCalledOnce();
    expect(scene.touchGesture).toMatchObject({ kind: 'pending-single', owner: 3 });
  });

  it('counts a non-interactive GameScene HUD touch before a board touch can capture intent', () => {
    const shieldPointer = {
      id: 1, x: 1100, y: 180, isDown: true, wasTouch: true, wasCanceled: false, event: {},
    };
    const boardPointer = {
      id: 2, x: 96, y: 112, isDown: true, wasTouch: true, wasCanceled: false, event: {},
    };
    const freshPointer = {
      id: 3, x: 128, y: 144, isDown: false, wasTouch: true, wasCanceled: false, event: {},
    };
    const captureTouchIntent = vi.fn();
    const scene = Object.assign(Object.create(GameScene.prototype), {
      touchGesture: { kind: 'idle' as const },
      touchIntent: null,
      touchDeliveries: new WeakMap<object, Set<string>>(),
      activeTouchPointers: new Set<number>(),
      input: { manager: { pointers: [shieldPointer, boardPointer, freshPointer] } },
      pendingTap: null,
      sellDown: null,
      dragPan: null,
      pinch: null,
      captureTouchIntent,
      endStroke: vi.fn(),
      endSweep: vi.fn(),
      overHud: vi.fn((x: number) => x >= 1000),
    });
    const handleDown = (GameScene.prototype as unknown as {
      handleTouchPointerDown(this: typeof scene, p: typeof shieldPointer): boolean;
    }).handleTouchPointerDown;
    const finish = (GameScene.prototype as unknown as {
      finishTouchPointer(this: typeof scene, p: typeof shieldPointer, outside: boolean): void;
    }).finishTouchPointer;

    expect(handleDown.call(scene, shieldPointer)).toBe(true);
    expect(scene.touchGesture).toMatchObject({ kind: 'pending-single', owner: 1 });
    expect(captureTouchIntent).not.toHaveBeenCalled();

    expect(handleDown.call(scene, boardPointer)).toBe(true);
    expect(scene.touchGesture).toEqual({ kind: 'pinch' });
    expect(scene.touchIntent).toBeNull();
    expect(captureTouchIntent).not.toHaveBeenCalled();

    boardPointer.isDown = false;
    boardPointer.event = {};
    finish.call(scene, boardPointer, false);
    expect(scene.touchGesture).toEqual({ kind: 'pinch' });
    expect(captureTouchIntent).not.toHaveBeenCalled();

    shieldPointer.isDown = false;
    shieldPointer.event = {};
    finish.call(scene, shieldPointer, false);
    expect(scene.touchGesture).toEqual({ kind: 'idle' });

    freshPointer.isDown = true;
    freshPointer.event = {};
    expect(handleDown.call(scene, freshPointer)).toBe(true);
    expect(scene.touchGesture).toMatchObject({ kind: 'pending-single', owner: 3 });
    expect(captureTouchIntent).toHaveBeenCalledOnce();
    expect(captureTouchIntent).toHaveBeenCalledWith(freshPointer);
  });

  it('forwards HUD-captured touch lifecycle through the top scene without duplicate delivery', () => {
    const uiInput = new InputEmitter();
    const ui = Object.assign(Object.create(UIScene.prototype), {
      input: uiInput,
      events: new InputEmitter(),
      hudTouchPointers: new Set<number>(),
    });
    const setupUi = (UIScene.prototype as unknown as {
      setupTouchForwarding(this: typeof ui): void;
    }).setupTouchForwarding;

    const boardPointer = {
      id: 1,
      identifier: 101,
      x: 96,
      y: 112,
      isDown: true,
      wasTouch: true,
      wasCanceled: false,
      event: {},
    };
    const hudPointer = {
      id: 2,
      identifier: 202,
      x: 400,
      y: 700,
      isDown: true,
      wasTouch: true,
      wasCanceled: false,
      event: {},
    };
    const startStroke = vi.fn();
    const endSweep = vi.fn();
    const scene = Object.assign(Object.create(GameScene.prototype), {
      touchGesture: { kind: 'idle' as const },
      touchIntent: null,
      touchDeliveries: new WeakMap<object, Set<string>>(),
      activeTouchPointers: new Set<number>(),
      input: { manager: { pointers: [boardPointer, hudPointer] } },
      pendingTap: null,
      sellDown: null,
      dragPan: null,
      pinch: null,
      selected: 'belt',
      startStroke,
      endStroke: vi.fn(),
      endSweep,
      overHud: vi.fn(() => false),
    });
    const setupGame = (GameScene.prototype as unknown as {
      setupForwardedTouchLifecycle(this: typeof scene): void;
    }).setupForwardedTouchLifecycle;
    const routeDown = (GameScene.prototype as unknown as {
      routeTouchPointerDown(
        this: typeof scene,
        p: typeof boardPointer,
        capture?: () => void,
      ): void;
    }).routeTouchPointerDown;
    const finish = (GameScene.prototype as unknown as {
      finishTouchPointer(
        this: typeof scene,
        p: typeof boardPointer,
        outside: boolean,
      ): void;
    }).finishTouchPointer;

    const hudAction = vi.fn();
    uiInput.on('pointerdown', hudAction);
    setupGame.call(scene);
    setupUi.call(ui);

    routeDown.call(scene, boardPointer, () => {
      scene.touchIntent = { kind: 'belt', tx: 3, ty: 4 };
    });
    expect(scene.touchGesture).toMatchObject({ kind: 'pending-single', owner: 1 });
    expect(scene.touchIntent).toEqual({ kind: 'belt', tx: 3, ty: 4 });

    uiInput.emit('pointerdown', hudPointer, [{}]);

    expect(hudAction).toHaveBeenCalledOnce();
    expect(startStroke).not.toHaveBeenCalled();
    expect(scene.touchGesture).toEqual({ kind: 'pinch' });
    expect(scene.touchIntent).toBeNull();

    hudPointer.isDown = false;
    hudPointer.event = {};
    uiInput.emit('pointerup', hudPointer, [{}]);
    expect(scene.touchGesture).toEqual({ kind: 'pinch' });

    boardPointer.isDown = false;
    boardPointer.wasCanceled = true;
    boardPointer.event = {};
    uiInput.emit('pointerup', boardPointer, [{}]);

    expect(scene.touchGesture).toEqual({ kind: 'idle' });
    expect(scene.touchIntent).toBeNull();
    expect(endSweep).toHaveBeenCalledOnce();

    finish.call(scene, boardPointer, false);
    expect(endSweep).toHaveBeenCalledOnce();

    boardPointer.isDown = true;
    boardPointer.wasCanceled = false;
    boardPointer.event = {};
    routeDown.call(scene, boardPointer, () => {
      scene.touchIntent = { kind: 'belt', tx: 8, ty: 9 };
    });

    expect(scene.touchGesture).toMatchObject({ kind: 'pending-single', owner: 1 });
    expect(scene.touchIntent).toEqual({ kind: 'belt', tx: 8, ty: 9 });
  });
});
