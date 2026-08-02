export interface UpdatableSystem {
  update(dt: number): void;
}

export interface SimulationSystems {
  wave: UpdatableSystem;
  conveyor: UpdatableSystem;
  production: UpdatableSystem;
  combat: UpdatableSystem;
  logistics: UpdatableSystem;
}

export type SimulationHalt = () => boolean;

export function stepSimulation(s: SimulationSystems, dt: number, halted: SimulationHalt): void {
  s.wave.update(dt);
  if (halted()) return;
  s.conveyor.update(dt);
  if (halted()) return;
  s.production.update(dt);
  if (halted()) return;
  s.combat.update(dt);
  if (halted()) return;
  s.logistics.update(dt);
}
