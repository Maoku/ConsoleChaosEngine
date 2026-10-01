import { describe, expect, it } from 'vitest';
import { createGenerationController, GENERATION_IDS } from '@console-chaos/engine';
import { createNeutralConsoleChaosActions } from '@/config/actions';
import { createStageSession } from '@/gameplay/stage-session';
import { torchExposure, torchPosition } from '@/gameplay/torch';
import { demoStage } from './demo-stage-loader';

describe('seam and carried-light outcomes', () => {
  it.each(GENERATION_IDS)('keeps all shell walls solid and exposes only the bound opening in %s', (generation) => {
    const session = createStageSession(demoStage(3), { generation: createGenerationController(generation) });
    session.tick(createNeutralConsoleChaosActions());
    expect(session.bodies().get('shell-seam')!.solid).toBe(generation !== 'PS1');
    for (const id of ['left', 'right', 'roof', 'back', 'side-l', 'side-r']) expect(session.bodies().get('shell-' + id)!.solid).toBe(true);
    expect(session.cleared).toBe(false);
  });
  it('walks through the visible opening to restore the core', () => {
    const session = createStageSession(demoStage(3), { generation: createGenerationController('PS1'), spawn: [6, 1, 2.5] });
    const neutral = createNeutralConsoleChaosActions();
    for (let t = 0; t < 33; t++) session.tick({ ...neutral, move: [1, 0] });
    for (let t = 0; t < 32; t++) session.tick({ ...neutral, move: [0, -1] });
    expect(session.solved.has('shell-core')).toBe(true);
    expect(session.checkpoints.respawnCount).toBe(0);
  });
  it.each(GENERATION_IDS)('requires the same visible torch distance, without contact, in %s', (generation) => {
    const session = createStageSession(demoStage(3), { generation: createGenerationController(generation), spawn: [30, 1, 0] });
    session.tick(createNeutralConsoleChaosActions());
    expect(session.solved.has('torch-light')).toBe(false);
    session.player.position = [30, 0.8, -2.5];
    session.tick(createNeutralConsoleChaosActions());
    expect(session.solved.has('torch-light')).toBe(generation === 'PS2');
    expect(torchExposure([30, 0.8, -2.5], [30, 3, -6])).toBeGreaterThan(0.12);
    expect(torchPosition([30, 0.8, -2.5])).toEqual([30, 1.4, -2.5]);
    expect(Math.abs(session.player.position[2] - -6)).toBeGreaterThan(3);
  });
  it('does not grant illumination merely by touching a distant unlit mark in 2D', () => {
    const session = createStageSession(demoStage(3), { generation: createGenerationController('FC'), spawn: [30, 3, 0] });
    session.tick(createNeutralConsoleChaosActions());
    expect(session.solved.has('torch-light')).toBe(false);
  });
});
