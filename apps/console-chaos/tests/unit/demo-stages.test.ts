import { describe, expect, it } from 'vitest';
import { createGenerationController } from '@console-chaos/engine';
import { demoStage } from './demo-stage-loader';
import { createStageSession } from '@/gameplay/stage-session';
import { createNeutralConsoleChaosActions } from '@/config/actions';


describe('authored demo routes', () => {
  it('crosses the merged bridge, walks around the wall in depth and reaches the powered exit', () => {
    const generation = createGenerationController('FC');
    const session = createStageSession(demoStage(1), { generation });
    const move = (direction: [number, number], ticks: number) => {
      for (let t = 0; t < ticks; t++) session.tick({ ...createNeutralConsoleChaosActions(), move: direction });
    };
    move([1, 0], 285);
    expect(session.solved.has('route')).toBe(true);
    expect(session.snapshot().checkpointId).toBe('backside');
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

describe('powered final device', () => {
  it.each(['merge-connected', 'relay-transported', 'heart-restored', 'beam-lit'])('keeps the exit shut when %s is missing', (missing) => {
    const stage = demoStage(4);
    const session = createStageSession(stage, { generation: createGenerationController('FC') });
    session.restore({ checkpointId: null, achievements: stage.exit.requires.filter((id) => id !== missing), gardens: {} });
    session.player.position = [67, 1.25, 0];
    session.tick(createNeutralConsoleChaosActions());
    expect(session.cleared).toBe(false);
    expect(session.bodies().get('gate')!.solid).toBe(true);
    session.dispose();
  });
  it('allows the bridge alternate route without mistaking it for the final merged connection', () => {
    const session = createStageSession(demoStage(4), { generation: createGenerationController('PS1'), spawn: [22, 1, 0] });
    session.tick(createNeutralConsoleChaosActions());
    expect(session.solved.has('merge')).toBe(false);
    session.generation.request('FC'); session.generation.advance(350);
    session.tick(createNeutralConsoleChaosActions());
    expect(session.solved.has('merge')).toBe(true);
  });
});
