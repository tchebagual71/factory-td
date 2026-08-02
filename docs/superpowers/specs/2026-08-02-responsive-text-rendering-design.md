# Responsive Text Rendering Repair

## Problem

Factory TD currently renders the menu and Phaser UI through a fixed logical canvas. On a short landscape phone, the canvas is fitted from 1280 logical pixels to roughly 844 CSS pixels. The title screen is then scaled a second time from a 720px-tall design surface. As a result, common 10–12px labels reach the player at roughly 6–8 CSS pixels.

Commit `79334d8` also added a scene-wide `setResolution()` pass. That increases each text object's private texture size, but the final game canvas is still scaled by the browser with nearest-neighbour sampling. It therefore consumes more texture memory without addressing the physical text-size problem, and it makes the resulting typography look harsher on some displays.

The live reproduction covered:

- 1920×1080 desktop at DPR 1: a 1280×720 canvas displayed at 1920×1080;
- 844×390 touch landscape at DPR 3: a 1280×591 canvas displayed at 844×389;
- the existing small desktop inspection viewport, where the same undersized secondary copy is visible.

## Decision

Repair the existing game. Do not create a clone or a second repository. Gameplay, save data, balance, rendering modes, and service integrations remain unchanged.

The repair has two parts:

1. Remove the global text-resolution override and return Phaser text objects to their normal rendering contract.
2. Replace the phone menu's shrink-the-entire-720px-screen strategy with a compact responsive layout whose geometry and typography are derived together.

The pixel-art renderer remains enabled. The goal is not to smooth the whole game canvas; it is to stop shrinking interface text below a readable physical size.

## Alternatives Considered

### Remove only the resolution override

This is the smallest patch and removes the latest questionable rendering change. It does not solve the menu's approximately 6px phone copy, so it is insufficient.

### Disable pixel-art rendering globally

This would smooth the final canvas, including text, but would also blur the procedural sprites and belts. It reverses an intentional visual direction and still does not correct physical text size.

### Build a new clone

This would duplicate a large, mature simulation and create migration risk for saves, progression, maps, Supabase data, and balancing. The defect is localized to presentation, so a rewrite is disproportionate.

## Responsive Layout Contract

### Desktop and roomy tablet

When the current 720px title-screen design fits without shrinking, preserve its positions and sizes. Existing desktop screenshots should remain visually stable apart from removal of the global text override.

### Short landscape touch screens

Use a compact menu layout derived from the actual game canvas dimensions. The compact layout will:

- render with a camera zoom of 1 rather than scaling a 720px virtual menu;
- keep the renderer and account controls in the top corners;
- use a shorter title block;
- keep Continue/New Run and the two paired action rows as the primary center stack;
- keep map selection and audio/effects controls on the same screen;
- remove or shorten explanatory copy before reducing actionable labels;
- place all interactive rectangles inside the canvas with at least an 8px logical margin;
- use touch typography sized so primary labels render at least 11 CSS pixels and secondary labels at least 9 CSS pixels on the supported phone fixtures.

The compact layout may abbreviate the bottom onboarding sentence because HOW TO PLAY remains available. It must not hide Continue, New Run, map selection, account access, renderer selection, volume, effects, achievements, leaderboard, or Workshop.

### Menu modals

Modal geometry remains centered within the actual menu viewport. Existing pagination and overflow protections stay in place. Touch modal copy may use the existing body-font family where it improves small-size legibility, but modal actions and headings retain the established industrial/monospace identity.

### Gameplay HUD

The gameplay HUD already has touch-specific geometry and type sizes. It will not be redesigned in this repair. Regression tests will check its rendered type scale; any individual label below the agreed physical floor will be increased together with its owning box or omitted if it is redundant. No global transform will resize text independently of its container.

## Components

### Pure menu layout module

A pure layout function will accept canvas width, canvas height, and touch capability. It will return:

- whether the layout is compact;
- the camera zoom and design bounds;
- title/subtitle positions and sizes;
- main button row positions and dimensions;
- map, settings, best-score, and footer positions;
- the typography sizes used by those regions.

`MenuScene` will draw from this result. Coordinates that belong to the main screen will no longer be split between configuration constants and scene literals.

### Text rendering cleanup

Delete the scene-wide sharpening helper, its three scene call sites, and the device-derived text-resolution constants that have no remaining consumer. Individual Phaser text styles remain free to specify a resolution in the future if a measured, isolated need appears.

### Physical-size calculation

Tests will use the same FIT scale calculation already present in `hudLayout.ts`. For menu text, rendered size is:

`logical font size × menu camera zoom × fitted canvas scale`

This makes the acceptance rule explicit and prevents a future layout from passing logical-pixel assertions while becoming unreadable after browser scaling.

## Data Flow

1. `config.ts` derives the game canvas from the viewport as it does today.
2. The menu layout function receives those canvas dimensions plus touch capability.
3. `MenuScene` configures its camera and creates controls from that single layout result.
4. Phaser's Scale Manager fits the canvas into the browser.
5. Tests calculate the resulting CSS-pixel typography from the same inputs and assert the readable floor.

No game state, saved data, or scene communication changes.

## Error and Edge Handling

- Invalid or zero dimensions fall back to the current roomy 1280×720 design contract.
- Portrait touch devices continue to show the existing rotate prompt.
- Safe-area handling and Phaser's single centering owner remain unchanged.
- Compact copy must be truncated or omitted by explicit layout rules, never clipped by the canvas.
- The isometric menu backdrop continues to use the selected menu bounds and must cover the visible canvas.

## Testing

The repair will follow a red-green sequence.

Pure tests will cover:

- unchanged 1920×1080 desktop layout;
- 1024×768 touch tablet behavior;
- 844×390, 852×393, and 932×430 touch landscape phones;
- primary and secondary rendered font-size floors;
- all required controls remaining in bounds and non-overlapping;
- menu backdrop bounds matching the active design surface;
- gameplay HUD type-size checks for the same fixtures;
- invalid-dimension fallback.

Verification will include:

- targeted layout/config tests;
- the full Vitest suite;
- TypeScript type checking;
- production build;
- browser screenshots at desktop and phone sizes;
- console inspection for runtime errors.

## Acceptance Criteria

- Phone menu text is materially larger and readable without browser zoom.
- Desktop layout remains stable.
- Pixel-art sprites remain crisp.
- No global scene text-resolution hook remains.
- All required menu controls remain reachable on supported landscape phones.
- Gameplay, persistence, 2D/3D switching, and Supabase behavior are unchanged.
- Tests, type checking, and production build pass.

## Non-Goals

- Rebranding or replacing the game's art direction;
- redesigning gameplay systems or balance;
- changing save format or cloud schema;
- adding a new repository or deployment;
- making portrait gameplay available.
