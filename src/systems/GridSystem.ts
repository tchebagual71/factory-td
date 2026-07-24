import { GRID_H, GRID_W } from '../config';
import { computePathCells, crystalPatches, inPatch, orePatches, Patch, RESERVES } from '../data/map';
import { Building, BuildingType } from '../types';

export type CellKind = 'grass' | 'path' | 'ore' | 'crystal';
export type Resource = 'ore' | 'crystal';

/** Raw resource a miner on this cell extracts, or null if it can't mine here. */
export function minedResource(kind: CellKind): Resource | null {
  return kind === 'ore' || kind === 'crystal' ? kind : null;
}

export interface Cell {
  kind: CellKind;
  building: Building | null;
  /** units of ore/crystal left in this tile; 0 everywhere else */
  reserves: number;
}

/** Single source of truth for what occupies each tile. */
export class GridSystem {
  private cells: Cell[][] = [];
  buildings: Building[] = [];
  /** patches revealed by prospecting this run — part of the save, unlike the fixed map */
  revealed: { patch: Patch; kind: Resource }[] = [];

  constructor() {
    const pathCells = computePathCells();
    for (let y = 0; y < GRID_H; y++) {
      const row: Cell[] = [];
      for (let x = 0; x < GRID_W; x++) {
        let kind: CellKind = 'grass';
        if (pathCells.has(`${x},${y}`)) kind = 'path';
        else if (inPatch(orePatches(), x, y)) kind = 'ore';
        else if (inPatch(crystalPatches(), x, y)) kind = 'crystal';
        const res = minedResource(kind);
        row.push({ kind, building: null, reserves: res ? RESERVES[res] : 0 });
      }
      this.cells.push(row);
    }
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && x < GRID_W && y >= 0 && y < GRID_H;
  }

  cellAt(x: number, y: number): Cell | null {
    return this.inBounds(x, y) ? this.cells[y][x] : null;
  }

  canPlace(type: BuildingType, x: number, y: number): boolean {
    const cell = this.cellAt(x, y);
    if (!cell || cell.building || cell.kind === 'path') return false;
    if (type === 'miner') return minedResource(cell.kind) !== null;
    return true;
  }

  /**
   * Placement rules for restoring a save. Deliberately looser than `canPlace`:
   * a miner whose tile ran dry mid-run was legal when it was built, so it comes
   * back as a dead miner the player can see and sell — not silently deleted.
   */
  canRestore(x: number, y: number): boolean {
    const cell = this.cellAt(x, y);
    return !!cell && !cell.building && cell.kind !== 'path';
  }

  place(b: Building): void {
    this.cells[b.y][b.x].building = b;
    this.buildings.push(b);
  }

  remove(b: Building): void {
    this.cells[b.y][b.x].building = null;
    const i = this.buildings.indexOf(b);
    if (i >= 0) this.buildings.splice(i, 1);
  }

  /**
   * Take one unit out of a resource tile. When the last unit goes the tile
   * reverts to plain grass — the miner standing on it is now a statue, and the
   * player has to re-plan that corner of the factory. Returns true on the
   * extraction that exhausts the tile.
   */
  extract(x: number, y: number): boolean {
    const cell = this.cellAt(x, y);
    if (!cell || !minedResource(cell.kind) || cell.reserves <= 0) return false;
    cell.reserves -= 1;
    if (cell.reserves > 0) return false;
    cell.kind = 'grass';
    return true;
  }

  /**
   * Reveal a prospected patch. Only ever converts plain empty grass, so it can
   * never bury the path, an existing deposit, or something the player built.
   */
  addPatch(patch: Patch, kind: Resource): void {
    for (let y = patch.y; y < patch.y + patch.h; y++) {
      for (let x = patch.x; x < patch.x + patch.w; x++) {
        const cell = this.cellAt(x, y);
        if (!cell || cell.kind !== 'grass' || cell.building) continue;
        cell.kind = kind;
        cell.reserves = RESERVES[kind];
      }
    }
    this.revealed.push({ patch, kind });
  }

  /** Force a tile's remaining reserves (save restore). 0 spends the tile out. */
  setReserves(x: number, y: number, n: number): void {
    const cell = this.cellAt(x, y);
    if (!cell) return;
    cell.reserves = n;
    if (n <= 0 && minedResource(cell.kind)) cell.kind = 'grass';
  }

  /** Every resource tile that is no longer full — the only ones worth saving. */
  changedTiles(): { x: number; y: number; n: number }[] {
    const out: { x: number; y: number; n: number }[] = [];
    this.forEachCell((cell, x, y) => {
      const res = minedResource(cell.kind);
      if (res) {
        if (cell.reserves < RESERVES[res]) out.push({ x, y, n: cell.reserves });
      } else if (cell.reserves > 0) {
        // shouldn't happen, but never silently drop state
        out.push({ x, y, n: cell.reserves });
      } else if (cell.kind === 'grass' && this.wasResource(x, y)) {
        out.push({ x, y, n: 0 }); // mined out
      }
    });
    return out;
  }

  /** Was this tile a deposit at the start of the run (fixed map or a revealed patch)? */
  private wasResource(x: number, y: number): boolean {
    return (
      inPatch(orePatches(), x, y) ||
      inPatch(crystalPatches(), x, y) ||
      this.revealed.some(({ patch }) => inPatch([patch], x, y))
    );
  }

  /** Is every tile of this rect free, plain grass? (prospecting site search) */
  isClearArea(x0: number, y0: number, w: number, h: number): boolean {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const cell = this.cellAt(x, y);
        if (!cell || cell.kind !== 'grass' || cell.building) return false;
      }
    }
    return true;
  }

  /** Every tile that currently holds (or has held and exhausted) a resource. */
  forEachCell(fn: (cell: Cell, x: number, y: number) => void): void {
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) fn(this.cells[y][x], x, y);
    }
  }
}
