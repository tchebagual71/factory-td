# Polished Industrial Gameplay UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign Factory TD's initial build-phase gameplay screen as a polished industrial command console, prove it at desktop and authentic mobile startup sizes, and document a reusable design system for the remaining screens.

**Architecture:** Preserve Phaser scene ownership and existing `GameState.events` behavior. Move semantic styling, overlay priority, coaching decisions, and responsive geometry into small pure modules; make `UIScene` a renderer of those decisions and remove the obstructive opening paragraph from `GameScene`. The first screen remains canvas-first, while the resulting design-system document defines later semantic HTML and reduced-motion work honestly.

**Tech Stack:** TypeScript 5.8, Phaser 3.90, Vitest 4, Vite 7, Chrome DevTools MCP

## Global Constraints

- Preserve simulation behavior, economy, balance, save version, map geometry, Supabase behavior, input event names, camera masks, and the 2D/3D renderer relationship.
- Add no runtime dependency and download no art or fonts.
- Keep theme, overlay policy, coach decisions, and layout geometry pure and Phaser-free.
- Use test-first development: write one failing behavior test, verify the expected failure, implement only enough to pass, and rerun the focused and full suites.
- Preserve the portrait rotation prompt.
- Do not claim screen-reader accessibility for the canvas-only representative screen.
- User-approved visual direction: polished industrial, retaining the procedural factory identity.

---

## File Structure

- Create `src/scenes/uiTheme.ts`: semantic visual tokens and state visuals; no Phaser import.
- Create `src/scenes/uiTheme.test.ts`: token integrity, contrast, and control-state tests.
- Create `src/scenes/overlayPolicy.ts`: overlay levels and visibility/queue decisions; no Phaser import.
- Create `src/scenes/overlayPolicy.test.ts`: priority and safe-zone arbitration tests.
- Create `src/scenes/coach.ts`: pure contextual onboarding decision from run facts.
- Create `src/scenes/coach.test.ts`: onboarding progression tests.
- Modify `src/config.ts`: allocate a taller touch command deck so authentic phone rendering can meet target-size requirements.
- Modify `src/config.test.ts`: pin touch and pointer UI-height behavior.
- Modify `src/scenes/hudLayout.ts`: command-deck geometry, overlay safe zones, and fitted CSS scale helpers.
- Modify `src/scenes/hudLayout.test.ts`: desktop, phone, tablet, overlap, and rendered target-size coverage.
- Modify `src/scenes/UIScene.ts`: render the polished rail, objective card, coach strip, deck, wave module, and coordinated transient layer.
- Modify `src/scenes/GameScene.ts`: remove the opening text wall and emit contextual coach facts after relevant actions.
- Create `docs/design-system.md`: validated tokens, components, responsive behavior, overlay rules, accessibility direction, and rollout order.
- Reference `docs/superpowers/specs/2026-07-31-polished-industrial-ui-design.md`: authoritative approved design.

---

### Task 1: Semantic industrial theme

**Files:**
- Create: `src/scenes/uiTheme.test.ts`
- Create: `src/scenes/uiTheme.ts`

**Interfaces:**
- Produces: `UiTone`, `UI_COLOR`, `UI_FONT`, `UI_SPACE`, `ControlState`, `ControlVisual`, `controlVisual(state, accent?)`, and `contrastRatio(foreground, background)`.
- Consumes: no project modules.

- [ ] **Step 1: Read the test-quality rules**

Read `C:\Users\tobyd\.codex\plugins\cache\claude-plugins-official\superpowers\6.2.0\skills\test-driven-development\writing-good-tests.md` completely before writing the first test.

- [ ] **Step 2: Write the failing theme contract test**

Create `src/scenes/uiTheme.test.ts` with real behavior assertions:

