import { describe, expect, it } from 'vitest';
import { createGenerationController, type GenerationId } from '@console-chaos/engine';
import { createNeutralConsoleChaosActions } from '@/config/actions';
import { createStageSession } from '@/gameplay/stage-session';
import type { Session } from '@/gameplay/session';
import { demoStage } from './demo-stage-loader';

function driver(session: Session) {
  const neutral = createNeutralConsoleChaosActions();
  function step(x = 0, z = 0, jump = false, pressed = false) {
    const move: [number, number] = session.generation.generation === 'PS2' ? [z, -x] : [x, z];
    session.tick({ ...neutral, move, jump: { ...neutral.jump, down: jump, pressed, value: jump ? 1 : 0 } });
  }
  function move(axis: 0 | 2, target: number) {
    let ticks = 0;
    while (Math.abs(session.player.position[axis] - target) > 0.08 && ticks++ < 800) {
      const direction = Math.sign(target - session.player.position[axis]);
      step(axis === 0 ? direction : 0, axis === 2 ? direction : 0);
    }
    expect(ticks, 'blocked at ' + session.player.position.join()).toBeLessThan(800);
    step();
  }
  function channel(id: GenerationId) { session.generation.request(id); session.generation.advance(350); step(); }
  function jumpTo(target: number) {
    expect(session.player.grounded).toBe(true);
    let pressed = true;
    for (let tick = 0; tick < 50; tick++) {
      const x = session.player.position[0] < target - 0.05 ? 1 : 0;
      step(x, 0, true, pressed); pressed = false;
    }
    step();
    expect(session.player.grounded, 'jump landing at ' + session.player.position.join()).toBe(true);
  }
  return { step, move, channel, jumpTo };
}

describe('all four stages through movement and jump input', () => {
  it('reads the learned stones, crosses, rides the garden and leaves stage 2', () => {
    const session = createStageSession(demoStage(2), { generation: createGenerationController('FC') });
    const d = driver(session); d.move(0, 8.75);
    const stones = ['lamp-0', 'lamp-1', 'lamp-2'].map((id) => session.bodies().get(id)!.position[0]);
    d.channel('SFC');
    for (const stone of stones) { d.jumpTo(stone - 0.35); d.move(0, stone + 0.5); }
    d.jumpTo(18.5); d.move(0, 21);
    expect(session.solved.has('path')).toBe(true);
    d.channel('FC'); d.move(0, 30.85); d.channel('SFC');
    for (let t = 0; t < 350; t++) d.step();
    d.channel('FC'); d.move(0, 39.5); d.move(0, 47);
    expect(session.cleared).toBe(true);
    expect(session.checkpoints.respawnCount).toBe(0);
    session.dispose();
  });
  it('restores the shell, walks the projected causeway, lights the remote mark and leaves stage 3', () => {
    const session = createStageSession(demoStage(3), { generation: createGenerationController('FC') });
    const d = driver(session); d.move(0, 5.75); d.channel('PS1'); d.move(2, 2.5); d.move(0, 9); d.move(2, -0.5);
    expect(session.solved.has('shell-core')).toBe(true);
    d.move(2, 2.5); d.move(0, 14); d.channel('FC'); d.move(0, 30); d.channel('PS2'); d.move(2, -2.5);
    expect(session.solved.has('torch-light')).toBe(true);
    d.move(2, 0); d.move(0, 39);
    expect(session.cleared).toBe(true);
    expect(session.checkpoints.respawnCount).toBe(0);
    session.dispose();
  });
  it('performs each of the four final connections and reaches the heart', () => {
    const session = createStageSession(demoStage(4), { generation: createGenerationController('FC') });
    const d = driver(session); d.move(0, 22); d.move(0, 27.85); d.channel('SFC');
    for (let t = 0; t < 350; t++) d.step();
    d.channel('FC'); d.move(0, 37); d.move(0, 41.75); d.channel('PS1');
    d.move(2, 2.5); d.move(0, 45); d.move(2, -0.5);
    d.move(2, 2.5); d.move(0, 50); d.channel('FC'); d.move(0, 60); d.channel('PS2'); d.move(2, -2.5);
    expect([...session.solved].sort()).toEqual(['beam-light', 'heart-core', 'merge', 'relay-relay'].sort());
    d.move(2, 0); d.move(0, 67);
    expect(session.cleared).toBe(true);
    expect(session.checkpoints.respawnCount).toBe(0);
    session.dispose();
  });
});
