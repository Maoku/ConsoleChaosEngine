import { describe, expect, it, vi } from 'vitest';
import {
  HARDWARE_GENERATION_PROFILES,
  createDeviceSnapshot,
  createGameHost,
  type FrameRenderer,
  type GenerationId,
  type RenderFrame,
} from '@console-chaos/engine';
import {
  createManualLoopHost,
  createMutableInputSource,
} from '@console-chaos/engine-testkit';
import { createTitleModule } from '../src/app';
import { titleAnimationFrame } from '../src/animation';
import {
  captureEyesFromSearch,
  capturePoseFromSearch,
  captureTimeFromSearch,
  initialGenerationFromSearch,
} from '../src/bootstrap';
import { TITLE_GENERATION_ASSETS } from '../src/render-manifest';

interface CapturedCharacter {
  readonly id: string;
  readonly rotation: number;
  readonly texture: string | undefined;
  readonly tweenTexture: string | undefined;
  readonly textureMix: number | undefined;
}

interface CapturedFrame {
  readonly timeSeconds: number;
  readonly sprites: number;
  readonly backgrounds: number;
  readonly renderGenerations: readonly GenerationId[];
  readonly characters: readonly CapturedCharacter[];
}

function createCapturingRenderer(): FrameRenderer & { readonly frames: CapturedFrame[]; readonly dispose: ReturnType<typeof vi.fn> } {
  const frames: CapturedFrame[] = [];
  const dispose = vi.fn();
  return {
    frames,
    render(frame: RenderFrame, _profile, generation): void {
      frames.push({
        timeSeconds: frame.timeSeconds,
        sprites: frame.sprites.length,
        backgrounds: frame.backgrounds.length,
        renderGenerations: [...generation.renderGenerations()],
        characters: frame.sprites
          .filter((sprite) => sprite.id.startsWith('character:'))
          .map((sprite) => ({
            id: sprite.id,
            rotation: sprite.rotation ?? 0,
            texture: sprite.texture,
            tweenTexture: sprite.tweenTexture,
            textureMix: sprite.textureMix,
          })),
      });
    },
    resize: () => {},
    dispose,
  };
}

describe('title module lifecycle', () => {
  it('validates generation and deterministic capture query parameters', () => {
    expect(initialGenerationFromSearch('?generation=PS2')).toBe('PS2');
    expect(initialGenerationFromSearch('?generation=unknown')).toBe('FC');
    expect(captureTimeFromSearch('?captureTime=0.5')).toBe(0.5);
    expect(captureTimeFromSearch('?captureTime=-1')).toBeNull();
    expect(captureTimeFromSearch('?captureTime=not-a-number')).toBeNull();
    expect(capturePoseFromSearch('?pose=left')).toBe('left');
    expect(capturePoseFromSearch('?pose=unknown')).toBeUndefined();
    expect(captureEyesFromSearch('?eyes=closed')).toBe('closed');
    expect(captureEyesFromSearch('?eyes=unknown')).toBeUndefined();
  });

  it('renders, switches directly and cyclically, preserves phase, and disposes idempotently', async () => {
    const loopHost = createManualLoopHost();
    const input = createMutableInputSource();
    const renderer = createCapturingRenderer();
    const host = createGameHost({ loopHost, input, renderer, initialGeneration: 'FC' });
    await host.initialize(createTitleModule());

    let now = 0;
    host.frame(now);
    host.frame(now += 17);
    expect(renderer.frames.at(-1)).toMatchObject({ sprites: 9, backgrounds: 4 });
    const beforeSwitch = renderer.frames.at(-1)?.timeSeconds ?? 0;

    input.set(createDeviceSnapshot(['KeyE']));
    host.frame(now += 17);
    input.set(createDeviceSnapshot());
    host.frame(now += 17);
    expect(host.context.generation.generation).toBe('SFC');
    expect(renderer.frames.at(-2)?.renderGenerations).toEqual(['FC', 'SFC']);
    expect(renderer.frames.at(-1)?.timeSeconds).toBeGreaterThan(beforeSwitch);
    const cycledFrame = renderer.frames.at(-1)!;
    for (const generation of ['FC', 'SFC'] as const) {
      const animation = titleAnimationFrame(
        HARDWARE_GENERATION_PROFILES[generation],
        cycledFrame.timeSeconds,
        false,
      );
      expect(cycledFrame.characters.find((character) => character.id === `character:${generation}`))
        .toMatchObject({
          rotation: 0,
          texture: TITLE_GENERATION_ASSETS[generation].characterBodies[animation.tween.from],
          tweenTexture: animation.tween.from === animation.tween.to
            ? undefined
            : TITLE_GENERATION_ASSETS[generation].characterBodies[animation.tween.to],
          textureMix: animation.tween.from === animation.tween.to
            ? undefined
            : animation.tween.progress,
        });
    }
    for (let frame = 0; frame < 22; frame += 1) host.frame(now += 17);
    expect(host.context.generation.transition.active).toBe(false);

    for (const [key, generation] of [
      ['Digit1', 'FC'],
      ['Digit2', 'SFC'],
      ['Digit3', 'PS1'],
      ['Digit4', 'PS2'],
    ] as const) {
      input.set(createDeviceSnapshot([key]));
      host.frame(now += 17);
      input.set(createDeviceSnapshot());
      host.frame(now += 17);
      const transitionFrame = renderer.frames.at(-1)!;
      expect(transitionFrame.renderGenerations).toContain(generation);
      const animation = titleAnimationFrame(
        HARDWARE_GENERATION_PROFILES[generation],
        transitionFrame.timeSeconds,
        false,
      );
      const character = transitionFrame.characters.find(
        (candidate) => candidate.id === `character:${generation}`,
      );
      if (generation === 'PS2') {
        expect(character).toMatchObject({
          rotation: 0,
          texture: TITLE_GENERATION_ASSETS.PS2.characterBodies[animation.pose],
          tweenTexture: undefined,
          textureMix: undefined,
        });
      } else {
        expect(character).toMatchObject({
          rotation: 0,
          texture: TITLE_GENERATION_ASSETS[generation].characterBodies[animation.tween.from],
          tweenTexture: animation.tween.from === animation.tween.to
            ? undefined
            : TITLE_GENERATION_ASSETS[generation].characterBodies[animation.tween.to],
          textureMix: animation.tween.from === animation.tween.to
            ? undefined
            : animation.tween.progress,
        });
      }
      for (let frame = 0; frame < 22; frame += 1) host.frame(now += 17);
      expect(host.context.generation.generation).toBe(generation);
      expect(host.context.generation.transition.active).toBe(false);
    }

    const finalTime = renderer.frames.at(-1)?.timeSeconds ?? 0;
    expect(finalTime).toBeGreaterThan(beforeSwitch);
    host.dispose();
    host.dispose();
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(host.context.assets.activeCount).toBe(0);
    expect(host.context.world.entityCount).toBe(0);
  });

  it('renders every generation at zero rotation when reduced motion is active', async () => {
    const renderer = createCapturingRenderer();
    const host = createGameHost({
      loopHost: createManualLoopHost(),
      input: createMutableInputSource(),
      renderer,
      initialGeneration: 'PS2',
    });
    await host.initialize(createTitleModule({ reducedMotion: () => true }));
    host.frame(0);
    host.frame(100);
    expect(renderer.frames.at(-1)?.sprites).toBe(9);
    host.dispose();
  });
});
