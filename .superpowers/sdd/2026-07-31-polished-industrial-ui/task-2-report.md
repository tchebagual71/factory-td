# Task 2 report: Overlay policy and contextual coaching

## Status

Implemented and verified. The modules are pure and contain no Phaser objects or timers.

## Files

- `src/scenes/overlayPolicy.ts` — overlay state, plan types, and priority resolver.
- `src/scenes/overlayPolicy.test.ts` — terminal, blocking, and transient/inspector policy cases.
- `src/scenes/coach.ts` — contextual next-action coach using real `BUILD_INFO` descriptions.
- `src/scenes/coach.test.ts` — milestone progression and selected-building context cases.

## RED / GREEN evidence

### Overlay policy

- RED: `npx vitest run src/scenes/overlayPolicy.test.ts` exited 1 because `./overlayPolicy` did not exist.
- GREEN: the same command exited 0 with 1 file and 3 tests passing.

### Contextual coach

- RED: `npx vitest run src/scenes/coach.test.ts` exited 1 because `./coach` did not exist.
- GREEN: `npx vitest run src/scenes/coach.test.ts src/scenes/overlayPolicy.test.ts` exited 0 with 2 files and 7 tests passing.

## Verification

- `npm run typecheck` exited 0.
- `npm test` exited 0: 33 files and 580 tests passing.

## Commit

The implementation commit hash is recorded in the task handoff after the commit is created.

## Self-review

- Terminal always suppresses every other overlay level.
- Blocking suppresses report, transient, inspector, and ambient content.
- Reports outrank transient content; inspectors remain available with non-blocking content because they occupy a separate safe zone.
- Coach progress is monotonic through miner, belt, press, and any valid defense type (`tower`, `cannon`, `lancer`, or `cryo`).
- Selected context derives from `BUILD_INFO`, preventing building names and descriptions from drifting.

## Concerns

None. The chosen report-versus-inspector behavior follows the brief's explicit “separate safe zone” rule; UI integration can pass its actual visibility facts into this pure policy.
