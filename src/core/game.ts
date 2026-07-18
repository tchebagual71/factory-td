import {
  BUILDING_DEFS,
  SELL_REFUND,
  START_LIVES,
  START_MONEY,
  TURRET_STARTING_SHOTS,
} from './config';
import { buildPathGeometry, type PathGeometry } from './map';
import { updateBelts } from './systems/belts';
import { updateTurrets } from './systems/combat';
import { updateEnemies } from './systems/enemies';
import { computePower, type PowerState } from './systems/power';
import { updateMachines } from './systems/production';
import { updateWaves } from './systems/waves';
import type { Building, BuildingKind, Dir, Effect, Enemy, MapDef, Phase, SpawnEntry, Tile } from './types';

/**
 * Headless game state + fixed-timestep simulation. The per-tick update order
 * is deliberate and load-bearing:
 *   waves -> enemies -> power -> machines -> belts -> turrets -> effects
 * Machines run in every phase (the factory keeps working between waves);
 * waves/enemies/turrets only advance during combat.
 */
export class Game {
  map: MapDef;
  path: PathGeometry;

  buildings: Building[] = [];
  /** Tile index -> building, kept in sync with `buildings`. */
  private grid: (Building | null)[];

  enemies: Enemy[] = [];
  effects: Effect[] = [];

  money = START_MONEY;
  lives = START_LIVES;
  phase: Phase = 'build';
  wave = 0;
  waveTimer = 0;
  spawnQueue: SpawnEntry[] = [];
  time = 0;

  power: PowerState = { supply: 0, demand: 0, satisfaction: 1 };
  message = '';
  messageAge = 0;

  private nextId = 1;

  constructor(map: MapDef) {
    this.map = map;
    this.path = buildPathGeometry(map);
    this.grid = new Array(map.width * map.height).fill(null);
  }

  // -- queries --------------------------------------------------------------

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.map.width && y < this.map.height;
  }

  tileAt(x: number, y: number): Tile {
    return this.map.tiles[y * this.map.width + x];
  }

  buildingAt(x: number, y: number): Building | null {
    if (!this.inBounds(x, y)) return null;
    return this.grid[y * this.map.width + x];
  }

  canPlace(kind: BuildingKind, x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    if (this.buildingAt(x, y)) return false;
    const tile = this.tileAt(x, y);
    if (tile.kind === 'path') return false;
    if (kind === 'miner') return tile.kind === 'ore';
    return tile.kind === 'empty'; // ore tiles are reserved for miners
  }

  // -- commands -------------------------------------------------------------

  placeBuilding(kind: BuildingKind, x: number, y: number, dir: Dir): Building | null {
    const def = BUILDING_DEFS[kind];
    if (!this.canPlace(kind, x, y)) return null;
    if (this.money < def.cost) {
      this.say('Not enough money');
      return null;
    }
    this.money -= def.cost;
    const b: Building = {
      id: this.nextId++,
      kind,
      x,
      y,
      dir,
      item: null,
      progress: 0,
      input: {},
      output: null,
      crafting: null,
      craftProgress: 0,
      fuel: 0,
      shots: def.turret ? TURRET_STARTING_SHOTS : 0,
      cooldown: 0,
    };
    this.buildings.push(b);
    this.grid[y * this.map.width + x] = b;
    return b;
  }

  sellBuilding(x: number, y: number): boolean {
    const b = this.buildingAt(x, y);
    if (!b) return false;
    this.money += Math.floor(BUILDING_DEFS[b.kind].cost * SELL_REFUND);
    this.buildings.splice(this.buildings.indexOf(b), 1);
    this.grid[y * this.map.width + x] = null;
    return true;
  }

  startWave(): boolean {
    if (this.phase !== 'build') return false;
    this.wave++;
    this.phase = 'combat';
    this.waveTimer = 0;
    return true;
  }

  say(msg: string): void {
    this.message = msg;
    this.messageAge = 0;
  }

  // -- simulation -----------------------------------------------------------

  update(dt: number): void {
    if (this.phase === 'gameover') return;
    this.time += dt;
    this.messageAge += dt;

    if (this.phase === 'combat') {
      updateWaves(this, dt);
      updateEnemies(this, dt);
    }

    this.power = computePower(this, dt);
    updateMachines(this, dt);
    updateBelts(this, dt);

    if (this.phase === 'combat') {
      updateTurrets(this, dt);
    }

    for (const e of this.effects) e.t -= dt;
    this.effects = this.effects.filter((e) => e.t > 0);

    if (this.lives <= 0) {
      this.lives = 0;
      this.phase = 'gameover';
      this.say(`Game over — survived ${this.wave - 1} full waves`);
    }
  }
}
