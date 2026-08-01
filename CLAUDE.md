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

## Commands

```bash
npm run dev          # dev server (localhost:5173, hot reload)
npm run build        # production build → dist/
npm run typecheck    # tsc --noEmit
npm test             # vitest (data/system logic tests)
```

## Architecture

```
src/
  main.ts               # Phaser.Game config & bootstrap
  config.ts             # tile size, grid dims, belt speed, starting money/lives
  types.ts              # Dir, ItemType, Building, ItemEnt, Enemy interfaces
  scenes/
    BootScene.ts        # procedural texture generation, then starts menu
    MenuScene.ts        # title: continue/new-run, map picker, volume, achievements, leaderboard, account/sign-in modals, 2D/3D toggle
    GameScene.ts        # gameplay orchestration, input/placement, save/restore, juice helpers (floatText/burst/bigText)
    UIScene.ts          # HUD overlay running in parallel (stat chips, build palette, wave button, toasts, help, game over)
    hudLayout.ts        # pure HUD geometry: bottom bar (grouped palette/touch pad/wave cluster), top strip, slot contents, stripHit
    keymap.ts           # pure: every keyboard shortcut as data — the one place a key is claimed
    beltFrames.ts       # pure: the belt animation's texture keys (shared by BootScene and the 3D model table)
    achievementLayout.ts # pure: paginated achievements grid — rows per page, cell positions, pager targets
  iso/                  # the 3D isometric view — mirrors the sim, never drives it
    isoMath.ts          # pure: true-isometric camera basis, frustum fitting, screen↔board projection & its exact inverse
    isoModels.ts        # pure: texture key → solid (shape/footprint/height/colour)
    IsoView.ts          # Three.js scene: terrain geometry, display-list mirror, overlay decals, bars
    isoQuality.ts       # pure: quality tier from device capability + frame-time hysteresis (no Three.js/DOM)
  systems/
    GridSystem.ts       # tile grid: single source of truth for cell contents & placement rules
    ConveyorSystem.ts   # item movement on belts + machine insertion (press/tower intake), item restore
    ProductionSystem.ts # miner & press crafting timers, belt output
    WaveSystem.ts       # spawning, enemy movement along fixed path, kills/leaks/wave-clear
    CombatSystem.ts     # tower targeting (furthest-along-path), bullets, ammo drain
    LogisticsSystem.ts  # [L] overlay: measures ammo uptime / belt load / stalls, draws the view
    beltPaint.ts        # pure: resolves a belt drag into the run of cells it lays (fills gaps, turns corners)
  state/
    GameState.ts        # shared singleton (money/lives/wave/phase) + EventEmitter for scene comms
    serialize.ts        # SaveV1 run format: pure captureRun/validateSave (versioned, strict validation)
    persistence.ts      # localStorage run slot (ftd:run) + pendingLoad handshake menu→game
    renderMode.ts       # flat vs isometric (ftd:view) — a device preference, never part of the save
    meta.ts             # Workshop wallet + owned levels (ftd:scrap/ftd:workshop), local-only
    progress.ts         # lifetime stats + unlocked achievements (ftd:stats/ftd:ach), emits 'achievement'
    mergeProgress.ts    # pure local↔cloud merge rules (run LWW, achievements union, best/scrap/node-levels max)
    saveQueue.ts        # pure single-writer queue: one cloud write in flight, newest-wins, savedAt guard
  services/             # ALL Supabase I/O lives here — pure modules never import services
    supabase.ts         # lazy client singleton (publishable key, PKCE); null if unavailable
    auth.ts             # Google OAuth / magic link / anonymous + linking, profile upsert
    cloud.ts            # fire-and-forget save/score/achievement sync, leaderboard fetch, syncOnSignIn
  data/
    combo.ts            # pure: kill-streak state, tiers, milestones, pitch — escalating feedback that pays no money
    metaTree.ts         # pure: the Workshop — ⚙ SCRAP payout, perk nodes, costs, capped effect bag
    mods.ts             # pure: run-scoped modifier bag granted by research (shared by buildings.ts + research.ts)
    research.ts         # pure: lab item values, XP curve, weighted card pool, seeded draw, modsFrom
    map.ts              # fixed path waypoints + ore/crystal patch rectangles
    buildings.ts        # building stats & costs; UPGRADE_TREE (branching Mk paths) + effStats
    waves.ts            # wave scaling formulas (hp/count/speed/bounty, boss every 5th)
    achievements.ts     # achievement defs + pure unlock logic (ids match the DB CHECK regex)
    missions.ts         # pure: the three live HUD objectives — defs, needs() gating, completion predicates, payout budget
    score.ts            # pure: end-of-run grade (reach / throughput / routing efficiency) + the advice line
  utils/
    sfx.ts              # synthesized WebAudio blips (no audio assets) + master volume/mute
```

## Key Design Decisions

### Fixed enemy path (Bloons-style — NOT maze/pathfinding TD)
- The route is data (`MapDef.waypoints` in `data/map.ts`): axis-aligned waypoints, walked cell-by-cell to mark unbuildable path tiles
- **Three layouts** live in `MAPS` (Serpentine / Horseshoe / Switchback), each carrying its own route + ore/crystal patches. `setActiveMap()` picks one *before* anything reads the board (`GameScene.create` does this first); `activeMap()`/`pathPx()`/`orePatches()`/`crystalPatches()` are the accessors. The choice is made on the title screen for fresh runs and round-trips in the save, so continuing a run always returns to its own map. A shared `describe.each` in `map.test.ts` holds every layout to the same contract (axis-aligned, connected, off-grid entry/exit, deposits on-board and off-path, crystal scarcer than ore)
- **No A*, no path recomputation, no mazing.** Buildings can never block the path; placement on path tiles is simply rejected
- Enemies interpolate between pixel waypoints; `traveled` distance is the targeting priority ("first" = furthest along)
- Leaked enemies cost lives (bosses cost 5); 0 lives = game over
- Wave rhythm (`data/waves.ts`): every 5th wave is a **boss** wave (few/slow/tanky), every 3rd otherwise is a **swift** wave (fast/fragile/numerous, cyan) — each kind has a distinct counter, so tower composition matters
- Waves are player-sent (SPACE / button), with optional auto-send; game speed toggles ×1/×2/×3 (F) by scaling the shared `dt`
- **Early-send bonus**: `GameState.buildElapsed` ticks through the build phase; `earlySendBonus(wave, secondsWaited)` pays half a clear bonus at an instant send, decaying to zero over `EARLY_SEND_WINDOW` (25s). The live figure ticks down inside the SEND WAVE button — spend the time on production or bank the cash
- **Wave report card**: `GameState.tally` (a `WaveTally`, reset at wave start) counts kills, leaks, income, rounds fired, and rounds produced; systems increment it as they go and `completeWave` emits `wavesummary` for UIScene to render. Sell refunds pass `addMoney(n, false)` so recycled capital never counts as wave income. `fired` vs `produced` is the headline number and the seed of the logistics overlay

### Tile grid
- 32px tiles, 40×20 grid (1280×640 playfield + 80px UI bar = 720p canvas)
- `GridSystem` is the single source of truth for cell contents; all placement checks go through `canPlace()`
- Cell kinds: `grass` (buildable), `path` (never buildable), `ore` / `crystal` (the two miner-only resource kinds — `minedResource()` maps a cell kind to the item a miner on it digs)
- **Deposits are finite and mutable**: every resource cell carries `reserves` (~9 minutes of mining per tile); `extract()` spends one unit and flips the cell back to `grass` when it hits zero, `addPatch()` reveals prospected ground at a site the player picks in survey mode. The terrain is therefore drawn in two layers — a static ground/path layer and `oreLayer`, repainted on a 1s cadence (or immediately on depletion/survey) with tile richness fading as reserves drop
- `canRestore()` is the deliberately looser rule used when loading a save: a miner whose tile ran dry mid-run comes back as a visible dead miner rather than being silently deleted

### Conveyor & machine I/O
- Each belt cell holds at most **one item**; items glide smoothly to their cell center, then hop to the next cell if free
- Machines have a facing direction (`R` rotates before placement; art points East at rotation 0):
  - **Output**: miners/presses push finished items onto the belt cell they face (blocked = they hold and retry)
  - **Input**: a belt whose direction points into a machine inserts its item (ore → press intake, ammo → tower magazine)
- Belt drag-painting follows the drag: `beltPaint.beltRun` fills every cell between pointer samples and aims each belt at the next, so a stroke that turns a corner lays a working corner. Clicking a placed belt/machine (or `R` over it) turns it in place