```ts
import { describe, expect, it } from 'vitest';
import { UI_COLOR, UI_FONT, UI_SPACE, contrastRatio, controlVisual } from './uiTheme';

describe('polished industrial UI theme', () => {
  it('keeps every semantic tone usable as both Phaser and CSS color', () => {
    for (const tone of Object.values(UI_COLOR)) {
      expect(tone.hex).toBe(Number.parseInt(tone.css.slice(1), 16));
      expect(tone.css).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('keeps primary and secondary copy readable on the main surface', () => {
    expect(contrastRatio(UI_COLOR.text.hex, UI_COLOR.surface.hex)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(UI_COLOR.textMuted.hex, UI_COLOR.surface.hex)).toBeGreaterThanOrEqual(4.5);
  });

  it('uses distinct words and borders for state instead of color alone', () => {
    expect(controlVisual('selected').label).toBe('SELECTED');
    expect(controlVisual('disabled').label).toBe('UNAVAILABLE');
    expect(controlVisual('active').stroke).not.toBe(controlVisual('idle').stroke);
  });

  it('defines the approved type and spacing scales', () => {
    expect(UI_FONT.body).toContain('system-ui');
    expect(UI_FONT.mono).toContain('monospace');
    expect(UI_FONT.touchPrimary).toBeGreaterThanOrEqual(18);
    expect(UI_SPACE).toEqual([...UI_SPACE].sort((a, b) => a - b));
  });
});
```

- [ ] **Step 3: Run the test and verify the intended RED state**

Run: `npx vitest run src/scenes/uiTheme.test.ts`

Expected: FAIL because `./uiTheme` does not exist.

- [ ] **Step 4: Implement the pure theme module**

Create `src/scenes/uiTheme.ts` with the approved tokens. Use this public shape:

```ts
export interface UiTone { hex: number; css: string }
export type ControlState = 'idle' | 'hover' | 'selected' | 'active' | 'disabled' | 'danger';
export interface ControlVisual { fill: number; stroke: number; text: number; label: string }

const tone = (hex: number): UiTone => ({ hex, css: `#${hex.toString(16).padStart(6, '0')}` });

export const UI_COLOR = {
  ink: tone(0x081019), surface: tone(0x101b26), surfaceRaised: tone(0x172635),
  line: tone(0x2b4053), lineBright: tone(0x45657d), text: tone(0xe7eef5),
  textMuted: tone(0x91a4b7), money: tone(0xffd166), logistics: tone(0x38bdf8),
  production: tone(0xf59e42), defense: tone(0xfb7185), action: tone(0x52e58c),
  warning: tone(0xffad42), danger: tone(0xff5c67), research: tone(0x70e1c1),
} as const;

export const UI_FONT = {
  mono: 'ui-monospace, SFMono-Regular, Consolas, monospace',
  body: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  desktopSecondary: 12, desktopPrimary: 14, touchSecondary: 16, touchPrimary: 18,
} as const;
export const UI_SPACE = [4, 8, 12, 16, 24, 32] as const;
```

Implement WCAG relative luminance in `contrastRatio` and return explicit `label` values from `controlVisual`.

- [ ] **Step 5: Verify GREEN and the full suite**

Run: `npx vitest run src/scenes/uiTheme.test.ts`

Expected: PASS.

Run: `npm test`

Expected: all existing and new tests PASS.

- [ ] **Step 6: Commit the theme seam**

```bash
git add src/scenes/uiTheme.ts src/scenes/uiTheme.test.ts
git commit -m "feat: add polished industrial UI theme"
```

---

### Task 2: Overlay policy and contextual coaching

**Files:**
- Create: `src/scenes/overlayPolicy.test.ts`
- Create: `src/scenes/overlayPolicy.ts`
- Create: `src/scenes/coach.test.ts`
- Create: `src/scenes/coach.ts`

**Interfaces:**
- Produces: `OverlayLevel`, `OverlayState`, `OverlayPlan`, `overlayPlan(state)`.
- Produces: `CoachFacts`, `CoachMessage`, `coachMessage(facts)`.
- Consumes: `BuildingType` from `src/types.ts` in `coach.ts` only.

- [ ] **Step 1: Write failing overlay-policy tests**

```ts
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
```

- [ ] **Step 2: Verify the overlay test fails for the missing module**

Run: `npx vitest run src/scenes/overlayPolicy.test.ts`

Expected: FAIL because `./overlayPolicy` does not exist.

- [ ] **Step 3: Implement overlay decisions**

Implement `overlayPlan` as a total pure function. Terminal wins over blocking; blocking wins over report and transient; transient temporarily hides ambient objective/coach content; reports remain hidden while blocking or terminal content exists. Do not put Phaser objects or timers in this module.

- [ ] **Step 4: Verify overlay GREEN**

Run: `npx vitest run src/scenes/overlayPolicy.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing coach progression tests**

