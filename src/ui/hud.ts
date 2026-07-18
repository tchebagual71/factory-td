import { BUILDING_DEFS } from '../core/config';
import type { Game } from '../core/game';
import type { Building, BuildingKind, ItemType } from '../core/types';
import type { UiState } from './input';

/**
 * DOM sidebar/topbar. Toolbar buttons are generated from BUILDING_DEFS, so a
 * new building added to config shows up automatically.
 */
export class Hud {
  private buttons = new Map<string, HTMLButtonElement>();
  private el = {
    money: document.getElementById('stat-money')!,
    lives: document.getElementById('stat-lives')!,
    wave: document.getElementById('stat-wave')!,
    power: document.getElementById('stat-power')!,
    startWave: document.getElementById('start-wave') as HTMLButtonElement,
    speed: document.getElementById('speed-btn') as HTMLButtonElement,
    toolbar: document.getElementById('toolbar')!,
    info: document.getElementById('info')!,
    message: document.getElementById('message')!,
  };

  speed = 1;

  constructor(private game: Game, private ui: UiState) {
    for (const def of Object.values(BUILDING_DEFS)) {
      const btn = document.createElement('button');
      btn.innerHTML = `${def.hotkey}. ${def.name} <span class="cost">$${def.cost}</span>`;
      btn.title = def.desc;
      btn.addEventListener('click', () => this.selectTool(def.kind));
      this.el.toolbar.appendChild(btn);
      this.buttons.set(def.kind, btn);
    }
    const sellBtn = document.createElement('button');
    sellBtn.textContent = 'X. Sell (50% refund)';
    sellBtn.addEventListener('click', () => this.selectTool('sell'));
    this.el.toolbar.appendChild(sellBtn);
    this.buttons.set('sell', sellBtn);

    this.el.startWave.addEventListener('click', () => game.startWave());
    this.el.speed.addEventListener('click', () => {
      this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 4 : 1;
      this.el.speed.textContent = `${this.speed}×`;
    });

    window.addEventListener('keydown', (ev) => {
      for (const def of Object.values(BUILDING_DEFS)) {
        if (ev.key === def.hotkey) this.selectTool(def.kind);
      }
    });
  }

  private selectTool(tool: BuildingKind | 'sell'): void {
    this.ui.tool = this.ui.tool === tool ? null : tool;
  }

  refresh(): void {
    const { game, el } = this;
    el.money.textContent = String(game.money);
    el.lives.textContent = String(game.lives);
    el.wave.textContent = String(game.wave);
    el.power.textContent = `${game.power.supply}/${game.power.demand}`;
    (el.power as HTMLElement).style.color =
      game.power.satisfaction < 1 ? '#e74c3c' : '';

    el.startWave.disabled = game.phase !== 'build';
    el.startWave.textContent =
      game.phase === 'combat' ? `Wave ${game.wave} in progress…` : `▶ Start Wave ${game.wave + 1} (Space)`;

    for (const [kind, btn] of this.buttons) {
      btn.classList.toggle('selected', this.ui.tool === kind);
      if (kind !== 'sell') {
        btn.disabled = game.money < BUILDING_DEFS[kind as BuildingKind].cost;
      }
    }

    el.message.textContent = game.messageAge < 4 ? game.message : '';
    el.info.textContent = this.infoText();
  }

  private infoText(): string {
    const { game, ui } = this;
    if (ui.tool && ui.tool !== 'sell') return BUILDING_DEFS[ui.tool].desc;
    if (ui.tool === 'sell') return 'Click a building to sell it.';
    const b = game.inBounds(ui.mx, ui.my) ? game.buildingAt(ui.mx, ui.my) : null;
    if (!b) return 'Select a building, or hover one for details.';
    return describeBuilding(b);
  }
}

function describeBuilding(b: Building): string {
  const def = BUILDING_DEFS[b.kind];
  const lines = [def.name];
  const inputs = Object.entries(b.input)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([item, n]) => `${item} ×${n}`);
  if (inputs.length) lines.push(`in: ${inputs.join(', ')}`);
  if (b.output) lines.push(`out: ${b.output} (blocked)`);
  if (b.crafting) lines.push(`crafting ${b.crafting.output} ${(b.craftProgress * 100) | 0}%`);
  if (def.turret) lines.push(`shots: ${b.shots}`);
  if (b.kind === 'generator') lines.push(`fuel: ${b.fuel.toFixed(1)}s`);
  if (b.kind === 'belt' && b.item) lines.push(`carrying ${b.item as ItemType}`);
  return lines.join('\n');
}
