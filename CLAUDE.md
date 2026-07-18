# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Factory TD — a browser game hybridizing factory automation (Factorio-style
miners/belts/smelters/power) with tower defense (Bloons-style fixed path, waves,
lives). Towers consume ammo that the player's factory must produce and deliver
by belt. TypeScript + HTML5 canvas + Vite, zero runtime dependencies.
`PLAN.md` holds the design rationale, balance targets, and roadmap.

## Commands

```bash
npm run dev                      # Vite dev server
npm test                         # all tests (vitest, headless — no DOM needed)
npx vitest run tests/belts.test.ts   # single test file
npm run typecheck                # tsc --noEmit (strict, noUnusedLocals)
npm run build                    # typecheck + production build
```

## Architecture

The simulation core (`src/core/`) is **headless** — it never touches the DOM.
The renderer and HUD read game state each frame; input calls `Game` command
methods. This split is what makes the whole sim unit-testable, and it must be
preserved: new game mechanics go in `src/core/`, new visuals in `src/render/`
or `src/ui/`.

- `src/core/game.ts` — `Game` class: all state (buildings, enemies, money,
  lives, phase), placement/sell/wave commands, and the fixed-timestep `update`.
  **The per-tick system order is deliberate**: waves → enemies → power →
  machines → belts → turrets → effects. Machines run in every phase (the
  factory works between waves); waves/enemies/turrets only run during `combat`.
- `src/core/config.ts` — nearly all tuning lives here: building defs (costs,
  recipes, turret stats), enemy defs, wave composition/scaling, belt/power
  constants. The HUD toolbar is generated from `BUILDING_DEFS`, so adding a
  building here surfaces it in the UI automatically.
- `src/core/systems/*.ts` — one file per system (belts, power, production,
  combat, enemies, waves, transfer), each a function taking the `Game`.
  `transfer.ts` (`accepts`/`tryInsert`) is the single chokepoint for item
  handoffs — belts→machines, machines→belts, machine→machine all go through it.
- `src/core/map.ts` — map layout (waypoints + ore patches) and path geometry;
  enemies track a scalar distance along the waypoint polyline, converted to px
  via `pointAlongPath`.
- `src/main.ts` — wiring + fixed-timestep loop (accumulator over `SIM_DT`,
  clamped so background tabs don't fast-forward; HUD speed button multiplies dt).

Key sim conventions:

- One `Building` struct serves every kind (belt/machine/turret fields co-exist);
  behavior is switched on `kind` + data from `BUILDING_DEFS`.
- Belts hold at most one item (`item` + `progress` 0..1); machines buffer
  inputs in `input` (cap `MACHINE_INPUT_CAP`) and hold exactly one finished
  item in `output` until the tile they face accepts it.
- Power is a single global grid: `satisfaction = min(1, supply/demand)`
  multiplies every machine's work speed. Turrets/belts need no power.
- Turrets are hitscan with "first" targeting (furthest `dist` in range) and
  reload whole ammo items into a `shots` magazine.
- Directions: `Dir` 0=N 1=E 2=S 3=W; machines output to the tile they face.

## Tests

`tests/` uses vitest against the headless core — no browser or DOM. Tests
build a tiny straight-path map via `tests/helpers.ts` (`testMap`, `setOre`,
`richGame`, `addPower`, `step`) rather than the real map; combat tests call
system functions like `updateTurrets` directly to avoid the full wave
lifecycle. When adding a mechanic, mirror this pattern instead of mocking.