```ts
import { describe, expect, it } from 'vitest';
import { coachMessage } from './coach';

describe('contextual build coach', () => {
  it('starts with one miner action instead of a paragraph', () => {
    expect(coachMessage({ buildings: [], selected: null })).toMatchObject({ step: 1, action: 'Place a miner on an orange ore deposit' });
  });

  it('advances through belt, press, and gun milestones', () => {
    expect(coachMessage({ buildings: ['miner'], selected: null }).step).toBe(2);
    expect(coachMessage({ buildings: ['miner', 'belt'], selected: null }).step).toBe(3);
    expect(coachMessage({ buildings: ['miner', 'belt', 'press'], selected: null }).step).toBe(4);
  });

  it('uses a selected building description without losing the milestone', () => {
    const result = coachMessage({ buildings: ['miner'], selected: 'belt' });
    expect(result.step).toBe(2);
    expect(result.context).toContain('BELT');
  });

  it('ends in a launch-wave action once a gun exists', () => {
    expect(coachMessage({ buildings: ['miner', 'belt', 'press', 'tower'], selected: null }))
      .toMatchObject({ step: 5, action: 'Launch the wave when your line is ready' });
  });
});
```

- [ ] **Step 6: Verify coach RED**

Run: `npx vitest run src/scenes/coach.test.ts`

Expected: FAIL because `./coach` does not exist.

- [ ] **Step 7: Implement the pure coach decision**

Use these exact interfaces:

```ts
export interface CoachFacts { buildings: readonly BuildingType[]; selected: BuildingType | null }
export interface CoachMessage { step: 1 | 2 | 3 | 4 | 5; action: string; context: string }
export function coachMessage(facts: CoachFacts): CoachMessage
```

Treat cannon, lancer, and cryo as valid defensive milestones alongside `tower`. Build the selected context from the real `BUILD_INFO` entry so names and descriptions do not drift.

- [ ] **Step 8: Verify coach GREEN and commit**

Run: `npx vitest run src/scenes/coach.test.ts src/scenes/overlayPolicy.test.ts`

Expected: PASS.

```bash
git add src/scenes/overlayPolicy.ts src/scenes/overlayPolicy.test.ts src/scenes/coach.ts src/scenes/coach.test.ts
git commit -m "feat: coordinate gameplay overlays and coaching"
```

---

### Task 3: Responsive command-deck and safe-zone geometry

**Files:**
- Modify: `src/config.test.ts`
- Modify: `src/config.ts`
- Modify: `src/scenes/hudLayout.test.ts`
- Modify: `src/scenes/hudLayout.ts`

**Interfaces:**
- Extends `HudLayout` with `deck`, while preserving `slots`, `groupHeaders`, `touch`, `preview`, `send`, and `toggles` consumers.
- Produces: `OverlayZones`, `overlayZones(gameW, playfieldH, stripBottom, touch)`, `fittedScale(canvasW, canvasH, viewportW, viewportH)`, and `renderedSize(rect, scale)`.
- Consumes: existing `Rect`, `overlaps`, and `contains` helpers.

- [ ] **Step 1: Add a failing touch-height configuration test**

Refactor the private UI-height calculation into an exported pure `uiHeightForViewport({ width, height, touch })` without changing the existing exported `UI_H` behavior. Add tests proving:

```ts
expect(uiHeightForViewport({ width: 844, height: 390, touch: true })).toBeGreaterThanOrEqual(220);
expect(uiHeightForViewport({ width: 1440, height: 900, touch: false })).toBe(160);
expect(uiHeightForViewport({ width: 1920, height: 1080, touch: false })).toBe(80);
```

- [ ] **Step 2: Verify config RED**