### Production chain (`ore → ammo → everything`)

Only the **press** eats raw ore. Forge (2 ammo → shell), assembler (2 ammo + 1 crystal → piercing) and chiller (1 ammo → 2 coolant) all run on the ammo it makes. That single intermediate is what turns four independent converters into a factory: presses are a contested backbone, **splitters finally have a real job** routing ammo between the guns and the deeper lines, and a press shortage cascades.

- Ore cost per output is **identical** to the old flat graph (`oreCost`/`crystalCost` in `buildings.ts` resolve the chain and are test-pinned at ammo 1 / shell 2 / piercing 2 / coolant 0.5). The topology moved; the difficulty curve did not.
- Recipes are a `Partial<Record<ItemType, number>>` map (`MachineStats.inputs`), and machines buffer **per item type** (`Building.inputs`). `recipeNeeds(machine, item)` remains the single answer to "does this machine accept this item", used by belt intake and the tests alike.
- Onboarding is unaffected: the first line a player builds is still `ore → press → gun`, two buildings. Depth is opt-in per tower type.

### Research: the Lab and the level-up draw

A **Lab** consumes finished goods (never raw ore — research must always cost you ammo) and banks research. Each level pauses the game and offers **one of three** cards, which stack as run-scoped `Mods`.

- `data/research.ts` is pure: item values, `researchForLevel` (the single dial for how often the draw interrupts), a weighted `CARDS` pool with `needs()` predicates so no card is offered with nothing to improve, and a seeded `draw()`.
- `modsFrom(taken)` rebuilds the whole modifier bag from the taken-card counts, so mods are never applied incrementally and the save only stores counts. It clamps past each card's `max`, so a tampered save can't stack forever.
- Mods reach the sim only where stats are already resolved: `effStats(type, mk, path, mods)` for combat (still pure — `NO_MODS` is the default so every existing caller is unchanged), belt speed in `ConveyorSystem`, cycle times in `ProductionSystem`, clear payout in `WaveSystem`.
- `GameState.awaitingCard` freezes the sim without being a user pause: `GameState.frozen` is what systems check, `togglePause` refuses while a draw is pending, and `select()`/`tryUpgrade()` ignore hotkeys so "1" picks a card rather than also selecting a belt behind the modal.

### Ammo economy (the genre bridge)
- Towers have finite magazines (`ammoCap`), consume 1 ammo per shot, and are placed pre-loaded (`startAmmo`) so wave 1 flows before a factory exists
- Production tree (stats in `data/buildings.ts`):
  - Miner (resource patches only) → ore, or crystal on crystal tiles — **one building, two resources**: the tile decides the item and the cycle (`minerCycle`, crystal is ~1.7× slower)
  - Press: 1 ore → 1 ammo → **Gun Tower** (fast, single-target)
  - Forge: 2 ore → 1 shell → **Cannon** (slow, splash damage, multi-kill money bonus at 3+ kills)
  - Assembler: 2 ore + **1 crystal** → 1 piercing round → **Lancer** (tier-2; see below)
  - Chiller: 1 ore → **2** coolant (`outputPer`) → **Cryo field** (support; see below)
- **Two raw resources**: crystal patches are small, few, and deliberately placed away from ore (`CRYSTAL_PATCHES` in `data/map.ts`), so a piercing line has to belt two inputs in from different pockets. Machines declare their recipe as `oreIn`/`crystalIn` and buffer each input separately (`Building.inputOre`/`inputCrystal`, capped per type); `recipeNeeds(machine, item)` is the single answer to "does this machine accept this item", used by both belt intake and the tests
- **Lancer / piercing rounds** (tier-2): the lance locks its heading at fire time and keeps flying, skewering up to `pierce` enemies before dissipating — devastating aimed down a straight leg of a single-file path, and it ignores armor. `CombatSystem` splits projectiles into `HomingBullet` (guns/cannons) and `LanceBullet`; the lance uses a **swept segment test** (not an endpoint check) because at ×3 speed it covers >100px per tick, and resolves hits nearest-first so a limited pierce budget is spent on the front of the column. 3+ kills in one lance pays a SKEWER bonus
- **Splitter**: belt node that round-robins items between straight/left/right outputs (skipping blocked ones); merging needs no special building — any belts pointing into the same cell merge
- **Tunnel**: items dive underground and surface at the next tunnel with the same facing within 4 tiles (rendered at low alpha in transit); crosses the enemy path, other belts, anything. An unpaired tunnel degrades to plain-belt behavior
- **Cryo field / coolant** (support): the only tower with `damage: 0` — `isSupport()` and `DAMAGE_TOWERS` exist so combat and the tests treat it as a multiplier rather than a weapon. It pulses only when something is in range (an idle field never drains the tank), chilling every enemy to `slowFactor` of normal speed for `slowDur`. `WaveSystem.chill` refuses to let a weaker pulse overwrite a stronger one and keeps the longer timer, so overlapping fields cooperate; `MIN_SLOW_FACTOR` guarantees enemies always keep walking. More seconds under fire is more damage *without* more ammo — that's the choke-point payoff
- **Upgrades are earned, not just bought**: every tier costs money *and* the tower's full magazine *and* a threshold of `Building.fed` — rounds the factory has actually delivered there over the run (`fedRequired`, scaled by magazine size so a slow 6-round lancer isn't punished next to a fast 15-round gun). A full magazine alone rewarded patience; this rewards logistics
- **Tower upgrades (branching tree)**: click a tower → upgrade panel. Mk1→Mk2 is shared; at Mk3 the tower picks a specialization path (guns: **Sniper** dmg/range vs **Gatling** fire rate; cannons: **Siege** splash/dmg vs **Flak** rate; lancers: **Railgun** dmg/range vs **Volley** rate/pierce) with a Mk4 tier each (`UPGRADE_TREE`/`effStats(type, mk, path)` in `data/buildings.ts`, `MAX_MK = 4`). Each tier costs money + the tower's *full loaded magazine* — the factory arms the upgrade. Combat always reads `effStats`, never `TOWERS` directly; `Building.path` holds the choice; pips are path-colored
- **Achievements & meta progression**: lifetime stats tracked in `state/progress.ts` (hooks in WaveSystem/CombatSystem/GameScene), defs + pure unlock logic in `data/achievements.ts` (15 defs). Unlocks grant capped perks (≤ $100 total starting-money bonus, test-enforced) applied to fresh runs; toasts slide in top-right (UIScene)
- **Resistances**: armored enemies take 25% damage from bullets, 100% from shells and piercing rounds (`resistMult`) — the wave preview + tower mix read is the core strategic decision
- Strategic intent: guns are cheap sustained DPS for bosses/normals; cannons counter swift swarms at choke points but their shells cost 2× ore; lancers answer armored columns but consume the scarce crystal — ore/crystal allocation between press, forge, and assembler lines is the mid-game decision
- Balance intent: one miner+press line sustains roughly *half* a continuously-firing gun tower, and one assembler line (1 ore miner + 1 crystal miner) sustains roughly *half* a lancer — the same pressure at both tiers. Players must parallelize production, and between-wave downtime refills magazines

