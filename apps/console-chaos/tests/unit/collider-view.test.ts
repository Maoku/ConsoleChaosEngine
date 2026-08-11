import { describe, expect, it } from 'vitest';
import { createRenderFrame, type GameContext } from '@console-chaos/engine';
import {
  collectColliderBoxes,
  nearbyHidden,
  touchingBoxes,
  type ColliderBox,
} from '@/debug/collider_view';
import { colliderReportLines } from '@/debug/collider_hud';
import { createConsoleChaosPresentation } from '@/presentation/frame';
import type { Session } from '@/gameplay/session';
import { createTestSession, tickSession } from './session-testkit';
import { loadLevelFile } from './replay/harness';

const area1 = loadLevelFile('area1');

function run(generation: 'FC' | 'SFC' | 'PS1' | 'PS2'): {
  session: Session;
  boxes: ColliderBox[];
} {
  const session = createTestSession({ level: area1, generation });
  for (let index = 0; index < 16; index++) tickSession(session, null);
  const presentation = createConsoleChaosPresentation(area1);
  const frame = createRenderFrame();
  presentation.build(frame, session, { generation: session.generation } as unknown as GameContext);
  return { session, boxes: collectColliderBoxes(session, frame) };
}

function kindOf(boxes: readonly ColliderBox[], id: string): string | undefined {
  return boxes.find((box) => box.id === id)?.kind;
}

describe('collider debug classification', () => {
  it('lists every body plus the player exactly once', () => {
    const { boxes } = run('PS1');
    const collidable = area1.entities.filter((entity) => entity.collider).length;
    expect(boxes).toHaveLength(collidable + 1);
    expect(kindOf(boxes, 'player')).toBe('player');
    expect(kindOf(boxes, 'start_floor_a')).toBe('solid');
  });

  it('keeps collision-only shell plates purple and passable bodies blue', () => {
    const ps1 = run('PS1').boxes;
    for (const id of ['p1_2_wall_top', 'p1_2_wall_right', 'p1_2_wall_front']) {
      expect(kindOf(ps1, id), id).toBe('proxy');
    }
    expect(kindOf(ps1, 'p1_2_seam')).toBe('passable');
    expect(kindOf(run('PS2').boxes, 'p1_2_seam')).toBe('proxy');
  });

  it('has no accidental invisible solid in any generation', () => {
    for (const generation of ['FC', 'SFC', 'PS1', 'PS2'] as const) {
      expect(run(generation).boxes.filter((box) => box.kind === 'hidden').map((box) => box.id)).toEqual([]);
    }
  });

  it('emits one generic wireframe command per collider only while enabled', () => {
    const session = createTestSession({ level: area1, generation: 'PS1' });
    const presentation = createConsoleChaosPresentation(area1);
    const context = { generation: session.generation } as unknown as GameContext;
    const disabled = createRenderFrame();
    presentation.build(disabled, session, context);
    expect(disabled.meshes.some((mesh) => mesh.wireframe)).toBe(false);

    presentation.toggleColliders();
    const enabled = createRenderFrame();
    presentation.build(enabled, session, context);
    const commands = enabled.meshes.filter((mesh) => mesh.wireframe);
    expect(commands).toHaveLength(presentation.colliderBoxes.length);
    expect(commands.every((mesh) => mesh.geometry.kind === 'box')).toBe(true);
  });
});

describe('collider debug report', () => {
  it('reports the floor under the player and the current channel', () => {
    const { session, boxes } = run('PS1');
    expect(touchingBoxes(session, boxes).map((box) => box.id)).toContain('start_floor_a');
    const lines = colliderReportLines(session, boxes);
    expect(lines[2]).toContain('CH 3');
    expect(lines[3]).toContain('start_floor_a(実体)');
  });

  it('sorts nearby invisible bodies and excludes distant ones', () => {
    const { session, boxes } = run('PS1');
    const withHidden: ColliderBox[] = [
      ...boxes,
      { id: 'ghost_wall', kind: 'hidden', center: [...session.player.position], half: [1, 1, 1] },
      { id: 'far_ghost', kind: 'hidden', center: [999, 0, 0], half: [1, 1, 1] },
    ];
    expect(nearbyHidden(session, withHidden).map(([id]) => id)).toEqual(['ghost_wall']);
  });
});
