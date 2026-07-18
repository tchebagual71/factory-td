# Factory TD — Design & Roadmap

## Vision

Bloons-style tower defense where the economy is a Factorio-style factory. Money
buys buildings, but towers have no innate ammo: everything they fire is mined,
smelted, assembled, and belted to them. Defense throughput *is* factory
throughput, so the core loop is: survive a wave → reinvest in the factory →
support more/better towers → survive a bigger wave.

## Core loops (implemented)

1. **Factory**: miner → belt → smelter → belt → assembler → belt → turret.
   Coal → generator supplies a single global power grid; when demand exceeds
   supply every machine runs at `supply/demand` speed (brownout, not blackout).
2. **Defense**: fixed serpentine path, untimed build phase, manual wave start.
   Deterministic wave composition (`waveComposition`) with HP scaling
   (`1.13^wave`). Grunts → fast (w3) → tanks (w5) → boss every 8th wave.
3. **Coupling knobs**: ammo item = 5 shots (shell = 3), turret starting
   magazine of 15 shots buys time to bootstrap, factory keeps running during
   build phase so you can stockpile.

## Balance targets (tune in src/core/config.ts)

- Wave 1 survivable with 1–2 turrets on starting ammo while the factory spins up.
- One ammo assembler (~1.7 shots/s at full power) sustains just under one gun
  turret firing flat out — sustained defense wants parallel production lines.
- One generator (20 power) covers roughly one full production line
  (3 miners + 2 smelters + 1 assembler = 22 demand → slight brownout nudges a
  second generator).

## Roadmap (not yet built)

- **Wave preview** — show next wave's composition so players can prepare.
- **More towers** — slow/laser (power-hungry, no ammo), flame (burns coal).
- **Belt QoL** — underground belts, splitters, corner rendering.
- **Tower upgrades** — spend plates/money to upgrade in place.
- **Save/load** — serialize `Game` state to localStorage.
- **Multiple maps / infinite waves leaderboard.**
- **Audio + sprite art** — everything is flat-color canvas shapes today.
- **Balance pass** — current numbers are first-draft; playtest waves 10+.
