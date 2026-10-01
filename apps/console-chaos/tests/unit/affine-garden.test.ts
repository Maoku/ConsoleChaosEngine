import { describe, expect, it } from 'vitest';
import { affineUvAt, createGenerationController, validateAffineSurface } from '@console-chaos/engine';
import { createStageSession } from '@/gameplay/stage-session';
import { createNeutralConsoleChaosActions } from '@/config/actions';
import { gardenPoint, gardenState } from '@/gameplay/puzzles/affine-garden';
import { gardenSurface } from '@/presentation/affine-garden';
import { demoStage } from './demo-stage-loader';

describe('CH2 garden', () => {
  it.each([0, Math.PI / 2, Math.PI, Math.PI * 1.5])('matches UV and island XY at angle %s, including zoom and scale', (angle) => {
    for (const scale of [0.97, 1.03]) for (const zoom of [15, 20]) {
      const pose = { ...gardenState(), angle, scale, center: [34, -0.25, 0] as [number, number, number] };
      const camera = { projection: 'orthographic' as const, position: [34, 2.75, 18] as const, target: [34, 2.75, 0] as const, orthoHeight: zoom, zoom };
      const command = gardenSurface('disc', pose, camera);
      validateAffineSurface(command, [256, 224]);
      const world = gardenPoint(pose, [-4, 0]);
      const pixel = [128 + (world[0] - 34) * 224 / zoom, 112 - (world[1] - 2.75) * 224 / zoom];
      const uv = affineUvAt(command, [pixel[0]! - command.screenRect[0], pixel[1]! - command.screenRect[1]], 'clamp');
      expect(uv[0]).toBeCloseTo(1 / 6, 9);
      expect(uv[1]).toBeCloseTo(0.5, 9);
    }
  });
  it('carries the grounded rider, freezes on switching and accepts the transported result in another channel', () => {
    const generation = createGenerationController('FC');
    const session = createStageSession(demoStage(2), { generation, spawn: [28.8, 1, 0] });
    const neutral = createNeutralConsoleChaosActions();
    for (let t = 0; t < 28; t++) session.tick({ ...neutral, move: [1, 0] });
    const island = session.bodies().get('disc-island')!;
    expect(session.player.grounded).toBe(true);
    generation.request('SFC');
    const frozen = [...island.position];
    for (let t = 0; t < 10; t++) session.tick(neutral);
    expect(island.position).toEqual(frozen);
    generation.advance(350);
    for (let t = 0; t < 350; t++) session.tick(neutral);
    expect(session.runtime!.gardens.get('disc-relay')!.carriedTicks).toBeGreaterThan(300);
    generation.request('FC'); generation.advance(350);
    const stopped = [...island.position];
    for (let t = 0; t < 25; t++) session.tick({ ...neutral, move: [1, 0] });
    expect(island.position).toEqual(stopped);
    expect(session.solved.has('disc-relay')).toBe(true);
    expect(session.checkpoints.respawnCount).toBe(0);
    session.dispose();
  });
  it('does not award a relay from switching alone or visiting its terminal', () => {
    const session = createStageSession(demoStage(2), { generation: createGenerationController('SFC'), spawn: [39.4, 1, 0] });
    for (let t = 0; t < 400; t++) session.tick(createNeutralConsoleChaosActions());
    expect(session.solved.has('disc-relay')).toBe(false);
    expect(session.cleared).toBe(false);
  });
});
