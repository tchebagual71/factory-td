# Runtime Integrity Hotfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the recursive screenshake crash, save/resume economy exploits, in-frame terminal/freeze leakage, and touch-before-pinch board mutations found by the professional audit.

**Architecture:** Preserve `GameScene` as the orchestrator while extracting two small Phaser-independent seams: `simulationStep.ts` owns ordered system stepping with barrier checks, and `touchGesture.ts` owns pointer-count/movement state transitions. Extend the existing version-2 JSON save additively and keep all legacy saves valid.

**Tech Stack:** TypeScript 5.9, Phaser 3.90, Vitest 4.1, Vite 7.3.

## Global Constraints

- Do not change balance values, maps, recipes, fixed-path behavior, or the documented system order.
- Saves remain build-phase checkpoints; do not serialize enemies or projectiles.
- Keep `SAVE_VERSION = 2`; `buildElapsed` is optional for legacy compatibility.
- Historical missing tower `ammo` means zero because previous captures omitted only zero values.
- Mouse and keyboard behavior remains immediate.
- Touch must perform no purchase, sale, survey, staging, or rotation before the gesture is classified as one-finger input.
- Every production change requires a failing regression test first.
- Do not add runtime dependencies.

---

## File map

- Modify `src/scenes/GameScene.ts`: camera delegation, simulation-step integration, and touch-intent integration.
- Modify `src/scenes/GameScene.test.ts`: screenshake policy tests.
- Modify `src/state/serialize.ts`: explicit tower ammo and bounded `buildElapsed` persistence/validation.
- Modify `src/state/serialize.test.ts`: zero-ammo and elapsed-clock round trips plus hostile-input rejection.
- Modify `src/state/GameState.ts`: restore `buildElapsed` from snapshots.
- Modify `src/state/GameState.test.ts`: snapshot restoration behavior.
- Create `src/systems/simulationStep.ts`: named ordered system updates with barrier checks.
- Create `src/systems/simulationStep.test.ts`: order and halt tests.
- Modify `src/systems/WaveSystem.ts`: abort the current enemy loop after lethal leak.
- Create `src/systems/WaveSystem.terminal.test.ts`: lethal-leak same-system regression.
- Create `src/scenes/touchGesture.ts`: pure touch state machine.
- Create `src/scenes/touchGesture.test.ts`: complete transition contract.
- Modify `src/scenes/sceneLifecycle.integration.test.ts`: touch intent integration tests at the `GameScene` seam where practical.

---

### Task 1: Repair the screenshake policy seam

**Files:**
- Modify: `src/scenes/GameScene.test.ts`
- Modify: `src/scenes/GameScene.ts:660-663`

**Interfaces:**
- Consumes: `reducedFx()` and `setReducedFx(on: boolean)` from `src/utils/feel.ts`.
- Produces: `GameScene.shake(duration: number, intensity: number): void` that delegates exactly once or no-ops.

- [ ] **Step 1: Write failing delegation and reduced-effects tests**

Add the preference import and a new describe block:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setReducedFx } from '../utils/feel';

