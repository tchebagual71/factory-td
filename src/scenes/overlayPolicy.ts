export type OverlayLevel = 'ambient' | 'transient' | 'report' | 'inspector' | 'blocking' | 'terminal';

export type OverlayState = Record<'terminal' | 'blocking' | 'report' | 'transient' | 'inspector', boolean>;

export type OverlayPlan = Record<OverlayLevel, boolean>;

/** Resolves which gameplay overlays may be visible without coordinating UI objects. */
export function overlayPlan(state: OverlayState): OverlayPlan {
  const terminal = state.terminal;
  const blocking = !terminal && state.blocking;
  const report = !terminal && !blocking && state.report;
  const transient = !terminal && !blocking && !report && state.transient;
  const inspector = !terminal && !blocking && state.inspector;

  return {
    ambient: !terminal && !blocking && !report && !transient,
    transient,
    report,
    inspector,
    blocking,
    terminal,
  };
}
