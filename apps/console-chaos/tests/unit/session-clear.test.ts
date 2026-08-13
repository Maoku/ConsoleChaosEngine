import { describe, expect, it } from 'vitest';
import { createTestSession, tickSession } from './session-testkit';
import { loadLevelFile } from './replay/harness';

describe('gameplay/session のゴール到達', () => {
  it('ゴール接触を保持し、reset で解除する', () => {
    const level = loadLevelFile('mini');
    const goal = level.entities.find((entity) => entity.type === 'goal');
    if (!goal) throw new Error('mini level is missing its goal');
    const session = createTestSession({ level, generation: 'PS1' });

    expect(session.cleared).toBe(false);
    session.player.position = [...goal.transform.position];
    tickSession(session, null);
    expect(session.cleared).toBe(true);

    session.player.position = [-5, 1, 0];
    tickSession(session, null);
    expect(session.cleared).toBe(true);

    session.reset();
    expect(session.cleared).toBe(false);
  });
});
