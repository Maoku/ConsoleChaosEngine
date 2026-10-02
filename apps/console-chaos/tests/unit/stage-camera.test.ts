import { describe, expect, it } from 'vitest';
import { createGenerationController, GENERATION_IDS } from '@console-chaos/engine';
import { createStageSession } from '@/gameplay/stage-session';
import { createNeutralConsoleChaosActions } from '@/config/actions';
import { activeGarden } from '@/gameplay/stage-camera';
import { demoStage } from './demo-stage-loader';

describe('garden view and input share a camera', () => {
  it('knows the garden center before its first tick and activates only while the player fits on screen', () => {
    const session = createStageSession(demoStage(2), { generation: createGenerationController('PS2') });
    expect(session.runtime!.gardens.get('disc-relay')!.center).toEqual([34, -0.25, 0]);
    expect(activeGarden(session.runtime, [1, 1, 0])).toBeUndefined();
    expect(activeGarden(session.runtime, [25.9, 1, 0])).toBeUndefined();
    expect(activeGarden(session.runtime, [26, 1, 0])?.[0]).toBe('disc-relay');
  });
  it.each(GENERATION_IDS)('the right input moves right in the garden view after switching to %s', (id) => {
    const generation = createGenerationController('FC');
    const session = createStageSession(demoStage(2), { generation, spawn: [28.8, 1, 0] });
    const neutral = createNeutralConsoleChaosActions();
    for (let t = 0; t < 28; t++) session.tick({ ...neutral, move: [1, 0] });
    generation.request('SFC'); generation.advance(350);
    for (let t = 0; t < 350; t++) session.tick(neutral);
    generation.request(id); generation.advance(350);
    const previousX = session.player.position[0];
    expect(session.profile.theme.camera.forward).toEqual([0, -1]);
    for (let t = 0; t < 35; t++) session.tick({ ...neutral, move: [1, 0] });
    expect(session.player.position[0]).toBeGreaterThan(previousX + 1);
    expect(session.solved.has('disc-relay')).toBe(true);
    expect(session.checkpoints.respawnCount).toBe(0);
    session.dispose();
  });
});