### Systems tick order (per `GameScene.update`)
1. `WaveSystem` — spawn/move enemies, resolve leaks & wave completion
2. `ConveyorSystem` — advance items, machine insertion
3. `ProductionSystem` — miner/press crafting timers
4. `CombatSystem` — targeting, bullets, ammo drain
5. `LogisticsSystem` — reads the settled tick (never mutates the sim), accumulates overlay telemetry, draws it when enabled
(dt is clamped to 50ms so tab-switching doesn't cause physics jumps)

**Stall reporting**: each system sets `Building.stalled` where it already knows the answer — ConveyorSystem when a resting item fails every transfer, ProductionSystem when a machine is short an input or its output is backed up. `LogisticsSystem` only reads those flags (and derives belt idleness from `item` so a stale flag can't lie), which is why the overlay costs the simulation nothing

### The 3D isometric view (`src/iso/`)

The isometric build is **the same game, not a fork**. Nothing in `src/systems` or `src/data` knows it exists, and the simulation is byte-for-byte identical in both views — which is the whole reason it can be toggled mid-wave (`V` in game, or the VIEW chip on the title screen; persisted in `ftd:view`).

- **It mirrors the display list.** Every frame `IsoView.render` walks `GameScene.children.list` and extrudes what it finds: a sprite's texture key is looked up in `isoModels.ts` and becomes a solid at the same board coordinates. Belts, machines, towers, barrels, enemies, items, projectiles and the build ghost all appear in 3D *because the 2D game drew them*, with no per-entity wiring to keep in sync. Belt lids even animate for free — each frame of the chevron loop is its own texture key, so the mirror picks it up.
- **Phaser's canvas goes transparent and stacks on top** (`transparent: true` in `main.ts`). The flat world is hidden with `Camera.ignore`'s bitmask rather than `visible` flags, so code elsewhere stays free to show and hide things for its own reasons. Text and Containers are deliberately *not* masked: the HUD, the upgrade panel, the wave banner and floating bounties keep rendering above the 3D world, unchanged.
- **Two things are rebuilt rather than mirrored**, because mirroring them would be worse:
  - *terrain* — grass becomes instanced slabs standing proud of a sunken road, so the unbuildable path reads as a canyon; deposits become rock clusters that visibly thin as reserves drain (`syncTerrain`, same 1s cadence as the 2D ore layer);
  - *bars and pips* — a 2D bar is placed by a **screen-space** offset ("16px above the enemy"), and an isometric camera turns any such offset into a shove sideways. Given the entity, `syncBars` puts them directly overhead.
- **Anything anchored to a place on the board but drawn as Phaser Text must be projected** on the way in — `GameScene.project` and `LogisticsSystem.project` do this. That is why `floatText` takes *board* coordinates and projects them itself; the drift upwards afterwards is screen space in both views, which is what a floating number should do.
- **`isoMath.ts` is pure and the camera is built from it**, not alongside it. `screenToBoard` is an exact algebraic inverse of the projection (orthographic, so there is no perspective divide) rather than a raycast, and the test suite round-trips all 800 cell centres through screen space. If picking and drawing ever disagree, one of them stopped using this module.
- **`overlayCell` in `LogisticsSystem` is shared**: the flat view paints it with a Graphics, the isometric one lays the same colours on the ground as decals. Neither view owns the meaning of "amber outline" — add a rule there and both gain it.
- Three.js is **dynamically imported**, so it lands in its own chunk (~137KB gzipped) and a player who never asks for 3D never downloads it. Every read of `this.iso` is guarded, so the 2D game is fully playable while that chunk is in flight, and a WebGL failure falls back to flat rather than breaking the run.

### Scene communication
- Scenes never reference each other directly; both import the `GameState` singleton (`state/GameState.ts`)
- All cross-scene signals go through `GameState.events`: `money`/`lives`/`wave`/`phase`/`gameover` (state→UI), `ui:select`/`ui:startwave` (UI→game), `selected` (game→UI), `achievement` (progress→UI toast)
- Flow: Boot → Menu → (launch ui, start game). `GameScene.create()` calls `GameState.reset()` and re-registers listeners — blanket `.off()` only for events it alone consumes, targeted `.off(event, fn)` with stable arrow-property refs for shared events (`phase`, `gameover`). **UIScene sleeps, never stops** (menu button) so its plain `.on` listeners register exactly once

### HUD geometry & the categorised build bar
- **All HUD geometry is pure and tested** (`scenes/hudLayout.ts` + `hudLayout.test.ts`): the bottom bar (`hudLayout`), the top status strip (`topStrip`), and what goes *inside* one palette slot (`slotContent`). Never hardcode a control position in UIScene — overlapping buttons are invisible in review and obvious in a test, and the tests run the layout at the four screen shapes the game actually has to survive (16:9 desktop, iPad, phone landscape, boxy tablet)
- The palette is split into **three labelled shelves** — `BUILD_CATEGORIES` in `data/buildings.ts`: LOGISTICS (blue) / PRODUCTION (orange) / DEFENSE (red). Guns and factory equipment are bought for opposite reasons — one spends throughput, the other builds it — so they are separate blocks with coloured headers and matching slot rims, not one strip of thirteen lookalikes. `BUILD_INFO` **must stay sorted by category** (test-pinned): the bar draws each group as one contiguous block sized by `buildGroupSizes()`
- **Hotkeys follow the same split**: the number row (1–9) is the factory, `Z X C V` the guns. `GameScene` binds them straight off `BUILD_INFO`, so a key can never drift from the badge drawn on its slot
- Selecting the armed slot again cancels it — on touch there is no ESC and no right-click, so that toggle is the only way out of build mode
- `[?]` in the top strip (or `H`) opens an in-game controls & building reference. On touch the tapped slot's description also stays on the hint line, because there is no hover tooltip
- Compact bars quote no keyboard shortcuts and grow no hotkey badges; the touch bar additionally gets the rotate/sell/pause pad that stands in for `R`/right-click/`P`
- **The top strip floats over the playfield, so the board must ignore it.** `stripHit` (pure, in `hudLayout.ts`) answers "is this point on a clickable chip", and `GameScene.overHud` consults it alongside the upgrade panel. Without it, arming a building and then reaching for SURVEY / `?` / mute / the view chip *also* planted that building on the tile underneath. Only the interactive chips are shielded — the money/lives/wave readouts and the map name are labels, and shielding those would carve two unbuildable rows off the top of the board

### Keybindings are data (`scenes/keymap.ts`)

Every non-palette shortcut lives in one exported list, and `keymap.test.ts` fails if any Phaser key is claimed twice across `KEYS` **and** `BUILD_INFO`.

This exists because hand-written `kb.on('keydown-X', …)` calls spread over two scenes have no way to notice a collision: the isometric view toggle was bound to `V` while `V` was already the cryo tower, Phaser happily registered both listeners, and one press armed a $160 tower *and* flipped the renderer — so the next board click planted a tower nobody asked for. The view toggle is now `G`; **`ZXCV` stays the four guns under one hand and a renderer toggle does not get to break that.**

- UI strings read their keys through `key(action)`, so a rebind can never leave the help modal, the hint line or the SEND WAVE button quoting a stale letter
- `ESC` is deliberately shared (GameScene clears the build selection, UIScene closes help) — both firing is correct, so it is listed once
- The card draw's `1`/`2`/`3` are *not* a collision: `GameState.awaitingCard` makes `select()` ignore hotkeys, so a number picks a card rather than also arming a building behind the modal

### The 2D/3D toggle is a HUD chip, not just a key

The isometric view was reachable in-game only by keyboard, which meant it was unreachable on a phone. It is now a chip in the top strip next to `?` and `♪` (`topStrip.view`, test-pinned to a 44px finger target on touch). GameScene still owns the renderer — the chip only emits `ui:view` — and `toggleIso` broadcasts a `view` event that the chip mirrors, so a WebGL failure that falls back to flat cannot leave the chip reading 3D.

### Kill streaks (`data/combo.ts`) — escalation that pays nothing

Every kill already had immediate feedback, but the hundredth kill of a wave felt exactly like the first. The streak supplies the missing *escalation*: consecutive kills inside a 2.6s window raise a tier that warms the bounty text, climbs the coin blip's pitch (capped — an uncapped ramp becomes a dog whistle on a swift wave), and fires a sparse, widening milestone banner.

- **It deliberately pays no money.** Throughput is the economy; a streak bonus would be combat skill funding the factory and would soften the income-vs-threat invariants in `waves.test.ts`. `combo.test.ts` pins that the state is exactly `{count, best, last}` and that the module exports nothing payout-shaped, so a future caller can't quietly start cashing it
- **A leak breaks it.** That is what makes it a factory mechanic rather than an aim mechanic: the only way to hold a streak is to keep every tower fed
- **It carries its own clock** (`comboNow`, monotonic). Kills are stamped in WaveSystem (GameScene's clock) but expiry is noticed by the meter in UIScene, and those are different Phaser clocks — UIScene only sleeps while GameScene is restarted outright on REBUILD, so a scene clock would make every streak look stale after one restart
- Never serialized: it is a moment-to-moment feel mechanic worth nothing, so restoring mid-streak would be meaningless

### The Workshop: ⚙ SCRAP and permanent progression

A second currency, **SCRAP**, is paid out at the end of every run and spent between runs in the **WORKSHOP** on the title screen. Rules are pure in `data/metaTree.ts`; the wallet and owned levels live in `state/meta.ts` (localStorage `ftd:scrap` / `ftd:workshop`) — the same pure/storage split as `achievements.ts` / `progress.ts`.

- **It buys throughput, not skins.** Cosmetics are dopamine with no strategy, and the pillar is that throughput *is* the economy — so the tree is weighted to LOGISTICS and PRODUCTION. DEFENSE is deliberately the thinnest branch (test-pinned): combat power is what the in-run research draw and the Mk tree already sell
- **Everything is capped, and the caps are tested.** The difficulty curve is load-bearing (the throughput wall at wave ~33 is on purpose) and unbounded meta progression is exactly what deletes it. `metaTree.test.ts` pins the fully-bought totals *and* checks the combined opening against the achievements' own $100 cap. **Two systems must never both grant starting money** — that is why `not_a_drop` is a badge: the Workshop's Seed Capital is now the only place start money is bought
- `effectsFrom(owned)` rebuilds the whole bag from levels, never incrementally, and `levelsOf` clamps to each node's `max` — so a tampered `ftd:workshop` cannot overstack, exactly like `modsFrom` for research
- Mods fold in *underneath* research picks: `modsFrom(taken, base)` seeds the bag from the Workshop so the two stack multiplicatively rather than one clobbering the other
- **A restored save re-applies the mods but not the money or lives** (`GameScene` passes `startMoney: 0, startLives: 0`) — the save already banked those, and granting them again on every load would pay out forever
- `scrapEarned` is dominated by waves survived, and **always pays at least 1**: a currency that can pay zero teaches players a bad run was wasted time. Pacing is test-pinned at 10–60 good runs to max the tree

### Save/resume & cloud sync
- `state/serialize.ts` is the contract: pure `captureRun`/`validateSave`, versioned (`SAVE_VERSION`, currently **2**); saves happen only in build phase so enemies/bullets never serialize. Never trust stored/cloud JSON — everything re-validates through `validateSave`
- **v1 saves still load.** `migrateV1` drops machine input buffers, because a v1 forge banked raw ore its v2 recipe will never consume — carrying it across would restore a permanently stalled machine. That is exactly the "restores *wrong* rather than incomplete" case that justifies a version bump instead of an optional field
- New state is added as *optional* fields (`mk`, `path`, `inCry`, `surveys`, `patches`, `tiles`, …) so older saves keep validating and restore with sensible defaults; bump `v` only for a change that would make an old save restore *wrong* rather than incomplete
- The map is now run state too: `patches` (prospected) and `tiles` (only deposits whose reserves changed) round-trip through the save, and terrain is restored *before* buildings so placements are validated against the map as it actually was
- Autosave: on every return to build phase (wave-clear checkpoint), debounced 1s on build edits, `beforeunload` flush; run slot cleared on game over. `GameScene.ready` guards against saving during `create()` event bursts
- localStorage (`ftd:run`) is ALWAYS the primary store; cloud (`services/cloud.ts`) is a best-effort mirror for signed-in players — every cloud call is fire-and-forget and a paused/blocked Supabase degrades to the guest experience
- Purity rule for tests: `serialize.ts`/`mergeProgress.ts`/`data/achievements.ts` must never import services or Phaser-dependent modules; services import pure modules, never the reverse

### Supabase backend (project `ksxkenxpidatyqraaffn`)
- Tables (all RLS, own-row write): `profiles` (public-read names), `saves` (single jsonb slot, 256KB CHECK), `scores` + `leaderboard` view (public read; restrictive `is_anonymous` policy keeps anonymous accounts off the board; BEFORE UPDATE trigger makes `best_wave` monotonic), `achievements` (id CHECK mirrors the client regex `^[a-z0-9_]{1,40}$`)
- New public tables are NOT auto-exposed to the Data API (2026-04 change) — migrations must include explicit `GRANT`s to `anon`/`authenticated`
- Auth: Google OAuth + email magic link + anonymous (upgradeable via `linkIdentity`/`updateUser`); PKCE, `redirectTo = origin + pathname`. Sign-in only from MenuScene — OAuth navigates away
- Merge on sign-in (`syncOnSignIn`): newest run save wins (LWW on `savedAt`), achievements set-union, best wave max — pure rules in `state/mergeProgress.ts`
- Maintenance note: anonymous users are never auto-deleted; prune periodically with `delete from auth.users where is_anonymous is true and created_at < now() - interval '30 days';`
- Known advisor WARN (accepted false-positive): `auth_rls_initplan` on the two restrictive scores policies — they already use the documented `(select auth.jwt()...)` form and are verified to block anonymous writes

## Balancing

Numbers live in `data/buildings.ts`, `data/waves.ts` and `data/map.ts` — tune there, not inline. When changing tower fire rate or press/assembler cycle time, keep the "one supply line ≈ half a tower" pressure at *both* tiers — `npm test` enforces that invariant plus the wave rhythm, resistances, crystal scarcity, recipe intake, and conveyor rules (`*.test.ts` next to each module), so run it after tuning. A PostToolUse hook (`.claude/settings.json` → `scripts/typecheck-hook.mjs`) typechecks after every TS edit.

### The difficulty curve, and why it is shaped this way

Tower damage does **not** compound forever — the upgrade tree stops at Mk4, so past that the only way to add DPS is to add production, which is bounded by ore throughput and by how many tiles the map has. Against unbounded exponential HP that ceiling gets hit and every wave after it is arithmetically unwinnable. Three knobs keep the run inside its own ceiling:

- **HP tapers** (`HP_TAPER_AT = 18`): waves 1–18 compound at the original `EARLY_GROWTH` 1.22 — that ramp *is* the early-game arc and must not move — then ease to `LATE_GROWTH` 1.12. Wave 20 is ~92% of the old curve (mid-game preserved); wave 30 is ~39%.
- **Bounty tracks HP** (`BOUNTY_PER_HP`): `baseBounty` keeps the flat `5 + n` for the opening waves and switches to an HP-linked rate around wave 13. Previously income was linear against exponential HP, so money per point of enemy HP collapsed ~40× between wave 5 and 30 and the factory could never be scaled to match. **Money is deliberately generous late — the intended late-game constraint is ore throughput and tile space, not the wallet.**
- **The ore economy has to last**: `RESERVES` is 9 minutes of mining per tile (was 3, which meant a tile died every three waves and the late game was nothing but replacing miners), and `PROSPECT_GROWTH` is 1.3 (was 1.5, where the tenth survey cost more than a whole run earned).

Result, verified by modelling the shipped modules against a maximal factory: the throughput wall lands at **wave ~33**, and the squeeze is gradual (supply-vs-demand ratio drifts 4.0 → 1.0 across waves 13–33) rather than a cliff. An average factory stalls around 15–20. The wave 10/20/30 achievement ladder is reachable again.

If you retune, the load-bearing tests are in `waves.test.ts`: the early ramp must stay on the original curve, growth must never exceed `EARLY_GROWTH` past the taper, wave 20 must stay ≥85% of the old curve, and income growth must keep pace with threat growth.

## Release Roadmap (tracked — update status here as each lands)

Ranked for fun/strategy impact. Mark `[x]` with a one-line note when shipped.

1. `[x]` **Tower upgrades paid in manufactured goods** — shipped, then extended to a branching tree: shared Mk2, path choice at Mk3 (sniper/gatling, siege/flak), Mk4 caps (`UPGRADE_TREE`/`effStats` in `data/buildings.ts`); sell refunds half of total invested
2. `[x]` **Armor/resistance enemy types** — shipped: armored waves (even waves from 6 that aren't swift/boss) take 25% bullet damage, full shell damage (`resistMult` in `data/waves.ts`); resisted hits flash steel-gray
3. `[x]` **Underground belts** — shipped: Tunnel building; items dive to the next tunnel with the same facing within 4 tiles (crosses path/buildings), falls back to belt behavior if unpaired
4. `[x]` **Second raw resource + tier-2 recipes** — shipped: crystal patches mined by the same miner (slower cycle), Assembler (2 ore + 1 crystal → piercing round), Lancer tower whose lance skewers a column and ignores armor, with railgun/volley upgrade paths
5. `[x]` **Early-send bonus + wave summary** — shipped: `earlySendBonus` decays linearly over a 25s build window (live counter inside the SEND WAVE button), and a wave-clear report card shows kills/leaks, income, and ammo fired vs produced with a warning when the factory ran a deficit
6. `[x]` **Logistics overlay** — shipped: `[L]` toggles `LogisticsSystem`'s view — per-tower ammo uptime % + magazine bar, belt tiles shaded by throughput (red when jammed), starved/backed-up producers pulsing orange
7. `[x]` **Slow/coolant tower** — shipped: Chiller (1 ore → **2** coolant, the cheapest line in the game) feeds the Cryo field, a damageless support tower that pulses an area slow (cryostasis/blizzard paths). Slows never stack into a freeze (`MIN_SLOW_FACTOR`) and a weak pulse can't undo a strong one
8. `[x]` **Ore patch depletion + prospecting** — shipped: every resource tile holds finite `RESERVES`, thins visibly as it is mined, and reverts to grass when spent (the miner on it becomes a dead statue); `⛏ SURVEY` reveals a fresh patch on clear ground for a cost that grows 1.5× per survey, alternating ore/crystal
9. `[x]` **Save/load + best-wave record** — shipped and exceeded: full mid-run save/resume (localStorage + cloud sync when signed in), personal best on game over + menu
10. `[x]` **Map variety + presentation pass** — shipped: three layouts (Serpentine / Horseshoe / Switchback) chosen on the title screen and saved with the run, plus a 10-segment master volume in the menu and the active map named in the HUD
11. `[x]` **Accounts, leaderboard, achievements** — shipped: optional Supabase accounts (Google/magic link/anonymous-upgradeable), cross-device saves, public best-wave leaderboard, 15 achievements with capped starting-money perks

**The ranked roadmap above is complete.** Future work starts from playtest feedback, not this list — when adding to it, keep the same format (rank by fun/strategy impact, mark `[x]` with a one-line note on what actually shipped).

## Post-roadmap batch: playability audit

12. `[x]` **Difficulty/economy rebalance** — shipped: see "The difficulty curve" above. The wall moved from ~wave 20 (where it was unwinnable *arithmetically*, not by skill) to ~33
13. `[x]` **Belt drag that behaves like a conveyor** — shipped: `systems/beltPaint.ts` resolves a drag into an L-shaped run, filling cells a fast flick skipped and aiming each belt at the next. Only belts laid in the current stroke are re-aimed, so dragging across the factory can never re-plumb an existing line
14. `[x]` **Targeted prospecting** — shipped: `⛏ SURVEY` arms a mode and the player clicks the site (footprint ghost, green/red validity); money is only taken on commit. It used to drop the patch on a random clear tile
15. `[x]` **Rotate in place** — shipped: clicking a placed belt/machine turns it, and `R` turns whatever is under the cursor (Factorio's rule). Re-aiming used to mean selling and rebuilding. The **scroll wheel** now turns the same thing and turns it *back*, which `R` cannot — both go through `rotateAt`, so the two input paths can never disagree about what is under the cursor
16. `[x]` **How to play** — shipped: a five-step modal on the title screen. Onboarding was a four-line hint that faded after 14s
17. `[x]` **Per-ammo-type wave report** — shipped: the report card judges supply per ammo type and names the starved line. Grand totals let a chiller's 2-coolant-per-ore hide a starving gun line behind a healthy-looking sum
18. `[x]` **Presentation** — shipped: belts run a scrolling chevron loop (all belts share one animation, started on a random frame), enemies rotate to their heading and carry a nose, guns recoil and flash from a fixed pool, swift enemies went teal so they can't be mistaken for the near-white frost tint
20. `[x]` **Full production chain** — shipped: everything past the press runs on ammo, at unchanged ore cost per output. See "Production chain" above. Save format → v2 with a v1 migration
21. `[x]` **Lab + research + level-up draw** — shipped: belt finished goods into a Lab, pick 1 of 3 stacking upgrades per level. See "Research" above
22. `[x]` **The Workshop: the permanent between-runs tree** — shipped as ⚙ SCRAP + a 10-node perk tree on the title screen (`state/meta.ts` + pure `data/metaTree.ts`, localStorage-only). See "The Workshop" above. Cloud sync would still need a `jsonb` column on `profiles` and a merge rule (max per node) in `mergeProgress.ts`
23. `[x]` **Achievements expansion** — shipped: 15 → 28. The new batch rewards playing like a factory engineer (rebuild-in-place, flawless waves, draining deposits, biggest factory, research level) rather than only accumulating kills, plus a tiered streak ladder off `data/combo.ts`. The modal that shows them is paginated as of 31 (`scenes/achievementLayout.ts`), so the roster can grow past 28 without the list outgrowing the panel
24. `[x]` **In-run mission cards** — shipped: three live objectives in the HUD, pure defs + predicates in `data/missions.ts` (the `achievements.ts` shape: data plus pure logic). **Payouts are ~6% of the offering wave's gross income each**, so all three at once is under 18% — missions are a nudge, never a second economy, because the pillar is that throughput *is* the economy. `needs()` gates them exactly as the research draw does, so a wave-1 player is never shown "build 12 machines". A card drawn mid-wave starts counting from the *next* wave, or stale tally values would complete it instantly. Deliberately **not serialized**, for the same reason the kill streak isn't: run-scoped chrome with no factory state, so a restored run simply draws fresh
25. `[x]` **End-of-run score card** — shipped: pure `data/score.ts` grades reach (exponential, so wave 30 isn't twice wave 15), throughput and routing efficiency into a tier plus the numbers that justify it, and names the single thing to fix. Efficiency is `(delivered + toLab) / produced` — output that reached a gun *or* a Lab was useful; output that reached neither is the routing failure worth naming

26. `[x]` **UI audit: categorised build bar, mobile ergonomics, frame-cost pass** — shipped:
    - the palette is three labelled shelves (LOGISTICS / PRODUCTION / DEFENSE) with category-coloured rims and matching hotkey halves — see "HUD geometry & the categorised build bar"; the top status strip and per-slot content joined the pure, tested layout module
    - touch: finger-sized help/mute/survey chips (they were 16px glyphs on a canvas the phone scales *down*), a 1.4× upgrade panel, tap-the-slot-again to cancel, the tapped building's description pinned to the hint line, and no keyboard shortcuts quoted anywhere
    - fixed: `SEND WAVE [SPC]` re-stamped over the touch label on every phase change; the two-line wave preview spilling over the send button on the 80px bar; achievement toasts sliding in over the upgrade panel; the intro hint running through the status strip; the logistics legend doing the same
    - frame cost: `effStats` memoised per Mods bag (it ran per tower per frame), particle emitters and the enemy hit-flash pooled instead of allocating an emitter and a `delayedCall` per kill/hit, recipe input lists resolved once, enemy list compacted only when something died, and tower tint / logistics labels written only on change
27. `[x]` **3D isometric view** — shipped: a true-isometric Three.js renderer that mirrors GameScene's display list instead of forking the game, so the simulation is untouched and the view toggles mid-run (`G`, the 2D/3D chip in the HUD, or the VIEW chip on the title screen). See "The 3D isometric view" above. Terrain and bars are rebuilt rather than mirrored; the `[L]` overlay's colours are now a shared pure function (`overlayCell`) both views draw from
19. `[x]` **Bugs & perf** — shipped: the upgrade panel no longer closes itself when clicked (Phaser fires GameObject handlers *and then* the scene-level `pointerdown` regardless — guard the panel bounds); the build ghost updates while paused; ambient SFX are voice-gated and floating text is capped, so a 100-kill swift wave at ×3 speed no longer asks for ~100 oscillators a second; costly buildings confirm before selling
28. `[x]` **Input-collision audit + kill streaks** — shipped:
    - `scenes/keymap.ts` makes every shortcut data and test-pins that no key is claimed twice; fixed `V` arming the cryo tower *and* toggling the 3D view (the view toggle is now `G`). See "Keybindings are data"
    - fixed the top strip double-acting as the board: with a building armed, tapping SURVEY / `?` / mute planted it on the tile underneath (`stripHit` + `GameScene.overHud`)
    - the 2D/3D toggle is now a HUD chip, so the isometric view is reachable on touch at all
    - `data/combo.ts`: kill streaks that escalate colour, pitch and milestone banners and pay nothing. See "Kill streaks"
    - silenced the `PCFSoftShadowMap` deprecation warning Three.js logged on every boot
29. `[x]` **Workshop, expanded achievements, wheel-rotate, themed title screen** — shipped:
    - ⚙ SCRAP + the WORKSHOP perk tree (see "The Workshop"); the game-over card counts the payout up, which is the "one more run" hook
    - achievements 15 → 28, including the streak ladder and rebuild-in-place; `not_a_drop` is a badge because the Workshop now owns starting money
    - the scroll wheel rotated (and un-rotated) whatever `R` would — **superseded in 31**, where an accidental trackpad scroll turned out to be able to re-plumb a live factory
    - **the title screen dresses itself as the selected renderer**: 2D CLASSIC gets the flat tile grid and the prop row, 3D ISOMETRIC gets a ground lattice and extruded solids projected through `isoMath.toView` — the game's real camera basis, so the menu sits at the same angle as the board. Toggling re-dresses the screen live. Backdrop is depth −1 over a −2 background, because it is rebuilt on toggle and cannot rely on insertion order
31. `[x]` **Audit pass: correctness, timing, save integrity, input safety** — shipped. Each item below was a confirmed defect, not a style preference:
    - **"NEW PERSONAL BEST" could never fire.** `WaveSystem.completeWave` bumps `bestWave` *after* `nextWave()`, so by game over the stat already equalled the wave the player died on and `wave > prevBest` was always false — the card never showed and its 25-scrap bonus was never paid. `GameState.bestWaveAtStart` freezes the score to beat once, in `GameScene.create`. It is also listener-order independent, which the old reading of the live stat was not
    - **Producers discarded their timer overshoot** (`timer = 0` on completion, `spawnTimer = interval`), so a cycle cost `ceil(cycle / dt)` frames instead of `cycle` seconds and throughput tracked the display refresh. Now `timer -= cycle` / `spawnTimer += interval`, with a bounded catch-up loop for spawns. **Two things about this bug are worth keeping in mind if you retune:** the shipped cycle times (1.5s, 1.0s) divide exactly into every round frame length, so at an idealised fixed frame rate the loss really was zero — it only appears under *jittered* frames (i.e. always, in reality) and it bites hardest once a speed mod makes the effective cycle a non-round number. `timing.test.ts` drives seeded-jitter frames at 144/60/30fps × speed 1–3 with a mod applied, and measured 4% throughput loss at 30fps ×3 before the fix. A blocked producer clamps at one finished unit so it can never bank a backlog and flood the belt when it clears
    - **`MAX_DT` is now a named constant** in `config.ts`, and its doc says the thing that caught a bug in the fix itself: the clamp is applied *before* the speed multiplier, so systems receive dt up to `MAX_DT × 3`. Anything bounding a value by "one frame" must use the dt it was handed, never `MAX_DT`
    - **Save validation accepted values that crash or corrupt on restore.** `inGrid` only checked `Number.isFinite`, so `x: 1.5` validated and then indexed nothing; `path` was checked against the *global* id list, so a cannon carrying `'sniper'` passed and then made `pathOf`'s `.find(...)!` return undefined the moment stats resolved. Coordinates, marks and counters are integers now; a path must belong to its own tower's tree; ammo is capped by that tower's magazine and buffers by that machine's caps; items must rest on a belt-like cell that exists, one per cell, on the board. **The output-buffer cap is `outputCap + outputPer - 1`, not `outputCap`** — a chiller (cap 4, 2 per cycle) legitimately finishes holding 5, and the obvious rule would have rejected real saves and deleted runs
    - **Multi-kill bonuses never reached `moneyEarned`**, undercounting the Tycoon achievement; the research cash card had the same gap
    - **Plain wheel rotated whatever was under the cursor.** A trackpad two-finger scroll is a wheel event, so drifting across the factory silently re-plumbed live belts with no click and no undo. Wheel now zooms; **Shift**+wheel rotates. Destructive edits do not belong on the gesture a laptop emits by accident
    - **Long-press rotated before it decided to sell.** The tap action ran on pointerdown and the long-press classification on pointerup, so long-pressing an assembler turned it *and then* offered the sale — cancel, and the line stayed silently re-aimed. A press with nothing selected is now held in `pendingTap` and classified once, on release: quick = tap, held = sell, moved = pan
    - **The help modal left the sim running** — enemies kept marching and leaking through a full-screen wall of text, with no keyboard to pause with on touch. `GameState.modalOpen` is a third freeze reason alongside `awaitingCard`; because it is not `paused`, closing restores whatever the player had chosen rather than un-pausing them
    - **The achievements modal could not show its own contents**: 28 entries as 14 rows of 52px inside a fixed 560px panel put the last third below the modal and some below the canvas. Geometry moved into pure, tested `scenes/achievementLayout.ts` (paginated, grows with the device, finger-sized pager on touch) — `achievementLayout.test.ts` runs against the real `ACHIEVEMENTS.length` at four screen shapes, so the 29th achievement fails a test instead of drawing off-screen
    - **Lifetime stats wrote through on every kill** — a `JSON.stringify` plus a synchronous `localStorage.setItem` several times per kill. Writes are throttled (2s) and flushed at the wave boundary, on exit to menu, on game over, and on `beforeunload`/`visibilitychange`. The unlock *scan* stays synchronous so a toast still lands on the kill that earned it, and a new unlock writes through immediately
    - the how-to-play steps quoted `R` and `SPACE` to touch players who have neither

30. `[x]` **Board pan & pinch-zoom** — shipped: `scenes/boardCam.ts` is the pure camera (exact `boardToScreen`/`screenToBoard` inverses, clamped to the board), driven by pinch, wheel, middle-drag and one-finger drag. See also 40, which is what finally made it load-bearing rather than optional. Original note, kept for the seams it names:
    - note 31 freed the plain scroll wheel and pointed it at the existing `zoomAt`, so desktop wheel-zoom already works; what remains below is the *mobile* half. The top remaining mobile gap: on a phone landscape a 32px tile renders ~15 css px, which is half a fingertip. The seam is narrow and clean — `tileAt`/`project` are the only board↔canvas converters and both already dispatch on `this.iso`, and in isometric a zoom is just a scale on `fitCam`'s half-extents (picking stays exact for free, since `screenToBoard` derives from the same `IsoCam`). The work is on the *flat* side: Phaser's main camera also renders GameScene's upgrade panel and floating text, so zooming it needs a second camera and interacts with the `Camera.ignore` bitmasks the iso view already uses. Raising `activePointers` above 1 for pinch also needs a guard so a second finger can't start a rival belt stroke

### Open backlog (from the 31 audit — ranked, none started)

The read-only audit behind 31 found more than the defects 31 fixed. What follows is everything it raised that is *design* work rather than a bug, kept here so it cannot be quietly dropped. Ranked by fun/strategy impact, same as the roadmap above.

32. `[~]` **Logistics recovery & routing tools** — the biggest playability gap. Partly shipped:
    - **Unjamming.** One item no downstream machine accepts parks at the head of a belt forever and backs up everything behind it, and the only recovery was selling the belt out from under it and rebuilding. The first right-click / long-press on a carrier holding an item now clears the *item*; the belt survives and a second click sells it as before. Only belts, splitters and tunnels can hold an item, so `b.item` is the whole test
    - **The machine inspector, as overlay labels.** `Building.stallReason` extends the existing "each system sets the flag where it already knows the answer" pattern with *why*, and `overlayCell` turns it into a word on the tile: **DRY** (short an ingredient) / **FULL** (finished goods with nowhere to go) / **SPENT** (deposit gone, greyed because nothing the player does helps) / **JAM** (carrier holding something no neighbour will take). Output pressure is reported ahead of input hunger on purpose — a machine that is both is waiting on its *outlet*, and widening its supply would spend money to change nothing. Only jammed carriers get a word, or the one tile that matters would be buried under a wall of text
    - **The SORTER** — a filtering splitter, and the *systemic* fix: it stops the wrong item entering the wrong line at all rather than helping you mop up afterwards. One `filter: ItemType | null`. A **matching** item goes straight *only* and waits if straight is blocked — it must never divert, because a filtered line is a guarantee, not a preference, and diverting would put the exact wrong item back into the line the sorter exists to protect. Non-matching items round-robin the two sides. **`filter === null` behaves exactly like a splitter**, so a fresh sorter (or one restored from a save written before sorters existed) is useful by default and can never trap a line. Tapping it cycles the filter; `R`/Shift+wheel still rotate — "tap configures, R rotates". Save round-trips `filter` as an optional field with **no `SAVE_VERSION` bump**: an old save restores correctly as null, which is the bar CLAUDE.md sets for bumping
    - **Still open (optional):** a dedicated buffer/storage building. Deferred rather than forgotten — machines already buffer per input type, so this is a convenience, not the gap the sorter closed
33. `[x]` **Wave report: delivered, not just produced** — shipped. The card compared rounds *fired* against rounds *produced*, which answers a different question than the one it printed: a round still in an output buffer, riding a belt that reaches no gun, or eaten by a Lab all counted as "production kept up", while a player burning down a stockpile banked between waves was told they were short. `WaveTally` now carries `delivered` (bumped at the single place a round enters a magazine, next to `nb.fed += 1`), `toLab`, `starved`, and `magStart`/`magEnd`. **`ammoDeficits` measures against `delivered`** — what a tower fired can only have come from what was delivered to it, so the difference *is* the magazine drain. The card separates the two diagnoses that need opposite fixes: "add production" versus "made, but not delivered"
34. `[~]` **Research variety + the coolant arbitrage** — (b) **shipped**, (a) still open.
    - **The arbitrage is gone.** `RESEARCH_VALUE` was authored per item (ammo 4, coolant 3) while a chiller turns 1 ammo into *2* coolant — so laundering ammo through the cheapest building in the game paid 6 instead of 4. Values are now *derived*: `embodiedValue` conserves worth across every recipe (`inputs / outputPer`), seeded by `ORE_VALUE = 4` with crystal scaled by its slower miner cycle. Results are ammo 4 · coolant 2 · shell 8 · piercing ~14.93 — strikingly close to the hand-authored 4/3/10/16 they replace, because the designer's instinct was right and only the exploitable value moves. Conservation is an **equality**, which is a stronger and simpler property to test than an inequality, and `research.test.ts` asserts it over `MACHINES` programmatically so a new recipe cannot reintroduce the hole.
    - **Two traps worth knowing if you touch this.** First, *embodied value and Lab payout are different quantities*: raw ore and crystal pay **zero** at the Lab (the pillar — research must cost you defence) but carry non-zero value *inside* a manufactured good. Conflating them makes an assembler look like it invents research from nothing, and the only way to satisfy that is a discount that makes every conversion lossy — which deletes the choice of what to Lab instead of fixing it. Second, **the Lab banks research unrounded**. Rounding each delivery was itself the exploit in miniature: coolant is exactly half an ammo, so with one PEER REVIEW stack (×1.25) `round(2.5) × 2 = 6` beat `round(5) = 5`. Fractions accumulate harmlessly; only level thresholds are whole. `ConveyorSystem.test.ts` pins this at the real call site rather than through a recomputed model, because a model-only test passes while the game is still exploitable
    - **(a) shipped:** six cards that change *how things work* rather than scaling a coefficient, including mutually-exclusive pairs so a draw is a real decision (`offerable` gates the pool). Flat multipliers are weighted down so they no longer drown the rest. Everything remains reconstructible from the saved card *counts* alone — no new save fields, no version bump — because `modsFrom(taken, base)` is still the only way the mod bag is built
35. `[~]` **Wave & boss variety** — mixed compositions and boss mechanics shipped. A wave is now a list of **squads** (kind + count + spacing) that `WaveSystem` walks, so a single wave can mix normal/swift/armored and the preview informs a plan instead of dictating one tower. Early waves stay single-kind — the counter lesson has to be teachable before it is complicated. Bosses gained two real mechanics: an **escort shield** (damage reduction to nearby non-bosses, drawn as a visible aura, purple hit-flash so an absorbed hit is legible) and a periodic **slow purge** that shrugs off coolant, announced on screen. **The threat budget was redistributed, never increased** — every `waves.test.ts` invariant still passes unmodified, which is the point: tower damage stops compounding at Mk4, so inflating late HP makes the run arithmetically unwinnable rather than harder.
    - **Performance note for anyone touching `hit()`:** the boss shield needs the nearest boss, and `hit()` is one of the hottest paths in the game (a lance resolves several hits per tick against a column). Scanning the enemy list inside it is O(enemies²) per frame on exactly the heaviest waves. `liveBosses()` caches the list and **derives staleness from the roster length rather than a dirty flag** — a flag was silently wrong for any caller that touched `enemies` outside the spawn path, which is a trap for tests and future callers alike. Within-tick deaths are handled by skipping `dead`, since the length does not change until the reap
    - **Still open:** map modifiers and difficulty modes, challenge goals (limited build area, limited ore, no selling, timed waves), and an explicit endless milestone or victory objective instead of only an eventual throughput wall
36. `[x]` **Adaptive 3D quality** — shipped: quality tiers (DPR clamp, shadows, shadow-map size, antialias) chosen from device capability and then stepped down by measured frame time, plus WebGL context-loss handling and automatic fallback to flat after sustained failure. The tier choice and the frame-time hysteresis are **pure and unit-tested** in `iso/isoQuality.ts` — the Three.js side only applies what they decide, which is the same pure-core pattern as `isoMath`/`hudLayout`/`overlayCell`. Hysteresis is required, not decorative: a naive threshold oscillates between tiers on the boundary and the flicker is worse than the low tier. **The sim is untouched by any of it** — CLAUDE.md's rule that the iso view mirrors the game and never drives it still holds, so throttling the 3D mirror never throttles the simulation. `IsoView` remains its own dynamic chunk (~138KB gzipped)
37. `[~]` **Accessibility beyond colour and motion** — the overlay's colour-only encoding is fixed as a side effect of 32: every stalled tile now names its state in words (DRY / FULL / SPENT / JAM) through the shared `overlayCell`, so both renderers gained it at once and a red-green colourblind player can read the board. Still wants a reduced shake/flash/motion setting, a UI scale independent of touch detection, mobile haptics, and screen-reader-reachable HTML equivalents for the major menu actions
38. `[~]` **Cloud write ordering + leaderboard integrity** — **write ordering shipped.** `pushSave` was a fire-and-forget unconditional upsert, so two overlapping requests could land out of order and an older factory could overwrite a newer one — and autosave fires on every wave clear *plus* a 1s debounce on build edits, so overlapping requests were routine, not theoretical. `state/saveQueue.ts` is a pure, dependency-injected single-writer queue: one write in flight, a pending slot that keeps only the **newest** save (intermediate ones are worthless), and a `newestStartedAt` guard so a stale save can never land after a newer one even if responses settle out of order. It is pure so it can be tested without Supabase or a network, honouring the rule that pure modules never import services. localStorage remains the primary store and every path still degrades quietly when Supabase is null. **Still open:** the browser can upsert any `best_wave`: ownership RLS stops you editing *someone else's* row but cannot establish that a score came from real play. **The schema and policies are not in `src` and cannot be verified from the client — audit them in the database directly**, including `security_invoker` on the exposed `leaderboard` view, and have the query state its own ordering rather than trusting the view's
39. `[~]` **Cross-device meta progression** — client half shipped. Merge rules live in `mergeProgress.ts` beside the existing run/achievement/best-wave rules, and `progress.absorbStats` folds in counters learned from another device *quietly* (old progress surfacing at sign-in is not a new in-run event, so no toasts — but any achievement those counters imply is still banked for the union push). Cloud values are validated like any untrusted save: unknown node ids dropped, levels clamped per node's `max`, non-integers rejected.
    - **Node levels take the max, never a sum** — the same node bought on two devices is one purchase, and summing would hand out free levels for owning two phones.
    - **Scrap also takes the max.** This is a genuine trade with no lossless answer and it was chosen deliberately: max can discard scrap earned concurrently on a second device, but summing double-counts a run synced twice, and silently inflating a currency is the worse failure. If this ever needs to be exact, the fix is to track lifetime *earned* and *spent* separately so the wallet is derived — which cannot be retrofitted without a migration, since local storage holds a bare wallet number.
    - **Still open:** the `jsonb` column on `profiles` this needs does not exist yet, so the sync is inert until it is created (the client degrades silently and localStorage stays authoritative, exactly as it does for saves). Applying that migration is a database task, not a client one

40. `[x]` **The canvas actually fits the device** — shipped, from a playtest report: on an iPhone in landscape the game was shoved to the right and filled barely half the screen. Two independent causes, both worth remembering:
    - **The offset was a double-centering.** `index.html` centered the canvas with a CSS grid *and* Phaser's `autoCenter: CENTER_BOTH` set its own `margin-left`. In a centering parent those add: the canvas lands at `(parent − canvas)/2 + margin/2`, i.e. shoved right by **half the letterbox gap** — invisible on a desktop where that gap is small, glaring on a phone where it was ~38% of the width. `#app` is now a plain `position: fixed` box inset by the safe area, and **Phaser does the only centering**. If you ever add layout to `#app`, this comes straight back.
    - **The letterbox was an aspect mismatch, and the fix is `canvasMetrics` in `config.ts`.** `Scale.FIT` loses any mismatch to black bars. The board plus a touch HUD is 1.49:1; a phone in landscape is ~2.17:1. Width is pinned to the board, so the give is vertical: the HUD bar absorbs surplus height on boxy screens as it always did, and past that **`PLAYFIELD_H` — the *viewport onto the board* — shortens below `BOARD_H`**. Same board, fewer rows at once, ~60% bigger tiles, and `boardCam` pans for the rest.
    - **`BOARD_W`/`BOARD_H` vs `GAME_W`/`PLAYFIELD_H` is now a real distinction.** They were the same numbers, so board-space drawing used whichever was in scope; the grid lines, the path chevrons' culling and the vignette were all sized to the *viewport* and would have been cropped. Anything in board coordinates must use `BOARD_*`.
    - **Safe-area insets are subtracted before the aspect is computed.** `viewport-fit=cover` means `innerWidth` counts pixels behind the notch that the canvas is then inset out of — sizing against the bigger number puts ~120px of a notched iPhone's width straight back into letterbox. Measured through a hidden `env()` probe, since `env()` is only readable from CSS.
    - **`MIN_ZOOM` is now `FIT_ZOOM`, not 1, and the default is still 1.** Opening at the fit would render the board *smaller* than before the change, which is the opposite of the point; but a TD map you cannot see in full is one you cannot plan against, so zooming out to the whole board has to remain reachable. `IsoView.isoZoom` reconciles the two conventions — flat zoom is a pixel ratio, iso zoom is a framing — so toggling 2D↔3D mid-run does not jump.
    - **One-finger drag now actually pans.** The tap classifier had called a moved press "a pan" since note 31, but nothing panned: only pinch and middle-drag did. Fine while the whole board was always visible; not fine once half of it is off screen, because two-finger pinch was then the *only* way to reach the rest.
    - **The title screen is drawn through a scaled camera** (`MENU_SCALE`/`MENU_W`/`MENU_H`). Its button stack needs ~720px and the canvas is now allowed to be shorter. Scaling the camera keeps one layout; reflowing would have meant a second one to keep correct. `MENU_SCALE` is 1 wherever the canvas is tall enough, so desktop is pixel-identical.
    - **Desktop is deliberately untouched.** `COMFORTABLE_TILE_CSS` gates the whole mechanism: a 21:9 monitor letterboxes a little and keeps all 20 rows, because a tile is already 48px there and hiding rows would cost information to buy legibility nobody was short of. `config.test.ts` pins the 16:9 and tablet canvases to their exact previous numbers for this reason.

41. `[x]` **Touch build ergonomics** — shipped, straight from the same playtest as 40. Four complaints, four fixes:
    - **Placement is staged, not immediate (touch only).** Tapping the board parks a ghost on the tile and charges nothing; ROTATE aims it, dragging nudges it, and ✓ PLACE — or a second tap on the same tile — buys it. A mis-aimed tap used to spend real money on a building in the wrong place, and now that the board pans, the wrong place can be off screen by the time you notice. **Belts are deliberately exempt**: drag-painting was reported as already perfect, and staging would break the one gesture that works. Desktop still builds on click (`else if (!IS_TOUCH)`), because a mouse does not miss.
    - **A staged placement keeps the palette armed after it commits**, so a row of presses is tap-tap, tap-tap. A *failed* commit keeps the stage instead of dropping it — a rejected tap should let you move the thing, not lose it.
    - **Every machine wears its output arrow** (`drawFacingArrow`/`redrawFacing`, event-driven, never per frame). "Which way is this miner facing" could not be answered from the sprite, and on touch the only way to change the facing is to *tap the machine*, which rotates it without saying which way it went. Belts are skipped — the chevron loop already says it — and towers and the lab have no output to point at. The staged ghost gets the same arrow in an emphatic green, so the facing is legible *before* you pay.
    - **The touch pad is a 2×2 block of equal cells** (ROTATE / ✓ PLACE / SELL / PAUSE, `TOUCH_W` 232). ROTATE was half of a 180px row and was called out by name as too small to hit or read; it is now a 30px arrow glyph with a caption, and `hudLayout.test.ts` pins every cell to the same size so it cannot become the runt again.
    - **Drag to erase, the mirror of drag-painting.** Inside SELL mode a drag pulls up everything it crosses. The mode *is* the confirmation, so the per-building prompt is skipped mid-sweep — but a **tap** still goes through `requestSell`, keeping both the unjam-first rule and the second ask on expensive buildings. Two traps, both hit while writing it: selling on `pointerdown` made the sweep skip its own first tile (the line vanished *except* where you started), so the press is classified on release like every other gesture here; and the sweep needs the same `PAN_SLOP` the pan uses, or a two-pixel wobble during a tap counts as a drag and quietly strips a tower of its confirmation.
    - **The one gap:** `facingLayer` and the staged outline are `Graphics`, which the isometric mirror has no counterpart for. The staged *tile* is covered — it reuses `IsoView.setSurvey`, the existing "highlight this footprint on the ground" decal — but 3D has no per-machine output arrows. Fixing that means giving `IsoView` a real arrow model.

## Working with Codex (delegation contract)

Implementation work is delegated to the Codex subagent wherever it is self-contained; the orchestrator keeps architecture context, sets the fence, and reviews. What makes this work:

- **One task per run, with an `<action_safety>` fence naming the exact files it may touch and the ones it must not.** Several agents run in parallel on disjoint fences; an unfenced agent will clobber concurrent edits. Fences have held perfectly across runs — trust them, but never overlap two agents on one file.
- **Give it the invariant, not the numbers.** "Derive values so no conversion can be an arbitrage" produced a better model than any retune would have.
- **A wrong spec produces a technically-correct, strategically-bad result.** This has already happened once: the `RESEARCH_VALUE` brief conflated Lab payout with embodied value, and Codex built faithfully to it — then *flagged the contradiction* rather than papering over it. Read the pushback; that is the highest-value part of the report.
- **Verify the code, not the report.** Every returned run gets `tsc --noEmit` + `vitest run` re-run locally and the diff read. Two real defects have been caught this way *after* a green report: a cap that would have deleted saves (`outputCap` vs `outputCap + outputPer - 1`), and a rounding exploit surviving in the Lab call site.
- **Watch for tests that pin a mirror of the code instead of the code.** A test that recomputes the model passes while the shipped call site is still broken. Pin behaviour at the real seam.
- **Confirm a regression test fails without the fix.** Cheap, and it has repeatedly exposed tests that proved nothing (the first FPS-invariance test passed against the unfixed code).
- **`vitest` and `vite build` do not typecheck.** Both strip types without checking them, so an agent can honestly report a green suite and a green build on code where `tsc --noEmit` fails. Always run `tsc` yourself; it has caught errors that neither of the other two saw.
- **A completed *forwarder* is not a completed *job*.** The rescue subagent hands off to a longer-running Codex task and then exits, which fires a completion notification. Reading the working tree at that moment can catch a half-written directory. Wait for the tree to stop changing before judging anything — this cost one wrong "it shipped broken" verdict.
- **Don't delegate small fixes.** Spawning an agent costs ~32k tokens; a two-line type annotation or a one-line guard is cheaper done directly. Delegate whole, self-contained *pieces of work*, not errands.
- **A refused resume is silent.** Codex cannot resume a thread while its job is still active, and the follow-up is simply not delivered. Re-check the tree before re-sending, since the issue may already be gone.

## Where to pick up

Everything in the original ranked roadmap, the playability audit, and the post-audit backlog (32–41) is now shipped or explicitly partial — see the `[~]` entries above for exactly what remains inside each. The suite is **617 tests across 38 files**; `npm test`, `npm run typecheck` and `npm run build` are all green at the time of writing.

Ranked by value, what is genuinely left:

1. **Leaderboard integrity (38, second half)** — the browser can still upsert any `best_wave`. Ownership RLS stops you editing *someone else's* row but cannot establish that a score came from real play. **No client change can fix this**; it needs policy work in the database, plus an audit of `security_invoker` on the exposed `leaderboard` view and having the query state its own ordering rather than trusting the view's. Not verifiable from `src` — use the Supabase tooling.
2. **The `profiles` jsonb column (39)** — cross-device Workshop sync is written and tested but **inert until that migration is applied**. Client side is done; this is one migration plus a `GRANT` (remember: since the 2026-04 change, new public tables are not auto-exposed to the Data API).
3. **Wave variety, remainder (35)** — map modifiers, difficulty modes, challenge goals, and an explicit endless milestone or victory condition. Currently a run just ends at the throughput wall.
4. **A buffer/storage building (32)** — deliberately deferred; machines already buffer per input type, so this is convenience rather than a gap.

Anything past that should come from **playtest feedback, not this list** — which is exactly where 40 came from, and it was worth more than anything left on it. The list has now outlived two full audits; the next genuinely valuable thing is watching someone play, **on a phone**.

## Deployment

- Live at https://tchebagual71.github.io/factory-td/ (GitHub Pages, serves the `gh-pages` branch)
- `.github/workflows/deploy.yml` auto-builds and republishes `gh-pages` on every push to `main` — never push `gh-pages` manually
- `vite.config.ts` uses `base: './'` so the build works under the `/factory-td/` subpath
