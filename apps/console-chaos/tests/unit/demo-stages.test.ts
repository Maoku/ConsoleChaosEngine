import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createGenerationController } from '@console-chaos/engine';
import { parseStage } from '@/content/stage-schema';
import { createStageSession } from '@/gameplay/stage-session';
import { createNeutralConsoleChaosActions } from '@/config/actions';

export function demoStage(index: number) {
  return parseStage(JSON.parse(readFileSync(new URL('../../public/assets/levels/demo_stage' + index + '.json', import.meta.url), 'utf8')));
}

describe('authored demo routes', () => {
  it('crosses the merged bridge, walks around the wall in depth and reaches the powered exit', () => {
    const generation = createGenerationController('FC');
    const session = createStageSession(demoStage(1), { generation });
    const move = (direction: [number, number], ticks: number) => {
      for (let t = 0; t < ticks; t++) session.tick({ ...createNeutralConsoleChaosActions(), move: direction });
    };
    move([1, 0], 285);
    expect(session.solved.has('route')).toBe(true);
    expect(session.solved.has('backside')).toBe(false);
    generation.request('PS1'); generation.advance(350);
    move([0, 1], 28);
    move([1, 0], 64);
    expect(session.solved.has('backside')).toBe(true);
    move([1, 0], 80);
    move([0, -1], 28);
    expect(session.cleared).toBe(true);
    expect(session.checkpoints.respawnCount).toBe(0);
    session.dispose();
  });
});
