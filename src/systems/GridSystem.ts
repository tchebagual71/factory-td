import { GRID_H, GRID_W } from '../config';
import { computePathCells, CRYSTAL_PATCHES, inPatch, ORE_PATCHES } from '../data/map';
import { Building, BuildingType } from '../types';

export type CellKind = 'grass' | 'path' | 'ore' | 'crystal';

/** Raw resource a miner on this cell extracts, or null if it can't mine here. */
export function minedResource(kind: CellKind): 'ore' | 'crystal' | null {
  return kind === 'ore' || kind === 'crystal' ? kind : null;
}

export interface Cell {
  kind: CellKind;
  building: Building | null;
}

/** Single source of truth for what occupies each tile. */
export class GridSystem {
  private cells: Cell[][] = [];
  buildings: Building[] = [];

  constructor() {
    const pathCells = computePathCells();
    for (let y = 0; y < GRID_H; y++) {
      const row: Cell[] = [];
      for (let x = 0; x < GRID_W; x++) {
        let kind: CellKind = 'grass';
        if (pathCells.has(`${x},${y}`)) kind = 'path';
        else if (inPatch(ORE_PATCHES, x, y)) kind = 'ore';
        else if (inPatch(CRYSTAL_PATCHES, x, y)) kind = 'crystal';
        row.push({ kind, building: null });
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

  place(b: Building): void {
    this.cells[b.y][b.x].building = b;
    this.buildings.push(b);
  }

  remove(b: Building): void {
    this.cells[b.y][b.x].building = null;
    const i = this.buildings.indexOf(b);
    if (i >= 0) this.buildings.splice(i, 1);
  }
}
