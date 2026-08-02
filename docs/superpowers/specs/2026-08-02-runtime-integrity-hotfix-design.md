# Runtime Integrity Hotfix Design

**Date:** 2026-08-02

**Status:** Proposed

## Purpose

Repair the proven critical and high-severity runtime defects found during the professional game-development audit without changing Factory TD's balance targets, visual identity, map rules, or core factory/tower loop.

This is the first bounded subproject in the wider audit-remediation program. It must leave the game safe to play and resume before the later cloud-protocol, frame-rate-independence, accessibility, and production-hardening projects begin.

## Scope

The hotfix covers four behaviors:

1. Screenshake delegates to the active world camera instead of recursively calling itself.
2. Save/resume preserves an empty tower magazine and the current early-send decay clock.
3. Game-over and research-card freezes are hard simulation barriers within the frame in which they occur.
4. Touch input cannot buy, sell, survey, stage, or rotate a board object before a one-finger gesture has been distinguished from a two-finger pinch.

## Non-goals

- No balance-number changes.
- No save of enemies, projectiles, or other mid-wave state; saves remain build-phase checkpoints.
- No cloud conflict-resolution changes in this tranche.
- No persistence yet for pending research cards, run kills, best combo, or mission history; those belong to the save/cloud continuity project.
- No fixed-timestep conversion or catch-up firing/belt traversal; those belong to the frame-rate-independence project.
- No menu redesign, HTML accessibility mirror, or bundle splitting.
- No broad refactor of `GameScene`, `UIScene`, or system ownership.

## Design

### 1. Screenshake delegation

`GameScene.shake(duration, intensity)` remains the single policy seam for reduced-effects handling. When reduced effects are disabled, it calls `this.cameras.main.shake(duration, intensity)` exactly once. When reduced effects are enabled, it returns without calling the camera.

Keeping the wrapper preserves every existing caller and avoids spreading preference checks back through combat, waves, upgrades, research, and surveying.

### 2. Save/resume semantic equivalence

#### Empty magazines

`captureBuilding` writes `ammo` for every tower, including zero. Non-tower buildings continue to omit it.

During restore, a tower with an absent `ammo` field restores as zero. This is backward-compatible with existing version 1 and version 2 saves because previous capture logic included every positive tower-ammo value and omitted the field only when the tower was empty. Non-towers are unaffected.

The save version remains 2. The field already exists and its historical omission is unambiguous, so a format-version bump would add migration machinery without changing the information available.

#### Early-send clock

The build-phase snapshot gains optional `buildElapsed`. New saves store the elapsed time clamped to the early-send window because all larger values have identical economic meaning: no early-send bonus remains. Validation accepts only finite values in that closed range.

`GameState.applySnapshot` restores the validated value and defaults missing legacy values to zero. Existing saves therefore receive at most one legacy maximum-bonus opportunity after deployment; every subsequent save/resume is equivalent. Inferring elapsed time from `savedAt` is deliberately rejected because saves occur on edits and checkpoints, not at a trustworthy build-phase start time.

### 3. In-frame simulation barriers

`GameScene.update` continues to own the documented system order. After each mutating system returns, it re-checks `GameState.gameOver` and `GameState.frozen`. If either became true, the frame stops before the next system.

`WaveSystem` must also stop its own enemy loop immediately after a leak causes game over. The central between-system guard cannot undo extra enemies processed inside the same system call.

The intended guarantees are:

- A lethal leak is the last gameplay mutation of the run except for synchronous game-over bookkeeping triggered by that leak.
- A lab delivery that opens a research draw prevents production, combat, logistics telemetry, and autosave-timer advancement later in that frame.
- A normal non-terminal leak continues processing normally.
- Pausing or opening help outside a system update keeps its current existing behavior.

No rollback is introduced. The mutation that caused the barrier remains authoritative; only later mutations are prevented.

### 4. Touch gesture classification before board mutation

