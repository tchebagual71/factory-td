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
    MenuScene.ts        # title: continue/new-run, achievements, leaderboard, account/sign-in modals
    GameScene.ts        # gameplay orchestration, input/placement, save/restore, juice helpers (floatText/burst/bigText)
    UIScene.ts          # HUD overlay running in parallel (stat chips, build palette, wave button, toasts, game over)
  systems/
    GridSystem.ts       # tile grid: single source of truth for cell contents & placement rules
    ConveyorSystem.ts   # item movement on belts + machine insertion (press/tower intake), item restore
    ProductionSystem.ts # miner & press crafting timers, belt output
    WaveSystem.ts       # spawning, enemy movement along fixed path, kills/leaks/wave-clear
    CombatSystem.ts     # tower targeting (furthest-along-path), bullets, ammo drain
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
    map.ts              # fixed path waypoints + ore/crystal patch rectangles
    buildings.ts        # building stats & costs; UPGRADE_TREE (branching Mk paths) + effStats
    waves.ts            # wave scaling formulas (hp/count/speed/bounty, boss every 5th)
    achievements.ts     # achievement defs + pure unlock logic (ids match the DB CHECK regex)
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
- Cell kinds: `grass` (buildable), `path` (never buildable), `ore` / `crystal` (the two miner-only resource kinds — `minedResource()` maps a cell kind to the item a miner on it digs)

### Conveyor & machine I/O
- Each belt cell holds at most **one item**; items glide smoothly to their cell center, then hop to the next cell if free
- Machines have a facing direction (`R` rotates before placement; art points East at rotation 0):
  - **Output**: miners/presses push finished items onto the belt cell they face (blocked = they hold and retry)
  - **Input**: a belt whose direction points into a machine inserts its item (ore → press intake, ammo → tower magazine)
- Belt drag-painting places runs of belts in the current direction

### Ammo economy (the genre bridge)
- Towers have finite magazines (`ammoCap`), consume 1 ammo per shot, and are placed pre-loaded (`startAmmo`) so wave 1 flows before a factory exists
- Production tree (stats in `data/buildings.ts`):
  - Miner (resource patches only) → ore, or crystal on crystal tiles — **one building, two resources**: the tile decides the item and the cycle (`minerCycle`, crystal is ~1.7× slower)
  - Press: 1 ore → 1 ammo → **Gun Tower** (fast, single-target)
  - Forge: 2 ore → 1 shell → **Cannon** (slow, splash damage, multi-kill money bonus at 3+ kills)
  - Assembler: 2 ore + **1 crystal** → 1 piercing round → **Lancer** (tier-2; see below)
