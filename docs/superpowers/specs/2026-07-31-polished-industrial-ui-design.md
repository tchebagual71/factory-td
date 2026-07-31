# Factory TD Polished Industrial UI Design

**Date:** 2026-07-31  
**Status:** Approved direction; implementation pending written-spec review  
**Scope:** Full visual audit, one representative gameplay-screen implementation, responsive Chrome verification, and a reusable design system for the remaining screens

## Objective

Turn Factory TD's current functional pixel interface into a polished industrial command console without changing simulation rules, save data, balance, scene ownership, or the relationship between the 2D and 3D renderers. The first implementation targets the initial build-phase gameplay screen because it exercises the status rail, missions, onboarding, build palette, contextual actions, wave launch, responsive behavior, and board legibility in one state.

## Evidence From the Visual Audit

The audit covered the 2D and 3D title screens; new-run and continue states; map picker, volume, sign-in, leaderboard, Workshop, achievements, and How to Play modals; the 2D and 3D gameplay boards; desktop and touch build decks; in-game help; tower inspector and upgrade choices; research draw; wave report; mission toast; game-over card; landscape phone; and portrait rotation prompt.

Chrome verification used a 1440x900 desktop viewport, an 844x390 DPR 2 landscape-phone viewport, and a 390x844 DPR 2 portrait viewport. Lighthouse reported accessibility 80. Its accessibility tree exposed only the root page and an unnamed canvas, so the visible Phaser controls have no semantic equivalent. The viewport also disables user scaling.

Observed failures:

- The title screen is coherent but the 3D decorative backdrop competes with map and volume controls.
- Both instructional modals contain overlapping headings, body copy, or footer instructions.
- The initial gameplay explanation collides with the mission stack and obscures the board.
- Research rewards, mission completion, the wave report, and large center banners can appear together without spatial or temporal arbitration.
- The desktop build deck is dense but usable; the landscape-phone deck becomes materially too small to read comfortably.
- The mobile tower inspector is visually compressed and its comparisons are difficult to parse.
- Leaderboard and sign-in modals use large panels with sparse content, while help content overflows a similarly styled panel.
- 2D terrain reads as a flat debug grid beside the deeper 3D presentation.
- Locked, disabled, secondary, and descriptive text often rely on low-contrast gray at very small sizes.
- The portrait rotation prompt is clear and should be preserved.

## Ranked Improvements

1. **Overlay priority and safe zones.** Prevent onboarding, missions, inspectors, modal choices, reports, and transient rewards from claiming the same region.
2. **Mobile legibility and touch sizing.** Increase the logical size of touch controls, remove nonessential mobile copy, and preserve a clear primary action.
3. **Progressive onboarding.** Replace centered instruction walls with one contextual next action at a time.
4. **Gameplay HUD hierarchy.** Separate telemetry, objectives, construction, and wave launch into visually distinct command regions.
5. **Unified notification system.** Give banners, reports, toasts, and modal choices explicit priority, placement, and queueing rules.
6. **Shared visual tokens.** Centralize typography, spacing, colors, strokes, fills, shadows, and interaction states.
7. **Accessible semantic bridge.** Add HTML equivalents for major menu and modal actions after the representative canvas screen establishes the visual language.
8. **2D/3D environment coherence.** Use the same surface, lighting, accent, and category vocabulary in both renderers.
9. **Contextual inspector redesign.** Present current state, next state, cost, and constraint as a readable comparison instead of compact prose.
10. **Modal density and empty states.** Size panels from content and give sparse states useful context rather than empty space.

## Approaches Considered

### 1. Canvas-first structural redesign — selected

Keep the gameplay HUD in Phaser, extract pure geometry and theme data, and coordinate all overlays through explicit regions and priorities. This preserves existing scene communication, camera masks, 3D mirroring, input behavior, and testable pure layout seams. It also delivers the representative screen without turning the project into a simultaneous UI-platform migration.

### 2. Hybrid HTML gameplay HUD