Run: `npx vitest run src/config.test.ts`

Expected: FAIL because the helper is missing and the phone touch height is currently 170.

- [ ] **Step 3: Implement the pure UI-height helper**

Use a touch minimum of 220 canvas pixels and retain the 300 maximum. Keep portrait sizing based on the landscape equivalent. Set `UI_H` by calling the helper with the actual window metrics; use deterministic defaults in tests/SSR.

- [ ] **Step 4: Verify config GREEN**

Run: `npx vitest run src/config.test.ts`

Expected: PASS.

- [ ] **Step 5: Add failing geometry and rendered-size tests**

Extend `hudLayout.test.ts` with:

```ts
it('keeps objective, inspector, toast, and coach safe zones disjoint', () => {
  const zones = overlayZones(1280, 640, topStrip(1280, true).stats.y + topStrip(1280, true).h, true);
  expect(overlaps(zones.objective, zones.inspector)).toBe(false);
  expect(overlaps(zones.toast, zones.inspector)).toBe(false);
  expect(zones.coach.y + zones.coach.h).toBeLessThanOrEqual(640);
});

it('keeps landscape-phone controls at least 36 CSS pixels in both dimensions', () => {
  const opts = { gameW: 1280, barY: 640, barH: 220, roomy: true, touch: true, groups: GROUPS };
  const layout = hudLayout(opts);
  const scale = fittedScale(1280, 860, 844, 390);
  for (const rect of [...layout.slots, ...layout.touch, ...layout.toggles, layout.send]) {
    expect(renderedSize(rect, scale).w).toBeGreaterThanOrEqual(36);
    expect(renderedSize(rect, scale).h).toBeGreaterThanOrEqual(36);
  }
});
```

Also update the phone fixture from `barH: 170` to `barH: 220`.

- [ ] **Step 6: Verify geometry RED**

Run: `npx vitest run src/scenes/hudLayout.test.ts`

Expected: FAIL because safe-zone and scale helpers are absent and the current touch tool column is too short when rendered.

- [ ] **Step 7: Implement the responsive layout**

In `hudLayout.ts`:

- Increase the touch tool column to 180px.
- Lay out rotate and sell as two half-width controls in the first row and pause as one full-width control in the second row.
- Preserve the three-entry `touch` array order `[rotate, sell, pause]`.
- Add `deck: Rect` spanning the bottom bar.
- Add objective, inspector, toast, and coach safe zones anchored from `stripBottom` and `PLAYFIELD_H`.
- Implement a finite, nonnegative fitted scale with `0` returned for invalid dimensions.
- Keep all current desktop geometry tests passing.

- [ ] **Step 8: Verify geometry GREEN and full regression**

Run: `npx vitest run src/config.test.ts src/scenes/hudLayout.test.ts`

Expected: PASS.

Run: `npm test`

Expected: PASS.

- [ ] **Step 9: Commit responsive geometry**

```bash
git add src/config.ts src/config.test.ts src/scenes/hudLayout.ts src/scenes/hudLayout.test.ts
git commit -m "feat: add responsive gameplay command deck"
```

---

### Task 4: Render the polished command rail, build deck, and wave module

**Files:**
- Modify: `src/scenes/UIScene.ts`

**Interfaces:**
- Consumes: `UI_COLOR`, `UI_FONT`, `UI_SPACE`, and `controlVisual` from `uiTheme.ts`.
- Consumes: the existing `HudLayout`, `topStrip`, and `slotContent` API plus new `deck` geometry.
- Preserves: all existing `ui:select`, `ui:startwave`, `ui:prospect`, `ui:rotate`, `ui:sellmode`, `ui:view`, `ui:menu`, speed, auto, overlay, help, mute, and research event behavior.

- [ ] **Step 1: Establish the regression gate before the visual refactor**

Run: `npm test`

Expected: PASS. Record the test count in the implementation report.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 2: Replace local visual literals with semantic theme roles**

Import the pure theme and replace the local `FONT` constant. Apply neutral surfaces and semantic accents to:

