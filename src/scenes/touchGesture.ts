export interface TouchPoint {
  id: number;
  x: number;
  y: number;
}

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
