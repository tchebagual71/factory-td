# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Vision

**Factory TD** is a hybrid of Bloons-style tower defense and Factorio-style factory automation. Enemies march along a **fixed, predetermined path**; the player builds a factory on the land around it that manufactures the ammo their towers consume. The factory *is* the economy: a tower with no supply line is a statue.

Core loop:
1. Place miners on ore patches, route ore via conveyor belts into ammo presses
2. Belt the finished ammo into gun towers positioned along the enemy path
3. Send the wave (player-triggered, Bloons-style) and defend
4. Spend kill bounties + wave-clear bonuses on more production and more towers
5. Waves scale exponentially — the factory must scale to match

### Design pillars (dopamine first)
- **Immediate feedback for everything**: every placement, shot, kill, coin, and leak has instant audiovisual response (floating bounty text, particles, screenshake, synth SFX)
- **Throughput is the economy**: money buys buildings, but sustained DPS comes from belt logistics. The core tension each round: spend on towers vs. spend on production
- **Visible scarcity**: towers show ammo bars that drain per shot and go gray when starved — supply failures are legible at a glance
- **Idle satisfaction**: belts keep running between waves; watching ammo stock accumulate is the reward for good factory design
- **"One more wave" hook**: player-triggered waves, clear bonuses, next-wave preview, boss waves every 5th

## Tech Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Language | TypeScript (strict) | Type safety for entity/system data |
| Framework | Phaser 3 | Mature 2D engine, scenes, tweens, particles |
| Build | Vite | Fast HMR, zero config |
| Assets | None | All textures generated procedurally in BootScene; SFX synthesized via WebAudio |

## Commands

```bash
npm install          # install dependencies
npm run dev          # dev server (localhost:5173, hot reload)
npm run build        # production build → dist/
npm run preview      # serve production build locally
npm run typecheck    # tsc --noEmit
```

## Architecture

```
src/
  main.ts               # Phaser.Game config & bootstrap
  config.ts             # tile size, grid dims, belt speed, starting money/lives
  types.ts              # Dir, ItemType, Building, ItemEnt, Enemy interfaces
  scenes/
    BootScene.ts        # procedural texture generation, then starts game+ui
    GameScene.ts        # gameplay orchestration, input/placement, juice helpers (floatText/burst/bigText)
    UIScene.ts          # HUD overlay running in parallel (stat chips, build palette, wave button, game over)
  systems/
    GridSystem.ts       # tile grid: single source of truth for cell contents & placement rules
    ConveyorSystem.ts   # item movement on belts + machine insertion (press/tower intake)
    ProductionSystem.ts # miner & press crafting timers, belt output
    WaveSystem.ts       # spawning, enemy movement along fixed path, kills/leaks/wave-clear
    CombatSystem.ts     # tower targeting (furthest-along-path), bullets, ammo drain
  state/
    GameState.ts        # shared singleton (money/lives/wave/phase) + EventEmitter for scene comms
  data/
    map.ts              # fixed path waypoints + ore patch rectangles
    buildings.ts        # building stats & costs (belt, miner, press, tower)
    waves.ts            # wave scaling formulas (hp/count/speed/bounty, boss every 5th)
  utils/
    sfx.ts              # synthesized WebAudio blips (no audio assets)
```

## Key Design Decisions

### Fixed enemy path (Bloons-style — NOT maze/pathfinding TD)
- The route is data (`PATH_WAYPOINTS` in `data/map.ts`): axis-aligned waypoints, walked cell-by-cell to mark unbuildable path tiles
- **No A*, no path recomputation, no mazing.** Buildings can never block the path; placement on path tiles is simply rejected
- Enemies interpolate between pixel waypoints; `traveled` distance is the targeting priority ("first" = furthest along)
- Leaked enemies cost lives (bosses cost 5); 0 lives = game over
- Wave rhythm (`data/waves.ts`): every 5th wave is a **boss** wave (few/slow/tanky), every 3rd otherwise is a **swift** wave (fast/fragile/numerous, cyan) — each kind has a distinct counter, so tower composition matters
- Waves are player-sent (SPACE / button), with optional auto-send; game speed toggles ×1/×2/×3 (F) by scaling the shared `dt`

### Tile grid
- 32px tiles, 40×20 grid (1280×640 playfield + 80px UI bar = 720p canvas)
- `GridSystem` is the single source of truth for cell contents; all placement checks go through `canPlace()`
- Cell kinds: `grass` (buildable), `path` (never buildable), `ore` (miners only)

### Conveyor & machine I/O
- Each belt cell holds at most **one item**; items glide smoothly to their cell center, then hop to the next cell if free
- Machines have a facing direction (`R` rotates before placement; art points East at rotation 0):
  - **Output**: miners/presses push finished items onto the belt cell they face (blocked = they hold and retry)
  - **Input**: a belt whose direction points into a machine inserts its item (ore → press intake, ammo → tower magazine)
- Belt drag-painting places runs of belts in the current direction

### Ammo economy (the genre bridge)
- Towers have finite magazines (`ammoCap`), consume 1 ammo per shot, and are placed pre-loaded (`startAmmo`) so wave 1 flows before a factory exists
- Production tree (stats in `data/buildings.ts`):
  - Miner (ore patches only) → ore
  - Press: 1 ore → 1 ammo → **Gun Tower** (fast, single-target)
  - Forge: 2 ore → 1 shell → **Cannon** (slow, splash damage, multi-kill money bonus at 3+ kills)
- **Splitter**: belt node that round-robins items between straight/left/right outputs (skipping blocked ones); merging needs no special building — any belts pointing into the same cell merge
- Strategic intent: guns are cheap sustained DPS for bosses/normals; cannons counter swift swarms at choke points but their shells cost 2× ore — ore allocation between press and forge lines is the mid-game decision
- Balance intent: one miner+press line sustains roughly *half* a continuously-firing gun tower — players must parallelize production, and between-wave downtime refills magazines

### Systems tick order (per `GameScene.update`)
1. `WaveSystem` — spawn/move enemies, resolve leaks & wave completion
2. `ConveyorSystem` — advance items, machine insertion
3. `ProductionSystem` — miner/press crafting timers
4. `CombatSystem` — targeting, bullets, ammo drain
(dt is clamped to 50ms so tab-switching doesn't cause physics jumps)

### Scene communication
- Scenes never reference each other directly; both import the `GameState` singleton (`state/GameState.ts`)
- All cross-scene signals go through `GameState.events`: `money`/`lives`/`wave`/`phase`/`gameover` (state→UI), `ui:select`/`ui:startwave` (UI→game), `selected` (game→UI)
- `GameScene.create()` calls `GameState.reset()` and re-registers its event listeners with `.off()` first — the scene restarts on game over while `UIScene` persists

## Balancing

Numbers live in `data/buildings.ts` and `data/waves.ts` — tune there, not inline. Current curve: enemy HP ×1.22/wave, count 4+2n; boss waves (every 5th) are few/slow/tanky with 5-life leaks. When changing tower fire rate or press cycle time, keep the "one supply line ≈ half a tower" pressure.

## Roadmap (not yet built)

- More towers (slow/freeze, laser with power-based supply) and deeper recipe chains (second raw resource, smelting step)
- Underground belts for crossing lanes
- Tower upgrades purchased with manufactured goods, not money
- Ore patch depletion + prospecting
- More enemy behaviors (armored/ammo-resistant, belt-attackers that threaten the factory itself)
- Real audio, menu scene, save/load, meta-progression