Mouse and keyboard behavior remains immediate. Touch board actions use a small Phaser-independent gesture classifier with these states:

- `idle`: no owned touch gesture.
- `pending-single`: first touch is down but has not yet earned permission to mutate the board.
- `single-drag`: one pointer moved beyond the drag threshold; belt painting or board panning may proceed.
- `pinch`: a second pointer landed; all pending placement, sale, survey, and belt-stroke work is cancelled until both pointers are released.

Rules:

- First touch-down records the pointer and board position but spends no money and removes nothing.
- A one-finger tap performs its existing tap action on release.
- A one-finger belt drag starts painting only after movement exceeds the existing drag threshold; the origin cell is included when the stroke is committed.
- A second touch transitions to `pinch` before the second pointer can reach placement, survey, rotation, or selling code.
- Entering `pinch` clears pending taps/strokes and suppresses board mutation until all touch pointers are up.
- Pinch zoom and pan continue using the existing camera math.
- UI controls remain responsive to touch and do not enter the board gesture classifier.

The classifier exposes only pure pointer-count/movement transitions. Phaser-specific pointer reads and existing placement methods remain in `GameScene`.

## Data and compatibility

The only serialized addition is:

```ts
interface SaveV1 {
  buildElapsed?: number;
}
```

The capture snapshot accepts the same optional field. Existing save versions continue to validate. Cloud JSON remains subject to the same pure validator before restore.

No database migration is required because the cloud `saves.data` column stores the versioned JSON document.

## Error handling and safety

- Invalid `buildElapsed` rejects the whole untrusted save, matching the existing strict-validation policy.
- Camera shake remains a no-op under reduced effects and must never throw merely because the preference is enabled.
- A gesture cancellation is intentionally lossless: no charge, refund, sale, placement, or survey count changes occur before classification.
- Barrier checks do not swallow the triggering event or its synchronous UI/state notifications.

## Testing strategy

Every production change follows a red-green cycle.

### Screenshake

- Directly invoke the wrapper with a fake main camera and verify one delegation with exact arguments.
- Enable reduced effects and verify zero camera calls.
- The first test must fail against the recursive implementation with a stack overflow or missing expected delegation.

### Save/resume

- Capture a tower at zero ammo and assert the serialized field is explicitly zero.
- Restore/capture semantics assert an absent legacy tower-ammo field means zero, while a positive field remains positive.
- Capture and validate `buildElapsed` at zero, inside the bonus window, and beyond the window.
- Reject negative, non-finite, and over-window untrusted values.
- Apply a snapshot and verify `earlySendBonus` is unchanged across the save/resume boundary.

### Simulation barriers

- A lethal first leak prevents a later enemy in the same update from leaking or moving.
- A game-over transition after `WaveSystem` prevents conveyor, production, combat, and logistics updates in that frame.
- A research freeze after `ConveyorSystem` prevents later systems in that frame.
- A non-terminal frame still calls all systems in the established order.

### Touch gestures

- One-finger tap resolves exactly one board action on release.
- One-finger belt drag includes its origin and path after crossing the threshold.
- A second pointer before classification produces zero board mutations.
- A second pointer during a pending belt stroke cancels it without spending money.
- Pinch completion returns the classifier to idle only after both pointers release.
- Mouse pointer-down retains immediate behavior.

### Regression gates

- Targeted test files pass after each change.
- `npm test` passes in full.
- `npm run typecheck` passes.
- `npm run build` passes.
- Desktop and 844x390 touch smoke tests show no console errors and confirm shake, single-tap placement, belt drag, and pinch behavior.

## Delivery

Implementation will use small commits aligned with the four behaviors. After verification, the branch will be reviewed, fast-forwarded or merged into `main`, pushed to `origin/main`, and the Pages deployment will be checked for the pushed commit.

Later remediation subprojects remain open until separately specified, implemented, and verified; shipping this hotfix does not mark the overall professional-review objective complete.