Move the command rail, build deck, and modal system into DOM elements over the canvas. This offers the strongest responsive and accessibility foundation, but it also introduces new synchronization, fullscreen, focus, pointer-routing, scene-lifecycle, and device-safe-area problems at the same time as the visual redesign.

### 3. Canvas reskin

Change colors, borders, and type while retaining current placement. This is low-risk but fails the audit because the dominant problems are collision, density, hierarchy, and responsive behavior rather than palette alone.

## Visual Direction

The interface should feel like an industrial control console assembled for a factory under siege: deliberate, compact, high-contrast, and mechanical, with enough warmth to keep it playful.

### Color roles

- `ink`: `#081019` — page and deep-shadow background
- `surface`: `#101b26` — primary panels
- `surfaceRaised`: `#172635` — selected cards and raised controls
- `line`: `#2b4053` — structural borders
- `lineBright`: `#45657d` — hover and focus borders
- `text`: `#e7eef5` — primary copy
- `textMuted`: `#91a4b7` — secondary copy; never used below 12 canvas pixels on desktop or 16 on touch
- `money`: `#ffd166` — money, rewards, and wave timing
- `logistics`: `#38bdf8` — belts, routes, and delivery
- `production`: `#f59e42` — miners, machines, and research inputs
- `defense`: `#fb7185` — towers, damage, and danger
- `action`: `#52e58c` — safe primary actions and successful state
- `warning`: `#ffad42` — shortages and recoverable problems
- `danger`: `#ff5c67` — leaks, destructive state, and game over
- `research`: `#70e1c1` — research progress and card choices

Category color is an accent, not the panel fill. Panels remain neutral so the board and building art carry the game color.

### Typography

- Use the existing bold monospace voice for headings, prices, hotkeys, counters, and short labels.
- Use `system-ui, sans-serif` for explanatory copy, onboarding, descriptions, and modal paragraphs.
- Use sentence case for explanations and uppercase only for compact control labels.
- Minimum representative-screen sizes: 12px desktop secondary text, 14px desktop primary text, 16px touch secondary text, and 18px touch primary text in canvas units before Phaser scaling.
- Text must wrap from measured rectangles. No manually positioned second line may assume the first line's rendered height.

### Shape and depth

- Structural panels use 1–2px borders, a dark neutral fill, and one inset highlight rather than several competing outlines.
- Selected controls use a brighter border plus a slim category-colored rail; state must not be communicated through color alone.
- Disabled controls retain readable labels and add a short reason such as `NEED $40`, `FULL MAG`, or `WAVE ACTIVE`.
- Shadows are reserved for modal layers and the primary wave action, not every tile.

## Representative Gameplay Screen

### Top command rail

The rail groups money, lives, and wave into three compact telemetry cells on the left. Survey and research occupy the middle only when relevant. Map, view, help, and sound occupy the right. Labels and actions use distinct fills so a player cannot mistake telemetry for a button.

The rail reserves a rectangle beneath its left half for objectives and beneath its right half for the contextual inspector. These safe zones are inputs to layout code, not comments or duplicated coordinates.

### Active contract card

Only one mission is expanded. It shows name, payout, plain-language objective, and a progress bar. Additional missions collapse into `+2 contracts`. Completed missions leave through the toast queue before the next contract expands. On touch, the card is one line plus progress and can be tapped to cycle.

### Contextual coach strip

The six-line centered opening message is removed. On a fresh run, the coach strip above the build deck shows one action: `1 · Place a miner on an orange ore deposit`. Selecting a miner advances it to `2 · Route ore with belts`; placement and production events advance subsequent steps. Existing players may dismiss the strip. Help remains available independently.

For the representative implementation, the step may be derived from current run facts already available to the scene; the design must not add serialized tutorial state.

### Build command deck

The bottom bar becomes a command deck with three neutral bays separated by category-colored top rails. Each slot has one icon, one name, one price, and one state label. Hotkeys appear as compact corner badges on pointer devices and are omitted on touch.

