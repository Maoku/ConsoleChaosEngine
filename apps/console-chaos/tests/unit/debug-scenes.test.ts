import { describe, expect, it, vi } from 'vitest';
import {
  createDeviceSnapshot,
  createGameHost,
  createNullAudioService,
  type FrameRenderer,
  type RenderFrame,
} from '@console-chaos/engine';
import { createManualLoopHost, createMutableInputSource } from '@console-chaos/engine-testkit';
import {
  DEBUG_SCENES,
  createConsoleDebugModule,
  initialGenerationForScene,
  isConsoleDebugScene,
} from '@/debug/scenes';

describe('legacy debug URL modules', () => {
  it('recognizes every preserved scene route and its initial generation', () => {
    expect(DEBUG_SCENES).toEqual(['ps1', 'fc', 'switch', 'character', 'player', 'blend']);
    for (const scene of DEBUG_SCENES) expect(isConsoleDebugScene(scene)).toBe(true);
    expect(initialGenerationForScene('mini')).toBe('FC');
    expect(initialGenerationForScene('ps1')).toBe('PS1');
    expect(initialGenerationForScene('blend')).toBe('PS1');
    expect(initialGenerationForScene('switch')).toBe('FC');
  });

  it('emits Gen3/Gen4 world and screen sprites with their ordering/depth controls', async () => {
    const rendered: RenderFrame[] = [];
    const renderer: FrameRenderer = {
      render(frame): void {
        rendered.push(frame);
      },
      resize: () => {},
      dispose: () => {},
    };
    const host = createGameHost({
      loopHost: createManualLoopHost(),
      renderer,
      audio: createNullAudioService(),
      initialGeneration: 'PS1',
    });
    await host.initialize(createConsoleDebugModule('blend', { cycleQuality: () => {} }));
    host.frame(0);
    host.frame(17);
    const ps1Sprites = rendered.at(-1)!.sprites;
    expect(ps1Sprites.map((sprite) => sprite.orderTableIndex)).toEqual([10, 11]);
    expect(ps1Sprites.map((sprite) => sprite.hardwareBlend?.family)).toEqual([
      'gen3-semitransparency',
      'gen3-semitransparency',
    ]);

    host.context.generation.request('PS2');
    host.context.generation.advance(350);
    host.frame(34);
    const ps2Sprites = rendered.at(-1)!.sprites;
    expect(ps2Sprites[0]).toMatchObject({ billboard: 'spherical', depthWrite: true });
    expect(ps2Sprites[1]).toMatchObject({ screenSpace: true, depthWrite: false });
    expect(ps2Sprites.map((sprite) => sprite.hardwareBlend?.family)).toEqual(['gen4-gs', 'gen4-gs']);
    host.dispose();
  });

  it.each(DEBUG_SCENES)('boots ?scene=%s through GameHost and emits visible commands', async (scene) => {
    const frames: Array<{ meshes: number; skinned: number }> = [];
    const renderer: FrameRenderer = {
      render(frame: RenderFrame): void {
        frames.push({ meshes: frame.meshes.length, skinned: frame.skinnedMeshes.length });
      },
      resize: () => {},
      dispose: () => {},
    };
    const loop = createManualLoopHost();
    const input = createMutableInputSource();
    const host = createGameHost({
      loopHost: loop,
      input,
      renderer,
      audio: createNullAudioService(),
      initialGeneration: initialGenerationForScene(scene),
    });
    await host.initialize(createConsoleDebugModule(scene, { cycleQuality: () => {} }));
    host.frame(0);
    host.frame(17);

    expect(frames.length).toBeGreaterThan(0);
    expect(frames.at(-1)!.meshes + frames.at(-1)!.skinned).toBeGreaterThan(0);
    host.dispose();
  });

  it('keeps generation and CRT controls on the engine input path', async () => {
    const input = createMutableInputSource();
    const cycleQuality = vi.fn();
    const host = createGameHost({
      loopHost: createManualLoopHost(),
      input,
      renderer: { render: () => {}, resize: () => {}, dispose: () => {} },
      audio: createNullAudioService(),
      initialGeneration: 'FC',
    });
    await host.initialize(createConsoleDebugModule('switch', { cycleQuality }));
    host.frame(0);
    input.set(createDeviceSnapshot(['Digit4', 'KeyQ']));
    host.frame(17);

    expect(host.context.generation.transition.active).toBe(true);
    expect(host.context.generation.transition.to).toBe('PS2');
    expect(host.context.generation.generation).toBe('PS2');
    expect(cycleQuality).toHaveBeenCalledOnce();
    host.dispose();
  });
});
