import type { StageFile, StagePuzzle } from '@/content/stage-schema';
import { parseStage } from '@/content/stage-schema';
import type { LevelEntity } from '@/level/schema';

export function stageEntity(id: string, position: [number, number, number], half: [number, number, number] = [0.5, 0.5, 0.5], solid = false, type = 'platform'): LevelEntity {
  return { id, type, sector: 'room', transform: { position }, collider: { type: 'aabb', halfExtents: half, solid } };
}

export function stageFixture(): StageFile {
  const instance = (id: string): StagePuzzle => ({
    id, kind: 'P1-1', variant: 'crossing',
    bindings: { wall: id + '-wall', terminal: id + '-terminal' },
    achievement: id + '-connected', settings: {},
    hintGenerations: ['PS1', 'PS2'], completionGenerations: ['PS1', 'PS2'],
    hints: ['壁を見よう', '奥へ回ろう', '立体なら裏に道がある', '壁の裏の端子へ進もう'],
  });
  const instances = [instance('a'), instance('b')];
  return parseStage({
    version: 2, id: 'fixture', title: '試作', tagline: 'つなぐ', instances,
    scene: {
      version: 1, id: 'fixture', puzzles: [],
      sectors: [{ id: 'room', center: [6, 0, 0], halfExtents: [20, 10, 10], links: [] }],
      entities: [
        stageEntity('floor', [6, -0.25, 0], [14, 0.25, 4], true),
        stageEntity('a-wall', [4, 1, 0], [0.5, 1, 0.5], true),
        stageEntity('a-terminal', [4, 1, 2]),
        stageEntity('b-wall', [8, 1, 0], [0.5, 1, 0.5], true),
        stageEntity('b-terminal', [8, 1, 2]),
        stageEntity('gate', [11, 1, 0], [0.25, 1, 4], true),
        stageEntity('goal', [12, 1, 0], [0.5, 1, 1], false, 'goal'),
      ],
      checkpoints: [{ id: 'start', position: [0, 1, 0], sector: 'room' }],
      spawn: { position: [0, 1, 0], facing: 1, sector: 'room' },
    },
    exit: { goal: 'goal', blocker: 'gate', requires: ['a-connected', 'b-connected'] },
  });
}
