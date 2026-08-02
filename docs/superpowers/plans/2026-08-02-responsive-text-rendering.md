# Responsive Text Rendering Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore readable menu typography on short landscape phones without changing Factory TD's pixel-art graphics or gameplay.

**Architecture:** Add one pure menu-layout module that owns main-menu geometry and type sizes for roomy and compact canvases. Keep Phaser's existing FIT canvas and pixel-art renderer, but stop applying a second camera shrink to the phone menu and remove the ineffective scene-wide text-resolution override.

**Tech Stack:** TypeScript 5.8, Phaser 3.90, Vitest 4, Vite 7.

## Global Constraints

- Repair the existing repository and `main` branch; do not create a clone or second repository.
- Preserve gameplay, saves, balance, Supabase behavior, safe-area handling, and 2D/3D rendering behavior.
- Preserve the desktop 1280×720 menu positions and sizes.
- Keep `pixelArt: true`; do not smooth the complete game canvas.
- On supported phone fixtures, primary menu labels must render at least 11 CSS pixels and secondary labels at least 9 CSS pixels.
- Keep Continue, New Run, map selection, account, renderer selection, volume, effects, achievements, leaderboard, and Workshop reachable.
- Use test-first red-green cycles and run the full verification suite before pushing.

---

## File Structure

- Create `src/scenes/menuLayout.ts`: pure responsive menu geometry, typography, and rendered-font calculation.
- Create `src/scenes/menuLayout.test.ts`: desktop stability, phone readability, bounds, and non-overlap tests.
- Modify `src/config.ts`: stop creating a separate 720px virtual menu surface and remove device-derived text-resolution constants.
- Modify `src/config.test.ts`: replace the shrink-to-fit menu contract with the actual-canvas menu contract.
- Modify `src/scenes/MenuScene.ts`: draw the main menu from `MenuLayout` and remove the global sharpener call.
- Modify `src/scenes/GameScene.ts`: remove the global sharpener call.
- Modify `src/scenes/UIScene.ts`: remove the global sharpener call.
- Delete `src/utils/sharpText.ts`: remove the global text-texture override.

---

### Task 1: Pure Responsive Menu Layout

**Files:**
- Create: `src/scenes/menuLayout.ts`
- Create: `src/scenes/menuLayout.test.ts`

**Interfaces:**
- Consumes: canvas dimensions, touch capability, save-slot presence, and FIT scale.
- Produces: `menuLayout(opts: MenuLayoutOptions): MenuLayout` and `renderedFontSize(logicalSize: number, cameraZoom: number, fitScale: number): number`.

- [ ] **Step 1: Write failing desktop and phone layout tests**

Create tests using these public contracts:

```ts
export interface MenuLayoutOptions {
  gameW: number;
  gameH: number;
  touch: boolean;
  hasSave: boolean;
}

export interface MenuLayout {
  compact: boolean;
  cameraZoom: number;
  designW: number;
  designH: number;
  title: { y: number; size: number };
  subtitle: { y: number; size: number };
  view: { labelSize: number };
  account: { labelSize: number; buttonSize: number };
  main: {
    continueY: number | null;
    newRunY: number;
    actionsY: number;
    secondaryY: number;
    buttonH: number;
    fullLabelSize: number;
    halfLabelSize: number;
  };
  map: { y: number; headingSize: number; labelSize: number; blurbSize: number };
  settings: { y: number; labelSize: number };
  best: { y: number; size: number };
  footer: { y: number; size: number; short: boolean };
}
```

Assert the 1920×1080 logical menu preserves the current values: camera zoom 1, title y 130/size 64, subtitle y 185/size 15, saved-run rows at y 265/327/389/451, map y 525, settings y 613, and footer y 694/size 11.

For 844×390, 852×393, and 932×430 touch fixtures, load the corresponding canvas metrics from `config.ts`, calculate FIT scale, and assert:

```ts
expect(renderedFontSize(layout.main.fullLabelSize, layout.cameraZoom, fit)).toBeGreaterThanOrEqual(11);
expect(renderedFontSize(layout.map.blurbSize, layout.cameraZoom, fit)).toBeGreaterThanOrEqual(9);
expect(layout.main.secondaryY + layout.main.buttonH / 2).toBeLessThan(layout.map.y - 20);
expect(layout.footer.y + layout.footer.size).toBeLessThanOrEqual(layout.designH);
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
npx vitest run src/scenes/menuLayout.test.ts
```

Expected: FAIL because `./menuLayout` does not exist.

- [ ] **Step 3: Implement the minimal pure layout**

Implement `renderedFontSize` as the product of logical size, camera zoom, and FIT scale. Implement two branches:

- Roomy: exact existing 720px design values, with `top = Math.round((gameH - 720) / 2)` added to vertical coordinates.
- Compact touch (`touch && gameH < 720`): camera zoom 1, actual `gameW × gameH` design bounds, touch font sizes of 18px primary and 14px secondary, a 48px title, bottom-anchored map/settings/footer, and four main rows that remain above the map whether a save exists or not.

Invalid/non-positive dimensions return the roomy 1280×720 fallback.

- [ ] **Step 4: Run the new test and verify GREEN**

Run:

```bash
npx vitest run src/scenes/menuLayout.test.ts
```

Expected: all menu-layout tests pass.

- [ ] **Step 5: Commit the pure layout**

```bash
git add src/scenes/menuLayout.ts src/scenes/menuLayout.test.ts
git commit -m "test: define responsive menu typography contract"
```

---

### Task 2: Render the Menu at Actual Phone Size

**Files:**
- Modify: `src/config.ts`
- Modify: `src/config.test.ts`
- Modify: `src/scenes/MenuScene.ts`
- Test: `src/config.test.ts`
- Test: `src/scenes/menuLayout.test.ts`

