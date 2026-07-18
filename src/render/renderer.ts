import { BUILDING_DEFS, TILE } from '../core/config';
import type { Game } from '../core/game';
import { enemyPos } from '../core/systems/enemies';
import type { Building, Dir, ItemType } from '../core/types';
import type { UiState } from '../ui/input';

const ITEM_COLORS: Record<ItemType, string> = {
  'iron-ore': '#9fb4c4',
  'copper-ore': '#c87533',
  coal: '#33363c',
  'iron-plate': '#d7e3ee',
  'copper-plate': '#e69a5c',
  ammo: '#f0d048',
  shell: '#d05a3a',
};

const ENEMY_COLORS = { grunt: '#c0392b', fast: '#e67e22', tank: '#7b241c', boss: '#8e44ad' };

export class Renderer {
  private ctx: CanvasRenderingContext2D;

  constructor(private canvas: HTMLCanvasElement, private game: Game, private ui: UiState) {
    canvas.width = game.map.width * TILE;
    canvas.height = game.map.height * TILE;
    this.ctx = canvas.getContext('2d')!;
  }

  draw(): void {
    const { ctx, game } = this;
    this.drawTiles();
    for (const b of game.buildings) this.drawBuilding(b);
    this.drawEnemies();
    this.drawEffects();
    this.drawGhost();
    if (game.phase === 'gameover') {
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.fillStyle = '#e74c3c';
      ctx.font = 'bold 42px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('GAME OVER', this.canvas.width / 2, this.canvas.height / 2);
      ctx.fillStyle = '#d7dce2';
      ctx.font = '18px system-ui';
      ctx.fillText(`Survived ${game.wave - 1} waves — reload to retry`, this.canvas.width / 2, this.canvas.height / 2 + 34);
      ctx.textAlign = 'left';
    }
  }

  private drawTiles(): void {
    const { ctx, game } = this;
    for (let y = 0; y < game.map.height; y++) {
      for (let x = 0; x < game.map.width; x++) {
        const t = game.tileAt(x, y);
        const px = x * TILE;
        const py = y * TILE;
        if (t.kind === 'path') {
          ctx.fillStyle = '#8b7355';
        } else {
          ctx.fillStyle = (x + y) % 2 === 0 ? '#2c3b27' : '#2a3825';
        }
        ctx.fillRect(px, py, TILE, TILE);
        if (t.kind === 'ore' && t.ore) {
          ctx.fillStyle = ITEM_COLORS[t.ore];
          for (let i = 0; i < 5; i++) {
            const ox = px + 5 + ((x * 7 + y * 13 + i * 11) % 20);
            const oy = py + 5 + ((x * 17 + y * 5 + i * 7) % 20);
            ctx.fillRect(ox, oy, 4, 4);
          }
        }
      }
    }
  }