- top telemetry rail
- survey/research/view/help/mute controls
- bottom deck and category rails
- build slots and state labels
- wave action and secondary toggles

Do not change button event handlers or GameState mutations.

- [ ] **Step 3: Render telemetry as three distinct cells**

Use the existing `top.stats` rectangle but draw three contained telemetry cells for money, lives, and wave. Each cell gets a small uppercase label (`FUNDS`, `INTEGRITY`, `WAVE`) and a larger value line. Keep `moneyText`, `livesText`, and `waveText` as the value objects so `refreshStats` remains cheap.

- [ ] **Step 4: Add explicit slot state labels**

For each build slot, retain icon/name/price and add one reusable state text object. Store it in a new `paletteState` map. `refreshSelection` writes `SELECTED`; `refreshStats` writes `NEED $N` when unaffordable and clears the state when idle. Disabled content remains at alpha at least `0.72`; do not use opacity alone.

- [ ] **Step 5: Polish the wave module without behavior changes**

Keep threat preview in `previewText`, early reward in `earlyText`, and the existing primary rectangle. Change labels to persistent state words:

- `AUTO OFF` / `AUTO ON`
- `SPEED ×1` / `SPEED ×2` / `SPEED ×3`
- `LOGISTICS OFF` / `LOGISTICS ON`
- `MENU` / `CONFIRM?`

Ensure `SEND WAVE` remains the only filled action color in the deck.

- [ ] **Step 6: Run the full automated gate**

Run: `npm test`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS with no new type suppressions.

- [ ] **Step 7: Commit the representative chrome**

```bash
git add src/scenes/UIScene.ts
git commit -m "feat: polish gameplay command console"
```

---

### Task 5: Replace the text wall with safe-zone objectives and contextual coaching

**Files:**
- Modify: `src/scenes/GameScene.ts`
- Modify: `src/scenes/UIScene.ts`

**Interfaces:**
- GameScene emits `GameState.events.emit('coach', message)` using `coachMessage({ buildings, selected })`.
- UIScene consumes `coach` and renders `CoachMessage` in `overlayZones(...).coach`.
- UIScene consumes current missions and renders one expanded contract in `overlayZones(...).objective` with `+N contracts` summary.
- UIScene uses `overlayPlan` before showing missions, coach content, toasts, reports, blocking layers, or terminal layers.

- [ ] **Step 1: Add the coach event at real state-change seams**

In `GameScene`, add a private method:

```ts
private emitCoach(): void {
  GameState.events.emit('coach', coachMessage({
    buildings: this.grid.buildings.map((b) => b.type),
    selected: this.selected,
  }));
}
```

Call it after scene initialization, selection changes, successful placement, sale, and restored run load. Remove the five-line `hint` text and its 14-second tween entirely.

- [ ] **Step 2: Render one objective card instead of three stacked rows**

Replace `missionRows` with one object containing frame, name, description/progress, progress fill, and `extra` text. `refreshMissionCards` selects `GameState.missions[0]`, shows payout and `missionProgress`, and writes `+${Math.max(0, missions.length - 1)} contracts` only when more exist. Empty state reads `No active contract`.

- [ ] **Step 3: Render the coach strip in its safe zone**

Create one neutral panel with a numbered accent badge, action line in body font, and selected-building context line. On touch, use the approved larger sizes. The strip must also host existing hover/selection descriptions so `descText` no longer floats at a hard-coded `PLAYFIELD_H - 20` coordinate.

- [ ] **Step 4: Coordinate transient and ambient visibility**

Before showing a toast, set the ambient objective and coach container invisible according to `overlayPlan`. Restore them after the toast exits. Before research cards, help, or game over, clear the active report and hide all lower levels. A wave report may be queued until blocking content closes; it must never draw beneath research cards.

- [ ] **Step 5: Verify behavior and regression**

Run: `npx vitest run src/scenes/coach.test.ts src/scenes/overlayPolicy.test.ts src/scenes/hudLayout.test.ts`

Expected: PASS.

Run: `npm test`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit coordinated gameplay overlays**

```bash
git add src/scenes/GameScene.ts src/scenes/UIScene.ts
git commit -m "feat: coordinate objectives and contextual coaching"
```