The selected slot receives a bright outline, category rail, and `SELECTED` state text. Unaffordable slots remain legible and show the shortfall. Hover or touch selection sends the description to the coach strip rather than drawing another floating tooltip.

### Wave command module

Threat preview, launch action, early-send reward, auto-send, speed, logistics, and menu remain one module. `SEND WAVE` is the only filled green action. The preview names wave composition and counter advice. Secondary toggles use neutral fills and persistent state words such as `AUTO OFF`, `SPEED ×2`, and `LOGISTICS ON`.

### Touch layout

Touch uses the existing two-row palette concept, but removes hotkey badges and nonessential repeated labels. Rotate, sell, and pause sit in a dedicated vertical tool column. Minimum logical target size is 52x52 canvas units; tests also compute the final CSS scale for the 844x390 viewport and report targets below 36 CSS pixels as a failure. The final Chrome review judges legibility from the rendered phone screenshot, not logical dimensions alone.

### Board treatment

The representative screen retains existing procedural terrain and sprites, but reduces the intro obstruction and strengthens the board/HUD boundary with a subtle top edge and vignette. A full terrain-art pass belongs to the subsequent design-system rollout, not this representative implementation.

## Overlay Coordination

Every overlay belongs to one of five levels:

1. `ambient`: coach strip, mission card, logistics legend
2. `transient`: rewards, streaks, mission completion, achievement toast
3. `report`: wave report and contextual inspector
4. `blocking`: help, research draw, confirmation
5. `terminal`: game over

Rules:

- A higher level hides or suspends lower-level content that shares its safe zone.
- Transient messages use one queue; only one enters at a time.
- The wave report never appears while a blocking or terminal overlay is visible.
- Research draw clears center banners before dealing cards.
- The inspector yields to a toast only if the toast cannot use the left objective region.
- Closing a blocking layer restores the previous ambient state without changing pause intent.

The representative screen implements safe-zone geometry and the ambient/transient separation. Remaining overlays adopt the same contract during rollout.

## Architecture and Boundaries

### `src/scenes/uiTheme.ts`

New pure module containing semantic colors, font families, typography sizes, spacing scale, strokes, and component-state helpers. It imports neither Phaser nor game state.

### `src/scenes/hudLayout.ts`

Extend the existing pure geometry module with safe zones, contract-card geometry, coach-strip geometry, command-deck regions, and rendered-scale utilities. Existing `Rect`, `overlaps`, `contains`, and device fixtures remain the basis of geometry tests.

### `src/scenes/UIScene.ts`

Render the representative command rail, active contract card, coach strip, build deck, wave module, and transient queue using theme and layout outputs. It continues to observe `GameState.events`; it does not own simulation decisions.

### `src/scenes/GameScene.ts`

Remove the large opening instruction block and emit or expose only the minimal run facts needed for the coach step. Placement, selection, save behavior, camera behavior, and simulation remain unchanged.

### `src/scenes/overlayPolicy.ts`

New pure module defining overlay levels, safe-zone claims, and visibility decisions. UIScene converts those decisions into Phaser visibility and queue actions.

### `docs/design-system.md`

Document the final tokens, component anatomy, overlay hierarchy, responsive rules, accessibility requirements, and screen-by-screen migration order after the representative screen is visually verified.

## Data Flow

1. `GameState` and current scene events remain the authoritative source of money, lives, wave, missions, research, selection, phase, speed, and overlay state.
2. UIScene maps state into a small render model for the command rail, objective, coach step, deck, and wave module.
3. Pure layout functions map the render mode (`touch`, `roomy`, canvas dimensions) into rectangles and safe zones.
4. Pure overlay policy maps active overlays into visible regions and queue decisions.
5. UIScene updates existing Phaser objects in place. It must not recreate text, graphics, or emitters every frame.
6. Input handlers continue emitting the existing `ui:*` events so GameScene behavior does not change.

## Error and Edge States

