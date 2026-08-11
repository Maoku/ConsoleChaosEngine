import type { World } from './world';

export const STAGES = ['input', 'generation', 'constraints', 'gameplay', 'physics', 'triggers', 'audio', 'present'] as const;
export type Stage = (typeof STAGES)[number];
export type System = (world: World, tick: number) => void;

export interface SystemSchedule {
  add(stage: Stage, name: string, run: System): void;
  run(world: World, tick: number): void;
  describe(): string[];
}

export function createSchedule(): SystemSchedule {
  const systems: Array<{ stage: Stage; name: string; run: System }> = [];
  return {
    add(stage, name, run): void {
      if (systems.some((system) => system.name === name)) throw new Error(`システム名が重複している: ${name}`);
      systems.push({ stage, name, run });
    },
    run(world, tick): void {
      for (const stage of STAGES) for (const system of systems) if (system.stage === stage) system.run(world, tick);
    },
    describe(): string[] {
      return STAGES.flatMap((stage) => systems.filter((system) => system.stage === stage).map((system) => `${stage}: ${system.name}`));
    },
  };
}