**Interfaces:**
- Consumes: `menuLayout({ gameW: MENU_W, gameH: MENU_H, touch: IS_TOUCH, hasSave: Boolean(save) })`.
- Produces: one `MenuLayout` instance used by all main-screen menu controls.

- [ ] **Step 1: Change the config tests to require a real-size phone menu**

Replace the old phone expectations (`MENU_H >= 720` and a camera scale below 1) with:

```ts
expect(c.MENU_SCALE).toBe(1);
expect(c.MENU_W).toBe(c.GAME_W);
expect(c.MENU_H).toBe(c.GAME_H);
```

Keep the existing desktop/tablet assertions.

- [ ] **Step 2: Run config tests and verify RED**

Run:

```bash
npx vitest run src/config.test.ts
```

Expected: phone cases fail because `MENU_H` is still forced to at least 720 and `MENU_SCALE` is below 1.

- [ ] **Step 3: Remove the second menu scale from config**

Set:

```ts
export const MENU_SCALE = 1;
export const MENU_W = GAME_W;
export const MENU_H = GAME_H;
```

Delete `MENU_DESIGN_H`, `CANVAS_SCALE`, and `TEXT_RES` plus their obsolete comments.

- [ ] **Step 4: Wire `MenuScene` to the pure layout**

Import `menuLayout` and construct it after reading the save slot. Set camera zoom/center from the result. Replace main-screen literals for the title, subtitle, account/view text, four button rows, map row, settings row, best score, and footer with layout fields.

Update `button()` to accept the owning layout's `buttonH`, `fullLabelSize`, and `halfLabelSize` instead of hardcoding 50/16/14. Update `buildMapPicker()` and `buildVolumeControl()` to accept the font sizes returned by the layout.

For `footer.short`, use concise touch copy:

```text
Tap HOW TO PLAY · tap a build slot then the map · pinch to zoom · [?] help
```

The desktop footer copy remains unchanged.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
npx vitest run src/config.test.ts src/scenes/menuLayout.test.ts src/scenes/achievementLayout.test.ts
npm run typecheck
```

Expected: all focused tests pass and TypeScript reports no errors.

- [ ] **Step 6: Commit the responsive menu integration**

```bash
git add src/config.ts src/config.test.ts src/scenes/MenuScene.ts
git commit -m "fix: keep phone menu text readable"
```

---

### Task 3: Remove the Ineffective Global Text Override

**Files:**
- Modify: `src/scenes/GameScene.ts`
- Modify: `src/scenes/MenuScene.ts`
- Modify: `src/scenes/UIScene.ts`
- Delete: `src/utils/sharpText.ts`

**Interfaces:**
- Consumes: Phaser's normal per-object text rendering.
- Produces: no scene-level `ADDED_TO_SCENE` listener and no global `setResolution()` call.

- [ ] **Step 1: Add a regression source-contract test**

Add a test to `src/scenes/menuLayout.test.ts` that reads the three scene sources and asserts they do not import or call `sharpenText`, and that `src/utils/sharpText.ts` is absent after implementation. The production change that makes this pass is removal of the global override and its call sites.

- [ ] **Step 2: Run the regression test and verify RED**

Run:

```bash
npx vitest run src/scenes/menuLayout.test.ts
```

Expected: FAIL because all three scenes still call `sharpenText` and the helper still exists.

- [ ] **Step 3: Remove the helper and call sites**

Delete the imports and `sharpenText(this)` calls from all three scenes, then delete `src/utils/sharpText.ts`. Do not change `pixelArt: true` or the canvas CSS.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
npx vitest run src/scenes/menuLayout.test.ts src/config.test.ts
npm run typecheck
```

Expected: tests and type checking pass.

- [ ] **Step 5: Commit the rendering cleanup**

```bash
git add src/scenes/GameScene.ts src/scenes/MenuScene.ts src/scenes/UIScene.ts src/scenes/menuLayout.test.ts src/utils/sharpText.ts
git commit -m "fix: remove global Phaser text resolution override"
```

---

### Task 4: Browser and Repository Verification

**Files:**
- Modify only if verification reveals a reproducible defect covered by a new failing test.

**Interfaces:**
- Consumes: the completed responsive menu and normal Phaser text rendering.
- Produces: verified commits ready for `origin/main`.

- [ ] **Step 1: Run the full automated suite**

Run:

```bash
npm test
npm run typecheck
npm run build
git diff --check
```

Expected: zero test failures, zero TypeScript errors, successful Vite build, and no whitespace errors.

- [ ] **Step 2: Inspect the desktop browser**

At 1920×1080 DPR 1, verify the canvas is 1280×720 fitted to 1920×1080, the menu matches its prior desktop geometry, all controls are visible, and the console has no errors.

- [ ] **Step 3: Inspect representative phone browsers**

At 844×390 DPR 3 touch landscape and 932×430 DPR 3 touch landscape, verify the menu camera is not additionally shrunk, all required controls are visible, text is materially larger, controls do not overlap, and the console has no errors.

- [ ] **Step 4: Review the complete diff against the design**

Compare the implementation to `docs/superpowers/specs/2026-08-02-responsive-text-rendering-design.md`. Fix Critical and Important findings with a new failing test before changing production code.

- [ ] **Step 5: Commit any verification-only fixes**

If verification required changes:

```bash
git add src/config.ts src/config.test.ts src/scenes/menuLayout.ts src/scenes/menuLayout.test.ts src/scenes/MenuScene.ts src/scenes/GameScene.ts src/scenes/UIScene.ts
git commit -m "fix: close responsive text verification findings"
```

If no changes were required, do not create an empty commit.

- [ ] **Step 6: Push verified main**

```bash
git status --short
git push origin main
```

Expected: clean worktree and successful update of `origin/main` without force pushing.
