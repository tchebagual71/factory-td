# Factory TD

A hybrid **factory automation + tower defense** game in the browser. Factorio-style
logistics meet Bloons-style waves: enemies march a fixed path, and your towers only
fire while your conveyor belts keep them fed with ammo your factory produces.

## How it plays

- **Harvest**: place miners on iron, copper, and coal patches.
- **Process**: belts carry ore to smelters (ore → plates), plates to assemblers
  (→ ammo / shells), and coal to generators that power the whole grid.
- **Defend**: belt the ammo into gun turrets and cannons along the path. Between
  waves, build freely; press **Start Wave** when ready. Kills pay money, leaks
  cost lives, and each cleared wave pays a bonus.
- **Scale**: enemy HP grows every wave — your factory throughput has to grow too.
  Underpowered machines slow down, starved turrets go silent.

### Controls

| Input | Action |
| --- | --- |
| `1`–`8` / toolbar | select building |
| Click / drag | place (drag lays belt runs, auto-orienting) |
| `R` | rotate placement direction |
| `X` | sell tool (50% refund) |
| `Esc` / right-click | cancel tool |
| `Space` | start next wave |

## Development

```bash
npm install
npm run dev        # dev server
npm test           # run unit tests (vitest)
npm run build      # typecheck + production build to dist/
```

No runtime dependencies — TypeScript, HTML5 canvas, and Vite only.