---

### Task 6: Chrome verification, accessibility baseline, and design-system handoff

**Files:**
- Create: `docs/design-system.md`
- Modify only if verification exposes a defect: the smallest relevant file from Tasks 1–5, with a failing regression test first.

**Interfaces:**
- Documents the implemented `UI_COLOR`, `UI_FONT`, `UI_SPACE`, control states, component anatomy, safe zones, overlay levels, responsive rules, accessibility limits, and rollout order.
- Produces no new runtime interface.

- [ ] **Step 1: Start the development server in a hidden process**

Run `npm run dev -- --host 127.0.0.1` with output redirected to task-specific logs under `.codex/`. Confirm `http://127.0.0.1:5173/` responds before opening Chrome.

- [ ] **Step 2: Verify desktop at 1440x900**

Reload under a 1440x900 pointer viewport. Inspect and capture:

- fresh 2D build phase
- selected miner and selected gun states
- unaffordable slot state
- active objective and coach strip
- wave preview and launch module
- open tower inspector
- 3D view with the same HUD

Confirm no overlap among the objective, coach, inspector, toast, and command rail; confirm hover and selected states are visible; inspect console issues.

- [ ] **Step 3: Verify authentic mobile startup at 844x390 DPR 2**

Emulate `844x390x2,mobile,touch,landscape`, reload so `IS_TOUCH` and `UI_H` are recomputed, then inspect and capture:

- continue/new-run menu
- fresh 2D build phase
- selected slot and touch tool states
- wave module
- inspector

Confirm labels remain readable in the rendered screenshot, all command-deck controls stay within the canvas, and no region overlaps.

- [ ] **Step 4: Preserve portrait behavior**

Emulate `390x844x2,mobile,touch`, reload, and verify the existing `FACTORY TD plays in landscape` rotation prompt remains visible and the canvas is hidden.

- [ ] **Step 5: Run Lighthouse and accessibility inspection**

Run Lighthouse mobile navigation. Expected: accessibility score at least the audited baseline of 80 and no new best-practice failure. Take an accessibility-tree snapshot and record that the representative Phaser UI remains canvas-only. Check contrast and non-color state cues visually.

- [ ] **Step 6: Fix verification defects test-first**

For every observed overlap, clipped label, unreadable state, or console error, add the smallest pure regression test that would fail on the defect, verify RED, implement the correction, verify GREEN, and repeat the relevant Chrome capture.

- [ ] **Step 7: Write the resulting design system**

Create `docs/design-system.md` with these exact sections:

1. Principles
2. Semantic color tokens
3. Typography scale
4. Spacing and panel anatomy
5. Control states
6. Command rail
7. Active contract card
8. Coach strip
9. Build command deck
10. Wave command module
11. Overlay priority and safe zones
12. Responsive behavior
13. Accessibility and reduced-motion direction
14. Screen migration order

Document only the final verified values and behavior; do not copy obsolete pre-fix measurements.

- [ ] **Step 8: Run final verification**

Run: `npm test`

Expected: all tests PASS with clean output.

Run: `npm run typecheck`

Expected: PASS.

Run: `npm run build`

Expected: production build succeeds.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 9: Commit the verified design-system handoff**

```bash
git add docs/design-system.md
git commit -m "docs: establish Factory TD design system"
```

- [ ] **Step 10: Request final code review**

Use `superpowers:requesting-code-review` against the full implementation diff. Address every correctness, scope, or maintainability finding before claiming completion, rerun Task 6 Step 8, and record the final commit list and Chrome evidence in the handoff.

---

## Plan Self-Review Checklist

- Every approved-spec requirement maps to Tasks 1–6.
- Theme, overlay, coach, and geometry behaviors fail before their production modules or changes exist.
- `UIScene` visual refactors are protected by pure-module tests plus full browser verification.
- The plan preserves every existing UI event name and simulation boundary.
- Mobile verification requires a reload after emulation, matching the audited startup behavior.
- The deliverable includes both the representative screen and the remaining-screen design system.
- Accessibility claims remain bounded to evidence.