  private drawBuilding(b: Building): void {
    const { ctx } = this;
    const px = b.x * TILE;
    const py = b.y * TILE;
    const cx = px + TILE / 2;
    const cy = py + TILE / 2;

    switch (b.kind) {
      case 'belt': {
        ctx.fillStyle = '#4a4f57';
        ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
        this.drawArrow(cx, cy, b.dir, '#767e89');
        if (b.item) {
          const d = dirVec(b.dir);
          const f = b.progress - 0.5;
          this.drawItem(cx + d.x * f * TILE, cy + d.y * f * TILE, b.item);
        }
        return;
      }
      case 'miner':
        this.machineBox(px, py, '#b8860b');
        break;
      case 'smelter': {
        this.machineBox(px, py, '#a04a32');
        if (b.crafting) {
          ctx.fillStyle = '#ffb347';
          ctx.fillRect(px + 12, py + 12, 8, 8);
        }
        break;
      }
      case 'generator': {
        this.machineBox(px, py, '#3d4450');
        ctx.fillStyle = b.fuel > 0 ? '#f4d03f' : '#6b7280';
        ctx.font = 'bold 16px system-ui';
        ctx.fillText('⚡', px + 8, py + 22);
        break;
      }
      case 'assembler-ammo':
        this.machineBox(px, py, '#3f6d9e');
        break;
      case 'assembler-shell':
        this.machineBox(px, py, '#6a5aa8');
        break;
      case 'turret':
      case 'cannon': {
        const spec = BUILDING_DEFS[b.kind].turret!;
        ctx.fillStyle = b.kind === 'turret' ? '#71797f' : '#4e5359';
        ctx.beginPath();
        ctx.arc(cx, cy, TILE / 2 - 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = b.shots > 0 ? '#d7dce2' : '#e74c3c';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        const d = dirVec(b.dir);
        ctx.lineTo(cx + d.x * 12, cy + d.y * 12);
        ctx.stroke();
        // Ammo pips.
        const pips = Math.min(5, Math.ceil((b.shots / spec.shotsPerItem) * 2));
        ctx.fillStyle = '#f0d048';
        for (let i = 0; i < pips; i++) ctx.fillRect(px + 4 + i * 5, py + TILE - 6, 4, 3);
        return;
      }
    }

    // Machines: direction notch + craft progress bar.
    this.drawArrow(cx, cy, b.dir, 'rgba(255,255,255,0.55)');
    if (b.craftProgress > 0 || b.crafting) {
      ctx.fillStyle = '#111';
      ctx.fillRect(px + 3, py + TILE - 7, TILE - 6, 4);
      ctx.fillStyle = '#7ec97e';
      ctx.fillRect(px + 3, py + TILE - 7, (TILE - 6) * Math.min(1, b.craftProgress), 4);
    }
    if (b.output) this.drawItem(px + TILE - 7, py + 7, b.output);
  }

  private machineBox(px: number, py: number, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
    this.ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(px + 2, py + 2, TILE - 4, TILE - 4);
  }

  private drawArrow(cx: number, cy: number, dir: Dir, color: string): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((dir * Math.PI) / 2);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 3);
    ctx.lineTo(-5, 3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawItem(x: number, y: number, item: ItemType): void {
    const { ctx } = this;
    ctx.fillStyle = ITEM_COLORS[item];
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private drawEnemies(): void {
    const { ctx, game } = this;
    for (const e of game.enemies) {
      const p = enemyPos(game, e);
      ctx.fillStyle = ENEMY_COLORS[e.kind];
      ctx.beginPath();
      ctx.arc(p.x, p.y, e.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 2;
      ctx.stroke();
      if (e.hp < e.maxHp) {
        const w = e.radius * 2;
        ctx.fillStyle = '#111';
        ctx.fillRect(p.x - w / 2, p.y - e.radius - 8, w, 4);
        ctx.fillStyle = '#e74c3c';
        ctx.fillRect(p.x - w / 2, p.y - e.radius - 8, w * (e.hp / e.maxHp), 4);
      }
    }
  }

  private drawEffects(): void {
    const { ctx, game } = this;
    for (const fx of game.effects) {
      const a = fx.t / fx.max;
      if (fx.kind === 'beam') {
        ctx.strokeStyle = `rgba(240, 208, 72, ${a})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(fx.x, fx.y);
        ctx.lineTo(fx.x2!, fx.y2!);
        ctx.stroke();
      } else {
        ctx.strokeStyle = fx.kind === 'blast' ? `rgba(230, 126, 34, ${a})` : `rgba(231, 76, 60, ${a})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, fx.r! * (1.2 - a * 0.4), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  private drawGhost(): void {
    const { ctx, game, ui } = this;
    const { mx, my } = ui;
    if (!game.inBounds(mx, my)) return;

    // Range preview when hovering an existing turret.
    const hovered = game.buildingAt(mx, my);
    const hoveredSpec = hovered && BUILDING_DEFS[hovered.kind].turret;
    if (hoveredSpec) {
      this.rangeCircle((hovered.x + 0.5) * TILE, (hovered.y + 0.5) * TILE, hoveredSpec.range);
    }

    if (ui.tool === null) return;
    const px = mx * TILE;
    const py = my * TILE;
    if (ui.tool === 'sell') {
      ctx.strokeStyle = '#e74c3c';
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 1, py + 1, TILE - 2, TILE - 2);
      return;
    }
    const ok = game.canPlace(ui.tool, mx, my) && game.money >= BUILDING_DEFS[ui.tool].cost;
    ctx.fillStyle = ok ? 'rgba(126, 201, 126, 0.4)' : 'rgba(231, 76, 60, 0.4)';
    ctx.fillRect(px, py, TILE, TILE);
    this.drawArrow(px + TILE / 2, py + TILE / 2, ui.dir, 'rgba(255,255,255,0.8)');
    const spec = BUILDING_DEFS[ui.tool].turret;
    if (spec) this.rangeCircle(px + TILE / 2, py + TILE / 2, spec.range);
  }

  private rangeCircle(cx: number, cy: number, r: number): void {
    const { ctx } = this;
    ctx.strokeStyle = 'rgba(215, 220, 226, 0.35)';
    ctx.fillStyle = 'rgba(215, 220, 226, 0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function dirVec(dir: Dir): { x: number; y: number } {
  return [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }][dir];
}
