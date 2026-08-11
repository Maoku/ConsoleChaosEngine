import { describe, expect, it, vi } from 'vitest';
import { createGameHost, type FrameRenderer, type GameModule, type LoopHost } from '../src';

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
    const dispose = vi.fn();
    const module: GameModule = {
      id: 'empty-test',
      async create() {
        return {
          fixedUpdate,
          buildRenderFrame(frame) {
            frame.meshes.push({ id: 'box', geometry: { kind: 'box' }, transform: { position: [0, 0, 0] }, color: '#fff' });
          },
          dispose,
        };
      },
    };
    const host = createGameHost({ loopHost, renderer });
    await host.initialize(module);
    host.frame(0);
    host.frame(17);
    expect(fixedUpdate).toHaveBeenCalledOnce();
    expect(renders).toEqual([1, 1]);
    hidden = true;
    host.frame(1000);
    expect(fixedUpdate).toHaveBeenCalledOnce();
    host.dispose();
    expect(dispose).toHaveBeenCalledOnce();
    expect(renderer.dispose).toHaveBeenCalledOnce();
  });
});
