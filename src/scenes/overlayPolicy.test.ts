import { describe, expect, it } from 'vitest';
import { overlayPlan } from './overlayPolicy';

describe('overlay priority', () => {
  it('lets a terminal screen own every region', () => {
    expect(overlayPlan({ terminal: true, blocking: true, report: true, transient: true, inspector: true }))
      .toEqual({ ambient: false, transient: false, report: false, inspector: false, blocking: false, terminal: true });
  });

  it('suspends ambient and reports behind a blocking decision', () => {
    expect(overlayPlan({ terminal: false, blocking: true, report: true, transient: true, inspector: true }))
      .toMatchObject({ ambient: false, transient: false, report: false, inspector: false, blocking: true });
  });

  it('shows one transient while keeping the inspector in its separate safe zone', () => {
    expect(overlayPlan({ terminal: false, blocking: false, report: false, transient: true, inspector: true }))
      .toMatchObject({ ambient: false, transient: true, inspector: true });
  });
});
