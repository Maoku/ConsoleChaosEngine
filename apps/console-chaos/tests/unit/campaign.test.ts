import { describe, expect, it } from 'vitest';
import { createDeviceSnapshot, createGameHost, createNullAudioService, createGenerationController } from '@console-chaos/engine';
import { createManualLoopHost, createMutableInputSource, createRecordingRenderer } from '@console-chaos/engine-testkit';
import { createCampaignModule, type CampaignController } from '@/gameplay/campaign';
import { CAMPAIGN_ID, CONTENT_REVISION } from '@/content/stages';
import { createCampaignStorage, decodeSave, type CampaignSave } from '@/gameplay/save';
import { createReleaseGuard } from '@/config/release-guard';
import { createStageSession } from '@/gameplay/stage-session';
import { createNeutralConsoleChaosActions } from '@/config/actions';
import { demoStage } from './demo-stage-loader';

const stages = [1, 2, 3, 4].map(demoStage);
const save = (): CampaignSave => ({ version: 1, campaign: CAMPAIGN_ID, revision: CONTENT_REVISION, seed: 7,
  stageId: stages[1]!.id, completed: [stages[0]!.id], generation: 'SFC', finished: false,
  state: { checkpointId: 'disc-entry', achievements: ['path-connected'], gardens: { 'disc-relay': { ticks: 35, carriedTicks: 10 } } } });
const flush = async () => { for (let t = 0; t < 8; t++) await Promise.resolve(); };

describe('campaign lifecycle and recovery', () => {
  it('rejects corrupt, incompatible or impossible saves; a missing checkpoint falls back to safe spawn', () => {
    expect(decodeSave(JSON.stringify(save()), stages)).toEqual(save());
    for (const mutation of [
      { version: 2 }, { revision: 'old' }, { seed: -1 }, { completed: [] }, { generation: 'invalid' },
      { state: { ...save().state, achievements: ['unknown'] } },
      { state: { ...save().state, gardens: { 'disc-relay': { ticks: 5, carriedTicks: 10 } } } },
    ]) expect(decodeSave(JSON.stringify({ ...save(), ...mutation }), stages)).toBe(null);
    expect(decodeSave('{', stages)).toBe(null);
    const session = createStageSession(stages[1]!, { generation: createGenerationController('SFC'), seed: 7 });
    session.restore({ ...save().state, checkpointId: 'removed' });
    expect(session.player.position).toEqual(stages[1]!.scene.spawn.position);
    expect(session.solved.has('path')).toBe(true);
    expect(session.bodies().get('disc-island')!.position).not.toEqual([30, -0.25, 0]);
    expect(session.snapshot().gardens).toEqual(save().state.gardens);
    session.dispose();
  });
  it('continues to run with denied storage', () => {
    let failures = 0;
    const storage = createCampaignStorage(stages, { getItem() { throw Error(); }, setItem() { throw Error(); } }, () => failures++);
    expect(storage.read()).toBe(null);
    expect(storage.write(save())).toBe(false);
    expect(failures).toBe(2);
  });
  it('allows a new press after the boundary while waiting for previously held controls', () => {
    const guard = createReleaseGuard();
    guard.lock(createDeviceSnapshot());
    expect(guard.accept(createDeviceSnapshot(['ArrowRight']))).toBe(false);
    expect(guard.accept(createDeviceSnapshot(['ArrowRight']))).toBe(true);
    guard.lock(createDeviceSnapshot(['Space']));
    expect(guard.accept(createDeviceSnapshot(['Space', 'ArrowRight']))).toBe(false);
    expect(guard.accept(createDeviceSnapshot(['ArrowRight']))).toBe(false);
    expect(guard.accept(createDeviceSnapshot(['ArrowRight']))).toBe(true);
  });
  it('waits for keyboard and gamepad release after a transition', () => {
    const guard = createReleaseGuard();
    expect(guard.accept(createDeviceSnapshot(['Space', 'Digit4']))).toBe(false);
    expect(guard.accept(createDeviceSnapshot([], [[0, 1]], [0.5]))).toBe(false);
    expect(guard.accept(createDeviceSnapshot())).toBe(false);
    expect(guard.accept(createDeviceSnapshot(['Space']))).toBe(true);
    guard.lock();
    expect(guard.accept(createDeviceSnapshot(['Space']))).toBe(false);
  });
  it('keeps one world/session across four transitions and saves next-stage progress atomically', async () => {
    const input = createMutableInputSource();
    const host = createGameHost({ loopHost: createManualLoopHost(), input, renderer: createRecordingRenderer(), audio: createNullAudioService() });
    let controller!: CampaignController;
    const writes: CampaignSave[] = [];
    await host.initialize(createCampaignModule({ stages, saved: null, save: (value) => writes.push(structuredClone(value)), onReady: (value) => controller = value }));
    expect(controller.mode).toBe('title');
    let time = 0;
    const step = (ticks = 1) => { for (let t = 0; t < ticks; t++) host.frame(time += 17); };
    const startTick = controller.session!.tickIndex;
    step(10); expect(controller.session!.tickIndex).toBe(startTick);
    controller.startNew(); await flush();
    step(3);
    for (let index = 0; index < 4; index++) {
      const old = controller.session!;
      expect(controller.stageIndex).toBe(index);
      expect(host.context.world.entityCount).toBe(old.entities.size + 1);
      old.restore({ checkpointId: null, achievements: stages[index]!.exit.requires, gardens: {} });
      old.player.position = [...old.bodies().get('goal')!.position];
      step(2);
      expect(controller.mode).toBe(index === 3 ? 'finished' : 'stageComplete');
      const value = writes.at(-1)!;
      expect(decodeSave(JSON.stringify(value), stages)).not.toBe(null);
      expect(value.completed).toHaveLength(index + 1);
      const tick = old.tickIndex; step(4); expect(old.tickIndex).toBe(tick);
      if (index < 3) {
        input.set(createDeviceSnapshot(['Space', 'Digit4', 'ArrowRight'])); step(1);
        controller.next(); controller.next(); await flush(); step(5);
        expect(controller.session!.tickIndex).toBe(0);
        expect(controller.session!.player.position).toEqual(stages[index + 1]!.scene.spawn.position);
        input.set(createDeviceSnapshot()); step(3);
        expect(() => old.tick(createNeutralConsoleChaosActions())).toThrow('Disposed');
      }
    }
    host.dispose(); host.dispose(); expect(host.context.world.entityCount).toBe(0);
  });
  it('restores completed outcomes without confusing current and sibling instances', async () => {
    const host = createGameHost({ loopHost: createManualLoopHost(), renderer: createRecordingRenderer(), audio: createNullAudioService() });
    let controller!: CampaignController;
    await host.initialize(createCampaignModule({ stages, saved: save(), save() {}, onReady: (value) => controller = value }));
    expect(controller.canResume).toBe(true);
    controller.resume(); await flush();
    expect(controller.stageIndex).toBe(1);
    expect(controller.session!.solved.has('path')).toBe(true);
    expect(controller.session!.solved.has('disc-relay')).toBe(false);
    expect(controller.session!.snapshot().gardens).toEqual(save().state.gardens);
    host.dispose();
  });
});
