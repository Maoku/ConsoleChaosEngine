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
});
