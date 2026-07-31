import type { ActiveMission } from '../data/missions';
import type { OverlayPlan } from './overlayPolicy';

/** Exact board regions currently occupied by live UIScene controls. */
export interface BoardOverlayVisibility {
  objective: boolean;
  coach: boolean;
  inspector: boolean;
}

export function boardOverlayVisibility(
  plan: OverlayPlan,
  hasMission: boolean,
  coachDismissed: boolean,
): BoardOverlayVisibility {
  return {
    objective: plan.ambient && hasMission,
    coach: plan.ambient && !coachDismissed,
    inspector: plan.inspector,
  };
}

/** Cycle the HUD presentation only; mission state remains owned by GameState. */
export function nextMissionId(missions: readonly ActiveMission[], currentId: string | null): string | null {
  if (missions.length === 0) return null;
  const current = missions.findIndex((mission) => mission.id === currentId);
  return missions[(current + 1 + missions.length) % missions.length].id;
}

/** Reconcile a remembered presentation cursor after GameState replaces cards. */
export function presentedMissionId(missions: readonly ActiveMission[], currentId: string | null): string | null {
  return missions.some((mission) => mission.id === currentId) ? currentId : missions[0]?.id ?? null;
}
