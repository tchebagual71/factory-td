import { describe, expect, it } from 'vitest';
import { overlayPlan } from './overlayPolicy';
import { boardOverlayVisibility, nextMissionId, presentedMissionId } from './overlayPresentation';

const missions = [
  { id: 'alpha', offeredAtWave: 1, startWave: 1, payout: 4 },
  { id: 'beta', offeredAtWave: 1, startWave: 1, payout: 4 },
  { id: 'gamma', offeredAtWave: 1, startWave: 1, payout: 4 },
];

describe('live board-overlay presentation', () => {
  it('only shields cards that UIScene is actually presenting', () => {
    const ambient = overlayPlan({ terminal: false, blocking: false, report: false, transient: false, inspector: false });
    expect(boardOverlayVisibility(ambient, true, false)).toEqual({ objective: true, coach: true, inspector: false });
    expect(boardOverlayVisibility(ambient, false, true)).toEqual({ objective: false, coach: false, inspector: false });

    const report = overlayPlan({ terminal: false, blocking: false, report: true, transient: false, inspector: true });
    expect(boardOverlayVisibility(report, true, false)).toEqual({ objective: false, coach: false, inspector: true });
  });

  it('cycles a stable presentation cursor without reordering GameState missions', () => {
    const original = missions.map((mission) => mission.id);
    expect(nextMissionId(missions, null)).toBe('alpha');
    expect(nextMissionId(missions, 'alpha')).toBe('beta');
    expect(nextMissionId(missions, 'gamma')).toBe('alpha');
    expect(presentedMissionId(missions.slice(1), 'alpha')).toBe('beta');
    expect(missions.map((mission) => mission.id)).toEqual(original);
  });
});
