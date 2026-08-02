import { describe, expect, it } from 'vitest';
import { idleTouchGesture, touchDown, touchMove, touchUp } from './touchGesture';

describe('touch gesture classifier', () => {
  it('keeps a first touch pending and emits a tap when its owner releases', () => {
    const idle = idleTouchGesture();
    const first = touchDown(idle, { id: 1, x: 40, y: 50 }, 1);

    expect(first).toMatchObject({ state: { kind: 'pending-single' }, cancelBoard: false });

    const tap = touchUp(first.state, 1, 0);
    expect(tap).toMatchObject({ state: { kind: 'idle' }, tap: true });
  });

  it('begins a drag only after its owner exceeds the movement threshold', () => {
    const first = touchDown(idleTouchGesture(), { id: 1, x: 40, y: 50 }, 1);

    const drag = touchMove(first.state, { id: 1, x: 60, y: 50 }, 1, 12);

    expect(drag).toMatchObject({ state: { kind: 'single-drag' }, beginDrag: true });
  });

  it('does not let a non-owner move begin a drag', () => {
    const first = touchDown(idleTouchGesture(), { id: 1, x: 40, y: 50 }, 1);

    const moved = touchMove(first.state, { id: 2, x: 80, y: 50 }, 1, 12);

    expect(moved).toMatchObject({
      state: { kind: 'pending-single', owner: 1, x: 40, y: 50 },
      beginDrag: false,
    });
  });

  it('classifies a second touch as pinch until every pointer releases', () => {
    const first = touchDown(idleTouchGesture(), { id: 1, x: 40, y: 50 }, 1);
    const pinch = touchDown(first.state, { id: 2, x: 80, y: 50 }, 2);

    expect(pinch).toMatchObject({ state: { kind: 'pinch' }, cancelBoard: true });

    const stillPinching = touchUp(pinch.state, 2, 1);
    expect(stillPinching.state.kind).toBe('pinch');
    expect(touchUp(stillPinching.state, 1, 0).state.kind).toBe('idle');
  });

  it('never emits a tap after a gesture has become a pinch', () => {
    const first = touchDown(idleTouchGesture(), { id: 1, x: 40, y: 50 }, 1);
    const pinch = touchDown(first.state, { id: 2, x: 80, y: 50 }, 2);
    const stillPinching = touchUp(pinch.state, 2, 1);

    expect(stillPinching.tap).toBe(false);
    expect(touchUp(stillPinching.state, 1, 0).tap).toBe(false);
  });
});