- **Two raw resources**: crystal patches are small, few, and deliberately placed away from ore (`CRYSTAL_PATCHES` in `data/map.ts`), so a piercing line has to belt two inputs in from different pockets. Machines declare their recipe as `oreIn`/`crystalIn` and buffer each input separately (`Building.inputOre`/`inputCrystal`, capped per type); `recipeNeeds(machine, item)` is the single answer to "does this machine accept this item", used by both belt intake and the tests
- **Lancer / piercing rounds** (tier-2): the lance locks its heading at fire time and keeps flying, skewering up to `pierce` enemies before dissipating — devastating aimed down a straight leg of a single-file path, and it ignores armor. `CombatSystem` splits projectiles into `HomingBullet` (guns/cannons) and `LanceBullet`; the lance uses a **swept segment test** (not an endpoint check) because at ×3 speed it covers >100px per tick, and resolves hits nearest-first so a limited pierce budget is spent on the front of the column. 3+ kills in one lance pays a SKEWER bonus
- **Splitter**: belt node that round-robins items between straight/left/right outputs (skipping blocked ones); merging needs no special building — any belts pointing into the same cell merge
- **Tunnel**: items dive underground and surface at the next tunnel with the same facing within 4 tiles (rendered at low alpha in transit); crosses the enemy path, other belts, anything. An unpaired tunnel degrades to plain-belt behavior
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
(dt is clamped to 50ms so tab-switching doesn't cause physics jumps)

### Scene communication
- Scenes never reference each other directly; both import the `GameState` singleton (`state/GameState.ts`)
- All cross-scene signals go through `GameState.events`: `money`/`lives`/`wave`/`phase`/`gameover` (state→UI), `ui:select`/`ui:startwave` (UI→game), `selected` (game→UI), `achievement` (progress→UI toast)
- Flow: Boot → Menu → (launch ui, start game). `GameScene.create()` calls `GameState.reset()` and re-registers listeners — blanket `.off()` only for events it alone consumes, targeted `.off(event, fn)` with stable arrow-property refs for shared events (`phase`, `gameover`). **UIScene sleeps, never stops** (menu button) so its plain `.on` listeners register exactly once

### Save/resume & cloud sync
- `state/serialize.ts` is the contract: pure `captureRun`/`validateSave`, versioned (`v: 1`); saves happen only in build phase so enemies/bullets never serialize. Never trust stored/cloud JSON — everything re-validates through `validateSave`
- New state is added as *optional* fields (`mk`, `path`, `inCry`, …) so older saves keep validating and restore with sensible defaults; bump `v` only for a change that would make an old save restore *wrong* rather than incomplete
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

Numbers live in `data/buildings.ts` and `data/waves.ts` — tune there, not inline. Current curve: enemy HP ×1.22/wave, count 4+2n; boss waves (every 5th) are few/slow/tanky with 5-life leaks. When changing tower fire rate or press/assembler cycle time, keep the "one supply line ≈ half a tower" pressure at *both* tiers — `npm test` enforces that invariant plus the wave rhythm, resistances, crystal scarcity, recipe intake, and conveyor rules (`*.test.ts` next to each module), so run it after tuning. A PostToolUse hook (`.claude/settings.json` → `scripts/typecheck-hook.mjs`) typechecks after every TS edit.

## Release Roadmap (tracked — update status here as each lands)

Ranked for fun/strategy impact. Mark `[x]` with a one-line note when shipped.

1. `[x]` **Tower upgrades paid in manufactured goods** — shipped, then extended to a branching tree: shared Mk2, path choice at Mk3 (sniper/gatling, siege/flak), Mk4 caps (`UPGRADE_TREE`/`effStats` in `data/buildings.ts`); sell refunds half of total invested
2. `[x]` **Armor/resistance enemy types** — shipped: armored waves (even waves from 6 that aren't swift/boss) take 25% bullet damage, full shell damage (`resistMult` in `data/waves.ts`); resisted hits flash steel-gray
3. `[x]` **Underground belts** — shipped: Tunnel building; items dive to the next tunnel with the same facing within 4 tiles (crosses path/buildings), falls back to belt behavior if unpaired
4. `[x]` **Second raw resource + tier-2 recipes** — shipped: crystal patches mined by the same miner (slower cycle), Assembler (2 ore + 1 crystal → piercing round), Lancer tower whose lance skewers a column and ignores armor, with railgun/volley upgrade paths
5. `[ ]` **Early-send bonus + wave summary** — cash bonus scaling with how fast the next wave is sent; wave-clear card showing kills, income, ammo fired vs produced
6. `[ ]` **Logistics overlay** — toggleable view: per-tower ammo uptime %, starved machines flashing, belt throughput legibility
7. `[ ]` **Slow/coolant tower** — area slow consuming a cheap coolant item; multiplies other towers at choke points
8. `[ ]` **Ore patch depletion + prospecting** — patches exhaust, new ones revealed for a fee; forces periodic factory re-engineering
9. `[x]` **Save/load + best-wave record** — shipped and exceeded: full mid-run save/resume (localStorage + cloud sync when signed in), personal best on game over + menu
10. `[ ]` **Map variety + presentation pass** — additional path layouts, audio mix with volume control (menu scene shipped with accounts work)
11. `[x]` **Accounts, leaderboard, achievements** — shipped: optional Supabase accounts (Google/magic link/anonymous-upgradeable), cross-device saves, public best-wave leaderboard, 14 achievements with capped starting-money perks

## Deployment

- Live at https://tchebagual71.github.io/factory-td/ (GitHub Pages, serves the `gh-pages` branch)
- `.github/workflows/deploy.yml` auto-builds and republishes `gh-pages` on every push to `main` — never push `gh-pages` manually
- `vite.config.ts` uses `base: './'` so the build works under the `/factory-td/` subpath
