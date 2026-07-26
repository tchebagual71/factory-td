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
    MenuScene.ts        # title: continue/new-run, map picker, volume, achievements, leaderboard, account/sign-in modals
    GameScene.ts        # gameplay orchestration, input/placement, save/restore, juice helpers (floatText/burst/bigText)
    UIScene.ts          # HUD overlay running in parallel (stat chips, build palette, wave button, toasts, help, game over)
    hudLayout.ts        # pure HUD geometry: bottom bar (grouped palette/touch pad/wave cluster), top strip, slot contents
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
    progress.ts         # lifetime stats + unlocked achievements (ftd:stats/ftd:ach), emits 'achievement'
    mergeProgress.ts    # pure local↔cloud merge rules (run LWW, achievements union, best max)
  services/             # ALL Supabase I/O lives here — pure modules never import services
    supabase.ts         # lazy client singleton (publishable key, PKCE); null if unavailable
    auth.ts             # Google OAuth / magic link / anonymous + linking, profile upsert
    cloud.ts            # fire-and-forget save/score/achievement sync, leaderboard fetch, syncOnSignIn
  data/
    mods.ts             # pure: run-scoped modifier bag granted by research (shared by buildings.ts + research.ts)
    research.ts         # pure: lab item values, XP curve, weighted card pool, seeded draw, modsFrom
    map.ts              # fixed path waypoints + ore/crystal patch rectangles
    buildings.ts        # building stats & costs; UPGRADE_TREE (branching Mk paths) + effStats
    waves.ts            # wave scaling formulas (hp/count/speed/bounty, boss every 5th)
    achievements.ts     # achievement defs + pure unlock logic (ids match the DB CHECK regex)
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
15. `[x]` **Rotate in place** — shipped: clicking a placed belt/machine turns it, and `R` turns whatever is under the cursor (Factorio's rule). Re-aiming used to mean selling and rebuilding
16. `[x]` **How to play** — shipped: a five-step modal on the title screen. Onboarding was a four-line hint that faded after 14s
17. `[x]` **Per-ammo-type wave report** — shipped: the report card judges supply per ammo type and names the starved line. Grand totals let a chiller's 2-coolant-per-ore hide a starving gun line behind a healthy-looking sum
18. `[x]` **Presentation** — shipped: belts run a scrolling chevron loop (all belts share one animation, started on a random frame), enemies rotate to their heading and carry a nose, guns recoil and flash from a fixed pool, swift enemies went teal so they can't be mistaken for the near-white frost tint
20. `[x]` **Full production chain** — shipped: everything past the press runs on ammo, at unchanged ore cost per output. See "Production chain" above. Save format → v2 with a v1 migration
21. `[x]` **Lab + research + level-up draw** — shipped: belt finished goods into a Lab, pick 1 of 3 stacking upgrades per level. See "Research" above
22. `[ ]` **Blueprints: the permanent between-runs tree** — planned: a second currency earned per run, spent in a MenuScene tree (`state/meta.ts` + pure `data/metaTree.ts`, localStorage-only; cloud sync would need a `jsonb` column on `profiles`)
23. `[ ]` **Achievements expansion + collection screen** — planned: tiered families past the current 15, browsable grid with progress. No DB migration needed (ids only have to match `^[a-z0-9_]{1,40}$`)
24. `[ ]` **In-run mission cards** — planned: three active objectives with immediate payouts, reusing `UIScene.pumpToasts`
25. `[ ]` **End-of-run score card** — planned: pure `data/score.ts` grading wave/throughput/efficiency, shown on the game-over overlay

26. `[x]` **UI audit: categorised build bar, mobile ergonomics, frame-cost pass** — shipped:
    - the palette is three labelled shelves (LOGISTICS / PRODUCTION / DEFENSE) with category-coloured rims and matching hotkey halves — see "HUD geometry & the categorised build bar"; the top status strip and per-slot content joined the pure, tested layout module
    - touch: finger-sized help/mute/survey chips (they were 16px glyphs on a canvas the phone scales *down*), a 1.4× upgrade panel, tap-the-slot-again to cancel, the tapped building's description pinned to the hint line, and no keyboard shortcuts quoted anywhere
    - fixed: `SEND WAVE [SPC]` re-stamped over the touch label on every phase change; the two-line wave preview spilling over the send button on the 80px bar; achievement toasts sliding in over the upgrade panel; the intro hint running through the status strip; the logistics legend doing the same
    - frame cost: `effStats` memoised per Mods bag (it ran per tower per frame), particle emitters and the enemy hit-flash pooled instead of allocating an emitter and a `delayedCall` per kill/hit, recipe input lists resolved once, enemy list compacted only when something died, and tower tint / logistics labels written only on change
19. `[x]` **Bugs & perf** — shipped: the upgrade panel no longer closes itself when clicked (Phaser fires GameObject handlers *and then* the scene-level `pointerdown` regardless — guard the panel bounds); the build ghost updates while paused; ambient SFX are voice-gated and floating text is capped, so a 100-kill swift wave at ×3 speed no longer asks for ~100 oscillators a second; costly buildings confirm before selling

## Deployment

- Live at https://tchebagual71.github.io/factory-td/ (GitHub Pages, serves the `gh-pages` branch)
- `.github/workflows/deploy.yml` auto-builds and republishes `gh-pages` on every push to `main` — never push `gh-pages` manually
- `vite.config.ts` uses `base: './'` so the build works under the `/factory-td/` subpath