describe('GameScene screenshake policy', () => {
  afterEach(() => setReducedFx(false));

  it('delegates once to the main camera when effects are enabled', () => {
    setReducedFx(false);
    const cameraShake = vi.fn();
    const scene = { cameras: { main: { shake: cameraShake } } };

    GameScene.prototype.shake.call(scene as never, 180, 0.006);

    expect(cameraShake).toHaveBeenCalledOnce();
    expect(cameraShake).toHaveBeenCalledWith(180, 0.006);
  });

  it('does not touch the camera when reduced effects are enabled', () => {
    setReducedFx(true);
    const cameraShake = vi.fn();
    const scene = { cameras: { main: { shake: cameraShake } } };

    GameScene.prototype.shake.call(scene as never, 180, 0.006);

    expect(cameraShake).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the targeted test and confirm RED**

Run: `npx vitest run src/scenes/GameScene.test.ts`

Expected: the enabled-effects test fails with `RangeError: Maximum call stack size exceeded`; the failure is caused by `GameScene.shake` recursively calling itself.

- [ ] **Step 3: Implement the minimal delegation fix**

Replace the recursive call:

```ts
shake(duration: number, intensity: number): void {
  if (reducedFx()) return;
  this.cameras.main.shake(duration, intensity);
}
```

- [ ] **Step 4: Run the targeted test and confirm GREEN**

Run: `npx vitest run src/scenes/GameScene.test.ts`

Expected: all `GameScene.test.ts` tests pass with no warnings.

- [ ] **Step 5: Commit the isolated fix**

```powershell
git add src/scenes/GameScene.ts src/scenes/GameScene.test.ts
git commit -m "fix: delegate screenshake to the camera"
```

---

### Task 2: Preserve tower ammo and early-send decay across resume

**Files:**
- Modify: `src/state/serialize.test.ts`
- Modify: `src/state/serialize.ts`
- Modify: `src/state/GameState.test.ts`
- Modify: `src/state/GameState.ts`
- Modify: `src/scenes/GameScene.test.ts`
- Modify: `src/scenes/GameScene.ts`

**Interfaces:**
- Consumes: `EARLY_SEND_WINDOW` and `earlySendBonus` from `src/data/waves.ts`; `isTower(type)` from `src/data/buildings.ts`.
- Produces: optional `SaveV1.buildElapsed`, optional `Snapshot.buildElapsed`, explicit `SavedBuilding.ammo` for every tower, and snapshot restore equivalence.

- [ ] **Step 1: Write failing serialization tests for zero ammo and elapsed time**

In `serialize.test.ts`, import `EARLY_SEND_WINDOW` and add:

```ts
it('writes an empty tower magazine explicitly while non-towers omit ammo', () => {
  const tower = towerAt(7, 5);
  tower.ammo = 0;
  const press = makeBuilding('press', 8, 5);

  const save = captureRun([tower, press], [], SNAPSHOT);

  expect(save.buildings[0]).toHaveProperty('ammo', 0);
  expect(save.buildings[1]).not.toHaveProperty('ammo');
});

it('clamps the saved build clock to the early-send window', () => {
  expect(captureRun([], [], { ...SNAPSHOT, buildElapsed: 7.5 }).buildElapsed).toBe(7.5);
  expect(captureRun([], [], { ...SNAPSHOT, buildElapsed: EARLY_SEND_WINDOW * 4 }).buildElapsed)
    .toBe(EARLY_SEND_WINDOW);
});

it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, EARLY_SEND_WINDOW + 0.001])(
  'rejects invalid buildElapsed %s',
  (buildElapsed) => {
    const raw = { ...captureRun([], [], SNAPSHOT), buildElapsed };
    expect(validateSave(raw)).toBeNull();
  },
);
```

- [ ] **Step 2: Run serialization tests and confirm RED**

Run: `npx vitest run src/state/serialize.test.ts`

Expected: zero ammo is absent, `buildElapsed` is missing, and invalid elapsed values are accepted.

- [ ] **Step 3: Implement additive capture and validation**

In `serialize.ts`:

```ts
import { EARLY_SEND_WINDOW } from '../data/waves';

export interface SaveV1 {
  // existing fields...
  buildElapsed?: number;
}

interface Snapshot {
  // existing fields...
  buildElapsed?: number;
}

// inside captureRun
buildElapsed: Math.min(EARLY_SEND_WINDOW, Math.max(0, gs.buildElapsed ?? 0)),

// inside captureBuilding
if (isTower(b.type)) sb.ammo = b.ammo;

// inside validateSave, before returning
if (
  s.buildElapsed !== undefined &&
  (!isFiniteNum(s.buildElapsed) || s.buildElapsed < 0 || s.buildElapsed > EARLY_SEND_WINDOW)
) return null;
```

Remove the old `if (b.ammo > 0) sb.ammo = b.ammo;` branch so tower ammo is written exactly once.

- [ ] **Step 4: Run serialization tests and confirm GREEN**

Run: `npx vitest run src/state/serialize.test.ts`

Expected: all serialization and migration tests pass.

- [ ] **Step 5: Write failing state and building restore-equivalence tests**

In `GameState.test.ts`, add:

```ts
it('restores buildElapsed from a save snapshot', () => {
  GameState.applySnapshot({
    money: 10,
    lives: 3,
    wave: 4,
    speed: 1,
    auto: false,
    buildElapsed: 18,
  });
  expect(GameState.buildElapsed).toBe(18);
});

it('defaults a legacy snapshot build clock to zero', () => {
  GameState.buildElapsed = 18;
  GameState.applySnapshot({ money: 10, lives: 3, wave: 4, speed: 1, auto: false });
  expect(GameState.buildElapsed).toBe(0);
});
```

In `GameScene.test.ts`, import `makeBuilding` and exercise the real private restore seam with a fresh building for each case:

```ts
import { makeBuilding } from '../test/helpers';

it.each([
  { saved: undefined, expected: 0 },
  { saved: 7, expected: 7 },
])('restores tower ammo $saved as $expected', ({ saved, expected }) => {
  const tower = makeBuilding('tower', 3, 3);
  tower.ammo = 12; // proves absent legacy ammo cannot retain placement preload
  const scene = {
    grid: { canRestore: () => true },
    placeBuilding: () => tower,
    paintSorterFilter: vi.fn(),
    addMkPip: vi.fn(),
  };
  const restore = (GameScene.prototype as unknown as {
    restoreBuilding(this: typeof scene, saved: Record<string, unknown>): typeof tower | null;
  }).restoreBuilding;
  const savedBuilding = { t: 'tower', x: 3, y: 3, d: 0, inv: 90 } as Record<string, unknown>;
  if (saved !== undefined) savedBuilding.ammo = saved;

  expect(restore.call(scene, savedBuilding)?.ammo).toBe(expected);
});
```

- [ ] **Step 6: Run both restore tests and confirm RED**

Run: `npx vitest run src/state/GameState.test.ts src/scenes/GameScene.test.ts`

Expected: the clock test fails because `applySnapshot` always assigns zero, and the absent-ammo case fails because placement preload remains 12.

- [ ] **Step 7: Restore the clock and legacy empty magazines**

Extend `GameState.applySnapshot`'s argument and assignment:

```ts
buildElapsed?: number;
// ...
this.buildElapsed = s.buildElapsed ?? 0;
```

In `GameScene.restoreBuilding`, replace the conditional assignment with tower-aware legacy semantics:

```ts
if (isTower(sb.t)) b.ammo = sb.ammo ?? 0;
```

- [ ] **Step 8: Add a save-to-bonus equivalence assertion and run both suites**

In `serialize.test.ts`, import `earlySendBonus` and add:

```ts
it('preserves the early-send entitlement through JSON validation', () => {
  const before = earlySendBonus(SNAPSHOT.wave, 12.5);
  const save = captureRun([], [], { ...SNAPSHOT, buildElapsed: 12.5 });
  const back = validateSave(JSON.parse(JSON.stringify(save)))!;
  expect(earlySendBonus(back.wave, back.buildElapsed ?? 0)).toBe(before);
});
```

Run: `npx vitest run src/state/serialize.test.ts src/state/GameState.test.ts src/scenes/GameScene.test.ts`

Expected: both files pass.

- [ ] **Step 9: Commit save/resume semantics**

```powershell
git add src/state/serialize.ts src/state/serialize.test.ts src/state/GameState.ts src/state/GameState.test.ts src/scenes/GameScene.ts src/scenes/GameScene.test.ts
git commit -m "fix: preserve runtime economy across saves"
```

---

### Task 3: Make terminal and freeze transitions hard frame barriers

**Files:**
- Create: `src/systems/simulationStep.ts`
- Create: `src/systems/simulationStep.test.ts`
- Modify: `src/scenes/GameScene.ts`
- Modify: `src/systems/WaveSystem.ts`
- Create: `src/systems/WaveSystem.terminal.test.ts`

**Interfaces:**
- Produces: `SimulationSystems`, `SimulationHalt`, and `stepSimulation(systems, dt, halted): void`.
- Consumes: the existing five system `update(dt: number)` methods and `GameState.gameOver`/`GameState.frozen`.

- [ ] **Step 1: Write failing ordered-barrier tests against the wished-for seam**

Create `simulationStep.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { stepSimulation } from './simulationStep';

function harness(stopAfter?: string) {
  const calls: string[] = [];
  let halted = false;
  const update = (name: string) => () => {
    calls.push(name);
    if (name === stopAfter) halted = true;
  };
  return {
    calls,
    systems: {
      wave: { update: update('wave') },
      conveyor: { update: update('conveyor') },
      production: { update: update('production') },
      combat: { update: update('combat') },
      logistics: { update: update('logistics') },
    },
    halted: () => halted,
  };
}

describe('stepSimulation', () => {
  it('runs every system in the documented order on a live frame', () => {
    const h = harness();
    stepSimulation(h.systems, 0.05, h.halted);
    expect(h.calls).toEqual(['wave', 'conveyor', 'production', 'combat', 'logistics']);
  });

  it.each(['wave', 'conveyor', 'production', 'combat'])(
    'stops after %s makes the frame terminal or frozen',
    (name) => {
      const h = harness(name);
      stepSimulation(h.systems, 0.05, h.halted);
      expect(h.calls.at(-1)).toBe(name);
    },
  );
});
```

- [ ] **Step 2: Run the new test and confirm RED**

Run: `npx vitest run src/systems/simulationStep.test.ts`

Expected: module-not-found failure because the seam does not exist yet.

- [ ] **Step 3: Implement the ordered stepper**

Create `simulationStep.ts`:

```ts
export interface UpdatableSystem {
  update(dt: number): void;
}

export interface SimulationSystems {
  wave: UpdatableSystem;
  conveyor: UpdatableSystem;
  production: UpdatableSystem;
  combat: UpdatableSystem;
  logistics: UpdatableSystem;
}

export type SimulationHalt = () => boolean;

export function stepSimulation(s: SimulationSystems, dt: number, halted: SimulationHalt): void {
  s.wave.update(dt);
  if (halted()) return;
  s.conveyor.update(dt);
  if (halted()) return;
  s.production.update(dt);
  if (halted()) return;
  s.combat.update(dt);
  if (halted()) return;
  s.logistics.update(dt);
}
```

- [ ] **Step 4: Run the stepper test and confirm GREEN**

Run: `npx vitest run src/systems/simulationStep.test.ts`

Expected: all order/barrier cases pass.

- [ ] **Step 5: Integrate the stepper into `GameScene.update`**

Import `stepSimulation` and replace the five direct calls with:

```ts
// Field, initialized once after the five systems are constructed in create().
private simulation!: SimulationSystems;

this.simulation = {
  wave: this.waveSystem,
  conveyor: this.conveyor,
  production: this.production,
  combat: this.combat,
  logistics: this.logistics,
};

// update(): reuse the object; do not allocate a system bundle every frame.
stepSimulation(
  this.simulation,
  dt,
  () => GameState.gameOver || GameState.frozen,
);
if (GameState.gameOver || GameState.frozen) {
  if (!GameState.gameOver) this.updateGhost();
  this.iso?.render(this);
  return;
}
```

Move the existing build-phase save-debounce block from before the simulation step to immediately after this barrier return. It still subtracts real `deltaMs`, but a lab delivery that freezes the frame can no longer save or advance the debounce after the modal opens. This preserves the existing system order and prevents post-barrier terrain, panel, and save-timer work.

- [ ] **Step 6: Write the lethal-leak same-loop regression**

Create `WaveSystem.terminal.test.ts` using the existing `makeScene`/`makeSprite` helpers. Build two live enemies positioned after their last waypoint, set `GameState.lives = 1`, call `wave.start()`, append both enemies, and call `wave.update(0.01)`. Assert:

```ts
expect(GameState.gameOver).toBe(true);
expect(GameState.tally.leaked).toBe(1);
expect(second.dead).toBe(false);
expect((second.sprite as unknown as MockSprite).destroyed).toBe(false);
```

Use a local `makeEnemy` matching the complete `Enemy` interface from `WaveSystem.slow.test.ts`; set `wp` to `pathPx().length - 1` so the next target is absent.

- [ ] **Step 7: Run the terminal test and confirm RED**

Run: `npx vitest run src/systems/WaveSystem.terminal.test.ts`

Expected: `GameState.tally.leaked` is 2 and the second enemy is destroyed because the loop continues after game over.

- [ ] **Step 8: Abort WaveSystem immediately after a lethal leak**

Immediately after `move` returns inside the enemy loop, stop on the terminal state:

```ts
this.move(e, dt);
if (GameState.gameOver) break;
```

Keep `move`'s existing signature and the existing reap pass so the triggering leaked enemy is removed normally; do not process another enemy after the break.

- [ ] **Step 9: Run transition tests and the affected system tests**

Run: `npx vitest run src/systems/simulationStep.test.ts src/systems/WaveSystem.terminal.test.ts src/systems/WaveSystem.slow.test.ts src/systems/waveClear.test.ts`

Expected: all tests pass.

- [ ] **Step 10: Commit simulation barriers**

```powershell
git add src/systems/simulationStep.ts src/systems/simulationStep.test.ts src/systems/WaveSystem.ts src/systems/WaveSystem.terminal.test.ts src/scenes/GameScene.ts
git commit -m "fix: stop simulation at terminal transitions"
```

---

### Task 4: Define the pure touch-gesture classifier

**Files:**
- Create: `src/scenes/touchGesture.ts`
- Create: `src/scenes/touchGesture.test.ts`

**Interfaces:**
- Produces: `TouchGesture`, `TouchTransition`, `idleTouchGesture()`, `touchDown()`, `touchMove()`, and `touchUp()`.
- Consumes: pointer id/position, current count of down board pointers, and the caller's movement threshold.

- [ ] **Step 1: Write the state-machine contract first**

Create `touchGesture.test.ts` with separate tests for:

```ts
const idle = idleTouchGesture();
const first = touchDown(idle, { id: 1, x: 40, y: 50 }, 1);
expect(first).toMatchObject({ state: { kind: 'pending-single' }, cancelBoard: false });

const tap = touchUp(first.state, 1, 0);
expect(tap).toMatchObject({ state: { kind: 'idle' }, tap: true });

const drag = touchMove(first.state, { id: 1, x: 60, y: 50 }, 1, 12);
expect(drag).toMatchObject({ state: { kind: 'single-drag' }, beginDrag: true });

const pinch = touchDown(first.state, { id: 2, x: 80, y: 50 }, 2);
expect(pinch).toMatchObject({ state: { kind: 'pinch' }, cancelBoard: true });

const stillPinching = touchUp(pinch.state, 2, 1);
expect(stillPinching.state.kind).toBe('pinch');
expect(touchUp(stillPinching.state, 1, 0).state.kind).toBe('idle');
```

Also assert that a non-owner move cannot begin a drag and that once `pinch` starts no later release emits `tap`.

- [ ] **Step 2: Run the classifier test and confirm RED**

Run: `npx vitest run src/scenes/touchGesture.test.ts`

Expected: module-not-found failure.

- [ ] **Step 3: Implement immutable transitions**

Create `touchGesture.ts`:

```ts
export interface TouchPoint { id: number; x: number; y: number }

export type TouchGesture =
  | { kind: 'idle' }
  | { kind: 'pending-single'; owner: number; x: number; y: number }
  | { kind: 'single-drag'; owner: number }
  | { kind: 'pinch' };

export interface TouchTransition {
  state: TouchGesture;
  cancelBoard: boolean;
  beginDrag: boolean;
  tap: boolean;
}

const result = (
  state: TouchGesture,
  overrides: Partial<Omit<TouchTransition, 'state'>> = {},
): TouchTransition => ({ state, cancelBoard: false, beginDrag: false, tap: false, ...overrides });

export const idleTouchGesture = (): TouchGesture => ({ kind: 'idle' });

export function touchDown(state: TouchGesture, point: TouchPoint, down: number): TouchTransition {
  if (down >= 2 || state.kind !== 'idle') return result({ kind: 'pinch' }, { cancelBoard: true });
  return result({ kind: 'pending-single', owner: point.id, x: point.x, y: point.y });
}

export function touchMove(
  state: TouchGesture,
  point: TouchPoint,
  down: number,
  slop: number,
): TouchTransition {
  if (down >= 2) return result({ kind: 'pinch' }, { cancelBoard: state.kind !== 'pinch' });
  if (state.kind !== 'pending-single' || state.owner !== point.id) return result(state);
  if (Math.hypot(point.x - state.x, point.y - state.y) <= slop) return result(state);
  return result({ kind: 'single-drag', owner: point.id }, { beginDrag: true });
}

export function touchUp(state: TouchGesture, pointerId: number, down: number): TouchTransition {
  if (state.kind === 'pinch') return result(down === 0 ? idleTouchGesture() : state);
  if (state.kind === 'pending-single' && state.owner === pointerId) {
    return result(idleTouchGesture(), { tap: true });
  }
  if (state.kind === 'single-drag' && state.owner === pointerId) return result(idleTouchGesture());
  return result(state);
}
```

- [ ] **Step 4: Run the classifier tests and confirm GREEN**

Run: `npx vitest run src/scenes/touchGesture.test.ts`

Expected: every state transition passes.

- [ ] **Step 5: Commit the pure classifier**

```powershell
git add src/scenes/touchGesture.ts src/scenes/touchGesture.test.ts
git commit -m "feat: classify touch gestures before board input"
```

---

### Task 5: Integrate classified touch intents into GameScene

**Files:**
- Modify: `src/scenes/GameScene.ts`
- Modify: `src/scenes/sceneLifecycle.integration.test.ts`

**Interfaces:**
- Consumes: Task 4's touch state and transition functions.
- Produces: private `TouchIntent` capture/dispatch helpers and a `cancelTouchBoardAction()` cleanup seam.

- [ ] **Step 1: Add failing integration tests for cancellation and tap dispatch**

Extend `sceneLifecycle.integration.test.ts` by invoking the new private helpers through a narrow structural cast. Use spies for `startStroke`, `paintBeltTo`, `stagePending`, `commitPending`, and `requestSell`. Cover these behaviors independently:

```ts
it('cancels a pending touch intent without mutating the board', () => {
  const endStroke = vi.fn();
  const scene = {
    touchIntent: { kind: 'belt', tx: 3, ty: 4 },
    pendingTap: { tx: 3, ty: 4 },
    sellDown: { tx: 3, ty: 4, right: false },
    endStroke,
  };
  const cancel = (GameScene.prototype as unknown as {
    cancelTouchBoardAction(this: typeof scene): void;
  }).cancelTouchBoardAction;

  cancel.call(scene);

  expect(scene.touchIntent).toBeNull();
  expect(scene.pendingTap).toBeNull();
  expect(scene.sellDown).toBeNull();
  expect(endStroke).toHaveBeenCalledOnce();
});
```

Add concrete dispatch tests using the same structural-cast pattern:

```ts
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
```

- [ ] **Step 2: Run the integration test and confirm RED**

Run: `npx vitest run src/scenes/sceneLifecycle.integration.test.ts`

Expected: the new private helpers do not exist.

- [ ] **Step 3: Add touch state and intent types to GameScene**

Import Task 4's functions and define:

```ts
type TouchIntent =
  | { kind: 'belt'; tx: number; ty: number }
  | { kind: 'build'; tx: number; ty: number; type: BuildingType }
  | { kind: 'survey'; tx: number; ty: number }
  | { kind: 'sell'; tx: number; ty: number }
  | { kind: 'inspect'; tx: number; ty: number };

private touchGesture: TouchGesture = idleTouchGesture();
private touchIntent: TouchIntent | null = null;
```

Reset both fields in `create()` alongside the existing gesture fields.

- [ ] **Step 4: Implement cancellation and tap dispatch helpers**

Add:

```ts
private cancelTouchBoardAction(): void {
  this.touchIntent = null;
  this.pendingTap = null;
  this.sellDown = null;
  this.dragPan = null;
  this.endStroke();
}

private resolveTouchTap(): void {
  const intent = this.touchIntent;
  this.touchIntent = null;
  if (!intent) return;
  if (intent.kind === 'belt') {
    if (this.selected !== 'belt') return;
    this.startStroke(intent.tx, intent.ty);
    this.endStroke();
  } else if (intent.kind === 'build') {
    if (this.selected !== intent.type) return;
    if (this.pending?.kind === 'build' && this.pending.tx === intent.tx && this.pending.ty === intent.ty) this.commitPending();
    else this.stagePending(intent.tx, intent.ty);
  } else if (intent.kind === 'survey') {
    if (!this.surveyMode) return;
    if (this.pending?.kind === 'survey' && this.pending.tx === intent.tx && this.pending.ty === intent.ty) this.commitPending();
    else this.stagePending(intent.tx, intent.ty, false, 'survey');
  } else if (intent.kind === 'sell') {
    if (!this.sellMode) return;
    const b = this.grid.cellAt(intent.tx, intent.ty)?.building;
    if (b) {
      this.beginSaleGroup();
      this.requestSell(b);
    }
  } else {
    this.resolveInspectTap(intent.tx, intent.ty, this.time.now - this.pressAt);
  }
}
```

Extract the existing inspect-tap block into `resolveInspectTap(tx, ty, heldMs)`. It first performs the existing `heldMs >= LONG_PRESS_MS` sale path, then the existing sorter/rotation/tower-panel short-tap path, so mouse and touch share exactly one behavior.

```ts
private resolveInspectTap(tx: number, ty: number, heldMs: number): void {
  const b = this.grid.cellAt(tx, ty)?.building;
  if (heldMs >= LONG_PRESS_MS) {
    if (b) {
      this.beginSaleGroup();
      this.requestSell(b);
    }
    return;
  }
  if (b?.type === 'sorter') this.cycleSorterFilter(b);
  else if (b && !isTower(b.type)) this.rotateBuilding(b);
  else this.selectTower(b ?? null);
}
```

Replace the corresponding mouse `pointerup` block with `this.resolveInspectTap(tap.tx, tap.ty, held)` after its existing movement/selection/HUD guards.

- [ ] **Step 5: Gate touch pointer-down before existing board branches**

At the start of the scene-level board `pointerdown` handler, after HUD rejection and before board mutation:

```ts
if (IS_TOUCH && p.wasTouch) {
  const down = this.boardPointersDown();
  const transition = touchDown(this.touchGesture, { id: p.id, x: p.x, y: p.y }, down);
  this.touchGesture = transition.state;
  if (transition.cancelBoard) {
    this.cancelTouchBoardAction();
    return;
  }
  this.captureTouchIntent(p);
  return;
}
```

`boardPointersDown(excludeId?: number)` counts `this.input.manager.pointers` where `isDown && y < PLAYFIELD_H && id !== excludeId`. `captureTouchIntent(p)` records timing/position and stores the appropriate intent based on `surveyMode`, `sellMode`, `selected`, or inspect mode without invoking any placement/sale/staging method. A build intent snapshots `this.selected` as `type`; release cancels if the selection changed while the finger was down.

Implement the capture helper exactly as the non-mutating half of the current handler:

```ts
private captureTouchIntent(p: Phaser.Input.Pointer): void {
  this.pressAt = this.time.now;
  this.pressX = p.x;
  this.pressY = p.y;
  this.pendingTap = null;
  this.dragPan = null;
  const { tx, ty } = this.tileAt(p.x, p.y);
  this.touchIntent = this.surveyMode
    ? { kind: 'survey', tx, ty }
    : this.sellMode
      ? { kind: 'sell', tx, ty }
      : this.selected === 'belt'
        ? { kind: 'belt', tx, ty }
        : this.selected
          ? { kind: 'build', tx, ty, type: this.selected }
          : { kind: 'inspect', tx, ty };
}
```

Because all real touch events return before the old board branches, simplify those remaining branches to mouse semantics: survey calls `placeSurvey(tx, ty)` immediately and a selected non-belt calls `tryPlace(this.selected, tx, ty, false)` immediately. This restores immediate mouse behavior on touch-capable laptops while preserving the new deferred path for `p.wasTouch`.

- [ ] **Step 6: Gate touch movement and begin only classified drags**

Before existing pointer-move board actions:

```ts
if (IS_TOUCH && p.wasTouch) {
  const down = this.boardPointersDown();
  const transition = touchMove(this.touchGesture, { id: p.id, x: p.x, y: p.y }, down, PAN_SLOP);
  this.touchGesture = transition.state;
  if (transition.cancelBoard) this.cancelTouchBoardAction();
  if (this.touchGesture.kind === 'pinch') {
    this.updateGesture();
    return;
  }
  if (transition.beginDrag) this.beginTouchDrag(p);
  else if (this.touchGesture.kind === 'single-drag') this.continueTouchDrag(p);
  return;
}
```

`beginTouchDrag` dispatches by intent:

- belt: `startStroke(origin)` then `paintBeltTo(current)`;
- sell: `beginSweep()`, `beginSaleGroup()`, `sweepSell(origin)`, then current;
- inspect: initialize `dragPan` and pan only on later movement;
- build/survey: stage at the origin, then move the staged ghost using the existing pending-drag code.

`continueTouchDrag` reuses existing belt, sell, pan, and staged-drag operations. No purchase or sale occurs before `beginDrag` is true.

Implement those dispatchers without duplicating placement rules:

```ts
private beginTouchDrag(p: Phaser.Input.Pointer): void {
  const intent = this.touchIntent;
  if (!intent) return;
  const current = this.tileAt(p.x, p.y);
  if (intent.kind === 'belt' && this.selected === 'belt') {
    this.startStroke(intent.tx, intent.ty);
    this.paintBeltTo(current.tx, current.ty);
  } else if (intent.kind === 'sell' && this.sellMode) {
    this.beginSweep();
    this.beginSaleGroup();
    this.sweepSell(intent.tx, intent.ty);
    this.sweepSell(current.tx, current.ty);
  } else if (intent.kind === 'inspect') {
    this.dragPan = { x: p.x, y: p.y };
  } else if (intent.kind === 'survey' && this.surveyMode) {
    this.stagePending(intent.tx, intent.ty, true, 'survey');
    this.stagePending(current.tx, current.ty, true, 'survey');
  } else if (intent.kind === 'build' && this.selected === intent.type) {
    this.stagePending(intent.tx, intent.ty, true, 'build');
    this.stagePending(current.tx, current.ty, true, 'build');
  }
}

private continueTouchDrag(p: Phaser.Input.Pointer): void {
  const intent = this.touchIntent;
  if (!intent || p.y >= PLAYFIELD_H) return;
  const current = this.tileAt(p.x, p.y);
  if (intent.kind === 'belt' && this.selected === 'belt') this.paintBeltTo(current.tx, current.ty);
  else if (intent.kind === 'sell' && this.sellMode) this.sweepSell(current.tx, current.ty);
  else if (intent.kind === 'inspect' && this.dragPan) {
    this.panScreen(p.x - this.dragPan.x, p.y - this.dragPan.y);
    this.dragPan = { x: p.x, y: p.y };
  } else if (intent.kind === 'survey' && this.surveyMode) {
    this.stagePending(current.tx, current.ty, true, 'survey');
  } else if (intent.kind === 'build' && this.selected === intent.type) {
    this.stagePending(current.tx, current.ty, true, 'build');
  }
}
```

- [ ] **Step 7: Resolve touch release without leaking through mouse classification**

At the top of `pointerup`:

```ts
if (IS_TOUCH && p.wasTouch) {
  const transition = touchUp(this.touchGesture, p.id, this.boardPointersDown(p.id));
  this.touchGesture = transition.state;
  if (transition.tap) this.resolveTouchTap();
  if (this.touchGesture.kind === 'idle') {
    this.endStroke();
    this.endSweep();
    this.touchIntent = null;
    this.dragPan = null;
  }
  return;
}
```

Always exclude `p.id` during pointer-up counting because Phaser may still expose the released pointer as down while dispatching the event. Before resolving a tap, also require `p.y < PLAYFIELD_H` and `!this.overHud(p.x, p.y)`; releasing outside the board cancels the stored intent.

- [ ] **Step 8: Run touch and nearby input suites**

Run: `npx vitest run src/scenes/touchGesture.test.ts src/scenes/sceneLifecycle.integration.test.ts src/scenes/GameScene.test.ts src/scenes/beltPaint.test.ts src/scenes/boardCam.test.ts`

Expected: all tests pass and mouse-specific tests remain unchanged.

- [ ] **Step 9: Commit the Phaser integration**

```powershell
git add src/scenes/GameScene.ts src/scenes/sceneLifecycle.integration.test.ts
git commit -m "fix: defer touch mutations until gesture classification"
```

---

### Task 6: Full regression and runtime verification

**Files:**
- Modify only if verification reveals a regression covered by this spec.

**Interfaces:**
- Consumes: all previous task outputs.
- Produces: verified hotfix branch ready to integrate into `main`.

- [ ] **Step 1: Run focused regression tests together**

Run:

```powershell
npx vitest run src/scenes/GameScene.test.ts src/state/serialize.test.ts src/state/GameState.test.ts src/systems/simulationStep.test.ts src/systems/WaveSystem.terminal.test.ts src/scenes/touchGesture.test.ts src/scenes/sceneLifecycle.integration.test.ts
```

Expected: all focused files pass with zero failures.

- [ ] **Step 2: Run the complete automated gate**

Run the three commands independently and inspect every exit code:

```powershell
npm test
npm run typecheck
npm run build
```

Expected: all tests pass, TypeScript emits no diagnostics, and Vite completes the production build. The existing bundle-size warning may remain; no new warning is permitted.

- [ ] **Step 3: Verify desktop runtime behavior**

Start the dev server and use Chrome DevTools to:

1. Start a fresh run with effects enabled.
2. Trigger a shake-producing action or call the scene wrapper through the live game seam.
3. Confirm one visual shake and no stack overflow or console error.
4. Place and empty a tower, return to build phase, reload the save, and confirm ammo remains zero.
5. Let the early-send bonus decay, reload, and confirm the displayed entitlement is unchanged.

- [ ] **Step 4: Verify 844x390 touch behavior**

Emulate `844x390x2,mobile,touch,landscape` and verify:

1. A one-finger belt tap places exactly one belt on release.
2. A one-finger belt drag paints a connected run including its origin.
3. Adding a second finger before moving places no belt and spends no money.
4. Adding a second finger after a pending press cancels the stroke and performs pinch zoom/pan.
5. Survey, sell, staged building, and inspect taps still work after a one-finger release.
6. Console contains no errors or warnings caused by the tested interactions.

- [ ] **Step 5: Inspect the final diff against the specification**

Run:

```powershell
git diff main...HEAD --check
git diff main...HEAD --stat
git status --short
```

Confirm every in-scope requirement has a corresponding test and no cloud, balance, accessibility, or unrelated refactor slipped into the diff.

- [ ] **Step 6: Request code review**

Use the `superpowers:requesting-code-review` skill. Resolve every valid Critical/High issue and rerun the affected red-green test plus the full gate.

- [ ] **Step 7: Integrate and push**

Use the `superpowers:finishing-a-development-branch` skill. Merge or fast-forward the verified branch into local `main`, rerun `npm test`, `npm run typecheck`, and `npm run build` on `main`, then:

```powershell
git push origin main
```

Confirm `origin/main` equals local `HEAD` and verify the GitHub Pages workflow succeeds for that commit.

---

## Follow-on subprojects

This plan does not complete the umbrella audit-remediation goal. After this tranche ships, repeat the spec/plan/TDD cycle for:

1. Authoritative local/cloud persistence and Workshop accounting.
2. Save continuity for pending research, run rewards, missions, and account provenance.
3. Frame-rate-independent weapons, belts, projectile boundaries, and durable auto-send.
4. Menu async lifecycle, transactional isometric setup, and Three.js resource ownership.
5. Touch target sizing, semantic HTML accessibility, magnification, and reduced-motion policy.
6. Versioned Supabase migrations, server-authoritative scoring, CI/MCP hardening, sync observability, and measured performance work.
