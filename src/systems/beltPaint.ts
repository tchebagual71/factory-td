import { Dir, DX, DY } from '../types';

/** One cell of a drag: where the belt goes and which way it must face. */
export interface BeltStep {
  x: number;
  y: number;
  dir: Dir;
}

/**
 * Resolve a belt drag from one cell to another into the run of cells it should
 * lay, in order, each already facing the cell that follows it.
 *
 * Kept pure and out of GameScene for the same reason as `hudLayout`: the
 * failure modes here (a fast flick leaving a hole in the line, a corner laying
 * belts that all still face the direction you started in) are invisible in code
 * review and obvious in a test.
 *
 * An off-axis drag is resolved one axis at a time, so the run is a clean L with
 * a single corner rather than a staircase. `dir` is the direction the drag is
 * already running in and decides which leg comes first, so a straight run never
 * kinks just because the pointer wobbled a pixel off the row.
 */
export function beltRun(
  from: { x: number; y: number },
  to: { x: number; y: number },
  dir: Dir,
): BeltStep[] {
  const steps: BeltStep[] = [];
  let { x, y } = from;
  const dx = to.x - x;
  const dy = to.y - y;
  if (dx === 0 && dy === 0) return steps;

  const xFirst = dx !== 0 && (dy === 0 || dir % 2 === 0);
  for (const axis of xFirst ? ['x', 'y'] : ['y', 'x']) {
    if (axis === 'x') {
      const d: Dir = dx > 0 ? 0 : 2;
      while (x !== to.x) {
        x += DX[d];
        steps.push({ x, y, dir: d });
      }
    } else {
      const d: Dir = dy > 0 ? 1 : 3;
      while (y !== to.y) {
        y += DY[d];
        steps.push({ x, y, dir: d });
      }
    }
  }
  return steps;
}
