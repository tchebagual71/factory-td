import { BUILD_INFO } from '../data/buildings';
import type { BuildingType } from '../types';

export interface CoachFacts {
  buildings: readonly BuildingType[];
  selected: BuildingType | null;
}

export interface CoachMessage {
  step: 1 | 2 | 3 | 4 | 5;
  action: string;
  context: string;
}

const DEFENSE_TYPES: readonly BuildingType[] = ['tower', 'cannon', 'lancer', 'cryo'];

const MILESTONES: Record<CoachMessage['step'], Omit<CoachMessage, 'step'>> = {
  1: { action: 'Place a miner on an orange ore deposit', context: 'Start the line at an ore deposit.' },
  2: { action: 'Route ore from the miner with a belt', context: 'Belts carry every resource in your factory.' },
  3: { action: 'Place a press to turn ore into ammo', context: 'A press needs ore delivered by belt.' },
  4: { action: 'Place a gun tower and feed it ammo', context: 'Towers need ammo to defend the path.' },
  5: { action: 'Launch the wave when your line is ready', context: 'Keep scaling your production between waves.' },
};

/** Returns the next concise onboarding action from the player’s current build progress. */
export function coachMessage(facts: CoachFacts): CoachMessage {
  const step = nextStep(facts.buildings);
  const selected = facts.selected && BUILD_INFO.find((info) => info.type === facts.selected);
  const milestone = MILESTONES[step];

  return {
    step,
    action: milestone.action,
    context: selected ? `${selected.name.toUpperCase()} — ${selected.desc}` : milestone.context,
  };
}

function nextStep(buildings: readonly BuildingType[]): CoachMessage['step'] {
  if (!buildings.includes('miner')) return 1;
  if (!buildings.includes('belt')) return 2;
  if (!buildings.includes('press')) return 3;
  if (!buildings.some((type) => DEFENSE_TYPES.includes(type))) return 4;
  return 5;
}
