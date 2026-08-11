import { describe, expect, it, vi } from 'vitest';
import {
  createDeviceSnapshot,
  createGameHost,
  createNullAudioService,
  type DeviceInputSource,
  type FrameRenderer,
  type GameModule,
  type LoopHost,
} from '../src';

describe('GameHost lifecycle', () => {
  it('runs fixed update/render/dispose for a genre-independent module', async () => {
    let hidden = false;
    const loopHost: LoopHost = {
      now: () => 0,
      requestFrame: () => 1,
      cancelFrame: () => {},
      isHidden: () => hidden,
    };
    const renders: number[] = [];
    const renderer: FrameRenderer = {
      render: (frame) => renders.push(frame.meshes.length),
      resize: () => {},
      dispose: vi.fn(),
    };
    const fixedUpdate = vi.fn();
    const order: string[] = [];
    const input: DeviceInputSource = {
      poll: () => {
        order.push('poll');
        return createDeviceSnapshot();
      },
      dispose: vi.fn(),
    };
    const baseAudio = createNullAudioService();
    const audio = {
      ...baseAudio,
      update: () => order.push('audio'),
    };
    const dispose = vi.fn();
    const module: GameModule = {
      id: 'empty-test',
      async create() {
        return {
          prepareFixedUpdate() {
            order.push('prepare');
          },
          fixedUpdate(frame) {
            order.push('gameplay');
            fixedUpdate(frame);
          },
          buildRenderFrame(frame) {
            frame.meshes.push({ id: 'box', geometry: { kind: 'box' }, transform: { position: [0, 0, 0] }, color: '#fff' });
          },
          dispose,
        };
      },
    };
    const host = createGameHost({ loopHost, renderer, input, audio });
    await host.initialize(module);
    host.frame(0);
    host.frame(17);
    expect(fixedUpdate).toHaveBeenCalledOnce();
    expect(order).toEqual(['poll', 'prepare', 'audio', 'gameplay']);
    expect(renders).toEqual([1, 1]);
    hidden = true;
    host.frame(1000);
    expect(fixedUpdate).toHaveBeenCalledOnce();
    host.dispose();
    expect(dispose).toHaveBeenCalledOnce();
    expect(renderer.dispose).toHaveBeenCalledOnce();
  });

  it('does not accumulate host-owned resources over ten boot/dispose cycles', async () => {
    const disposed = { input: 0, renderer: 0, audio: 0, module: 0 };
    for (let cycle = 0; cycle < 10; cycle++) {
      const loopHost: LoopHost = {
        now: () => 0,
        requestFrame: () => 1,
        cancelFrame: () => {},
        isHidden: () => false,
      };
      const input: DeviceInputSource = {
        poll: () => createDeviceSnapshot(),
        dispose: () => disposed.input++,
      };
      const renderer: FrameRenderer = {
        render: () => {},
        resize: () => {},
        dispose: () => disposed.renderer++,
      };
      const baseAudio = createNullAudioService();
      const audio = { ...baseAudio, dispose: () => disposed.audio++ };
      const module: GameModule = {
        id: `cycle-${cycle}`,
        async create() {
          return {
            fixedUpdate: () => {},
            buildRenderFrame: () => {},
            dispose: () => disposed.module++,
          };
        },
      };
      const host = createGameHost({ loopHost, input, renderer, audio });
      await host.initialize(module);
      host.frame(0);
      host.frame(17);
      host.dispose();
      host.dispose();
      expect(host.context.assets.activeCount).toBe(0);
      expect(host.context.world.entityCount).toBe(0);
    }
    expect(disposed).toEqual({ input: 10, renderer: 10, audio: 10, module: 10 });
  });
});