- Missing or exhausted mission data renders `No active contract` without leaving blank frames.
- Narrow research space collapses before it overlaps map or utility controls.
- An unknown building category uses the neutral line color and remains selectable.
- Long localized strings wrap within their assigned rectangles and do not cover adjacent controls.
- A zero-width or hidden canvas scale returns a safe target-size result rather than dividing by zero.
- Game over clears transient and report layers before drawing the terminal card.
- View switching does not recreate the HUD or change its coordinates.
- Touch-capable laptops retain both touch controls and keyboard shortcuts.

## Accessibility Direction

The representative canvas implementation must improve contrast, copy size, non-color state cues, and touch geometry. It does not claim to make a canvas-only game screen-reader accessible.

The system rollout will add a DOM accessibility bridge for the main menu, help, research choices, tower upgrade choices, and game-over actions. It will also remove `user-scalable=no` unless gesture testing proves a concrete conflict that cannot be handled through `touch-action` on the canvas. Reduced-motion support must disable screen shake, large scale punches, and nonessential entrance animation while retaining state changes.

## Testing and Verification

### Automated

- Add failing tests for semantic theme tokens and readable state combinations before creating `uiTheme.ts`.
- Add failing layout tests for safe-zone non-overlap, contract card, coach strip, command deck, and wave module at 1440x900-equivalent desktop, 844x390 landscape phone, 4:3 touch tablet, and boxy non-touch tablet configurations.
- Add failing tests for overlay policy priority and queue behavior before creating `overlayPolicy.ts`.
- Preserve every existing HUD geometry, keymap, scene, save, simulation, and data test.
- Run `npm test`, `npm run typecheck`, and `npm run build`.

### Chrome desktop

- Run at 1440x900 in both 2D and 3D.
- Capture the fresh build phase, a selected build slot, an unaffordable build slot, active contract, wave preview, and open inspector.
- Confirm the coach strip, objective, and inspector do not overlap.
- Confirm every primary and secondary control has a visible hover, selected, disabled, or active state.

### Chrome mobile

- Reload under 844x390 DPR 2 mobile/touch emulation so startup geometry is authentic.
- Capture the menu, fresh build phase, selected build slot, wave module, and inspector.
- Confirm copy remains readable at screenshot scale, primary actions are distinguishable, and no control overlaps or leaves the canvas.
- Verify portrait 390x844 retains the existing rotation prompt.

### Accessibility

- Re-run Lighthouse and preserve or improve the baseline scores.
- Inspect the accessibility tree and record canvas-only limitations honestly.
- Confirm color is not the sole selected, disabled, warning, or success cue.
- Confirm `prefers-reduced-motion` is detectable and documented for the rollout.

## Design-System Rollout Order

After representative-screen verification:

1. In-game help and title How to Play
2. Tower inspector and upgrade comparison
3. Research cards
4. Wave report and unified transient queue
5. Game-over score card
6. Title screen and renderer-specific backdrop
7. Workshop and achievements
8. Sign-in and leaderboard empty/loading/error states
9. 2D terrain and 3D surface/lighting coherence
10. DOM accessibility bridge and reduced-motion/UI-scale settings

## Non-Goals

- No changes to tower stats, wave balance, economy, map geometry, saves, Supabase schema, or cloud synchronization.
- No replacement of procedural sprites with downloaded art.
- No new UI framework or runtime dependency.
- No conversion of the entire HUD to HTML in the representative pass.
- No claim of full accessibility until semantic HTML equivalents are implemented and tested.

## Acceptance Criteria

- The audit and ranked ten improvements are preserved in repository documentation.
- The initial gameplay/build-phase screen is visibly redesigned in the polished industrial direction.
- Theme, layout, and overlay rules are reusable pure modules rather than UIScene literals.
- The large initial instruction block no longer obscures the board.
- Missions, coach content, inspector, and transient messages have non-overlapping safe zones.
- The command rail, build deck, and wave module have clear primary/secondary hierarchy.
- Desktop and authentic mobile-startup screenshots demonstrate the representative screen without overlap.
- Automated tests, typecheck, and production build pass.
- `docs/design-system.md` records the resulting tokens, components, responsive behavior, accessibility direction, and rollout order.
