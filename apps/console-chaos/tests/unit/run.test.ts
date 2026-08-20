import { describe, expect, it } from 'vitest';
import { createNeutralConsoleChaosActions } from '@/config/actions';
import { startNewRun } from '@/gameplay/run';
import { loadLevelFile } from './replay/harness';
import { createTestSession } from './session-testkit';

describe('new run', () => {
  it('resets gameplay state and requests FC without changing quick-retry semantics', () => {
    const level = loadLevelFile('area1');
    const session = createTestSession({ level, generation: 'PS2' });
    session.player.position = [29.5, 0.5, 0];
    session.tick(createNeutralConsoleChaosActions());
    expect(session.solved).toContain('F-1');

    startNewRun(session);
    expect(session.generation.generation).toBe('FC');
    expect(session.solved.size).toBe(0);
    expect(session.player.position).toEqual(level.spawn.position);
  });
});
