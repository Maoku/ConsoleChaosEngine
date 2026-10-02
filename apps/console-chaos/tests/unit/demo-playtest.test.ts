import { describe, expect, it } from 'vitest';
import { createDeviceSnapshot, createGenerationController } from '@console-chaos/engine';
import { createDemoPlaytest } from '@/debug/demo-playtest';
import { createStageSession } from '@/gameplay/stage-session';
import { demoStage } from './demo-stage-loader';

describe('four-stage playtest summary', () => {
  it('records unique instance outcomes and stage events without storing raw input', () => {
    const log = createDemoPlaytest();
    const session = createStageSession(demoStage(1), { generation: createGenerationController('FC') });
    log.update(session, createDeviceSnapshot(['ArrowRight']));
    session.restore({ checkpointId: 'backside', achievements: ['route-connected'], gardens: {} });
    session.generation.request('PS1'); session.generation.advance(350);
    log.update(session, createDeviceSnapshot([], [[0, 1]]));
    log.update(session, createDeviceSnapshot());
    const record = log.record();
    expect(record.device).toBe('mixed');
    expect(record.stages[0]!.switches).toBe(1);
    expect(record.stages[0]!.instances.find((p) => p.id === 'route')!.solvedAtSeconds).not.toBe(null);
    expect(record.stages[0]!.events.filter((e) => e.kind === 'achievement')).toHaveLength(1);
    expect(record.stages[0]!.events.find((e) => e.kind === 'checkpoint')!.target).toBe('backside');
    expect(JSON.stringify(record)).not.toContain('ArrowRight');
    record.stages.length = 0;
    expect(log.record().stages).toHaveLength(1);
    log.reset(); expect(log.record().stages).toHaveLength(0);
    session.dispose();
  });
});
