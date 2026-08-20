import { describe, expect, it } from 'vitest';
import { TICK_MS } from '@console-chaos/engine';
import {
  DEMO_CROSSING_TIMEOUT_TICKS,
  DEMO_SWITCH_SEQUENCE,
  DEMO_TOUR_TICKS,
  createDemoController,
  demoAnchorIssues,
  worldDirectionToMove,
} from '@/gameplay/demo';
import { moveToWorldXZ } from '@/gameplay/player';
import { loadLevelFile } from './replay/harness';
import { createTestSession } from './session-testkit';

const area1 = loadLevelFile('area1');

function runTick(demo: ReturnType<typeof createDemoController>, session: ReturnType<typeof createTestSession>): void {
  const actions = demo.actions(session);
  session.generation.advance(TICK_MS);
  session.tick(actions);
  demo.afterTick(session);
}

describe('area1 idle demo', () => {
  it('inverts every camera basis back to the same world-X direction', () => {
    for (const forward of [[0, -1], [1, 0]] as const) {
      const move = worldDirectionToMove([1, 0], forward);
      expect(moveToWorldXZ(move, forward)[0]).toBeCloseTo(1, 6);
      expect(moveToWorldXZ(move, forward)[1]).toBeCloseTo(0, 6);
    }
  });

  it('switches four generations twice, stays on the derived start floor, then solves F-1', () => {
    const session = createTestSession({ level: area1, generation: 'FC' });
    const demo = createDemoController(area1);
    const switched: string[] = [];
    session.generation.onSwitch(({ to }) => switched.push(to));
    expect(demo.start(session)).toBe(true);

    const floor = area1.entities.find(({ id }) => id === 'start_floor_a')!;
    const inset = session.player.halfExtents[0] + 0.5;
    const minX = floor.transform.position[0] - floor.collider!.halfExtents[0] + inset;
    const maxX = floor.transform.position[0] + floor.collider!.halfExtents[0] - inset;
    for (let tick = 0; tick < DEMO_TOUR_TICKS; tick++) {
      runTick(demo, session);
      if (tick < DEMO_TOUR_TICKS - 1) {
        expect(session.player.position[0]).toBeGreaterThanOrEqual(minX - 0.15);
        expect(session.player.position[0]).toBeLessThanOrEqual(maxX + 0.15);
      }
    }
    expect(switched).toEqual(DEMO_SWITCH_SEQUENCE);
    expect(demo.phase).toBe('crossing');

    while (demo.phase === 'crossing') runTick(demo, session);
    expect(demo.crossingTicks).toBeLessThan(DEMO_CROSSING_TIMEOUT_TICKS);
    expect(session.solved).toContain('F-1');
    expect(demo.phase).toBe('finished');
  });

  it('refuses other levels and validates area1 demo anchors', () => {
    expect(demoAnchorIssues(area1)).toEqual([]);
    const mini = loadLevelFile('mini');
    const session = createTestSession({ level: mini, generation: 'FC' });
    expect(createDemoController(mini).start(session)).toBe(false);
  });

  it('ends after the crossing timeout and re-requests FC after a respawn', () => {
    const session = createTestSession({ level: area1, generation: 'FC' });
    const demo = createDemoController(area1);
    demo.start(session);
    for (let tick = 0; tick < DEMO_TOUR_TICKS; tick++) {
      demo.actions(session);
      session.generation.advance(TICK_MS);
    }
    session.generation.request('PS1');
    session.checkpoints.respawnCount++;
    demo.afterTick(session);
    expect(session.generation.pending).toBe('FC');

    for (let tick = 0; tick < DEMO_CROSSING_TIMEOUT_TICKS; tick++) {
      demo.actions(session);
      demo.afterTick(session);
    }
    expect(demo.phase).toBe('finished');
    expect(session.solved).not.toContain('F-1');
  });
});
