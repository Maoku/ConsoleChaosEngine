import {
  BLEND_NONE,
  bindScreen,
  createFramebuffer,
  createStateCache,
  sealShaderCompilation,
  type Framebuffer,
  type GLContext,
  type StateCache,
  type Texture,
} from './gl/index';
import { GENERATION_IDS, HARDWARE_GENERATION_PROFILES, type GenerationId, type HardwareGenerationProfile } from '../generation/profiles';
import { createPostChain, type PostChain, type PostPassSpec } from './postfx/chain';
import { createCrtPasses } from './postfx/crt';
import type { CrtPreset, CrtQuality } from './postfx/presets';
import { createFcQuantizePasses } from './quantize/palette-fc';
import { createSfcQuantizePasses } from './quantize/palette-sfc';
import transitionSource from './shaders/transition';

const PRESENT = 'void main() { fragColor = sampleSource(snapToTexel(vUv, uSourceSize)); }';
const DEFAULT_TRANSITION_COLORS = {
  core: [248 / 255, 248 / 255, 248 / 255],
  lead: [248 / 255, 88 / 255, 136 / 255],
  trail: [24 / 255, 136 / 255, 232 / 255],
} as const;

export type GenerationSceneDrawer = (profile: HardwareGenerationProfile) => void;
export type GenerationSpriteDrawer = (profile: HardwareGenerationProfile) => void;

export interface GenerationPipelineOptions {
  quality: () => CrtQuality;
  glitchAmount?: () => number;
  crtOverride?: () => Partial<CrtPreset>;
  backgroundPaletteIndex?: (generation: GenerationId) => number;
  transitionColors?: {
    core: readonly [number, number, number];
    lead: readonly [number, number, number];
    trail: readonly [number, number, number];
  };
}

export interface GenerationRenderRequest {
  generation: GenerationId;
  from?: GenerationId | null;
  blend?: number;
  screenWidth: number;
  screenHeight: number;
  timeSeconds: number;
}

export interface GenerationPipeline {
  sceneTarget(generation: GenerationId): Framebuffer;
  spriteTarget(generation: GenerationId): Framebuffer | null;
  render(request: GenerationRenderRequest, drawScene: GenerationSceneDrawer, drawSprites?: GenerationSpriteDrawer): void;
  readonly lastGenerationsDrawn: number;
  readonly allocatedGenerationTargets: number;
  dispose(): void;
}

function quantizePassesFor(
  profile: HardwareGenerationProfile,
  scene: () => Framebuffer,
  sprites: () => Framebuffer | null,
  backgroundIndex: () => number,
): PostPassSpec[] {
  const spriteTexture = (): Texture => {
    const target = sprites();
    if (!target) throw new Error(`${profile.id} requires a sprite composition target`);
    return target.color;
  };
  const { internalWidth: width, internalHeight: height } = profile.video;
  if (profile.video.paletteMode === 'fixed54') {
    return createFcQuantizePasses({
      width,
      height,
      scene: () => scene().color,
      sprites: spriteTexture,
      backgroundIndex,
    });
  }
  if (profile.video.paletteMode === 'rgb555') {
    return createSfcQuantizePasses({ width, height, sprites: spriteTexture });
  }
  return [];
}

export function createGenerationPipeline(ctx: GLContext, options: GenerationPipelineOptions): GenerationPipeline {
  const state: StateCache = createStateCache(ctx);
  const scenes = {} as Record<GenerationId, Framebuffer>;
  const sprites = {} as Record<GenerationId, Framebuffer | null>;
  const chains = {} as Record<GenerationId, PostChain>;

  for (const id of GENERATION_IDS) {
    const profile = HARDWARE_GENERATION_PROFILES[id];
    scenes[id] = createFramebuffer(ctx, {
      width: profile.video.internalWidth,
      height: profile.video.internalHeight,
      filter: profile.video.textureFilter,
      depth: profile.video.depthBuffer,
    });
    const needsSpritePlane = profile.video.spriteComposition === 'separate-plane';
    sprites[id] = needsSpritePlane
      ? createFramebuffer(ctx, {
          width: profile.video.internalWidth,
          height: profile.video.internalHeight,
          filter: profile.video.textureFilter,
        })
      : null;
    chains[id] = createPostChain(ctx, state, [
      ...quantizePassesFor(
        profile,
        () => scenes[id],
        () => sprites[id],
        () => options.backgroundPaletteIndex?.(id) ?? 52,
      ),
      ...createCrtPasses({
        signal: () => profile.video.signal,
        quality: options.quality,
        contentSize: () => ({ width: profile.video.internalWidth, height: profile.video.internalHeight }),
        ...(options.crtOverride ? { override: options.crtOverride } : {}),
      }),
      { name: 'present', fragmentSource: PRESENT, enabled: () => options.quality() === 'off' },
    ]);
  }

  const outputs: [Framebuffer, Framebuffer] = [
    createFramebuffer(ctx, { width: 1, height: 1, filter: 'linear' }),
    createFramebuffer(ctx, { width: 1, height: 1, filter: 'linear' }),
  ];
  let blendValue = 0;
  let glitchValue = 0;
  const colors = options.transitionColors ?? DEFAULT_TRANSITION_COLORS;
  const compose = createPostChain(ctx, state, [{
    name: 'transition',
    fragmentSource: transitionSource,
    uniforms: () => ({
      uPrevious: outputs[0].color,
      uBlend: blendValue,
      uGlitch: glitchValue,
      uRibbonCore: colors.core,
      uRibbonLead: colors.lead,
      uRibbonTrail: colors.trail,
    }),
  }]);
  sealShaderCompilation();
  let lastGenerationsDrawn = 0;

  function renderGeneration(
    id: GenerationId,
    request: GenerationRenderRequest,
    drawScene: GenerationSceneDrawer,
    drawSprites: GenerationSpriteDrawer | undefined,
    target: Framebuffer,
  ): void {
    const profile = HARDWARE_GENERATION_PROFILES[id];
    const scene = scenes[id];
    scene.bind();
    state.apply({
      depthTest: profile.video.depthBuffer,
      depthWrite: profile.video.depthBuffer,
      blend: BLEND_NONE,
      cull: 'back',
    });
    state.clear(0, 0, 0, 1, profile.video.depthBuffer);
    drawScene(profile);
    const plane = sprites[id];
    if (plane) {
      plane.bind();
      state.apply({ depthTest: false, depthWrite: false, blend: BLEND_NONE, cull: 'back' });
      state.clear(0, 0, 0, 0, false);
      drawSprites?.(profile);
    }
    chains[id].run(scene.color, request.screenWidth, request.screenHeight, request.timeSeconds, target);
  }

  return {
    sceneTarget: (generation) => scenes[generation],
    spriteTarget: (generation) => sprites[generation],
    get lastGenerationsDrawn() {
      return lastGenerationsDrawn;
    },
    get allocatedGenerationTargets() {
      return GENERATION_IDS.length;
    },
    render(request, drawScene, drawSprites): void {
      const blend = request.blend ?? 1;
      const from = request.from ?? null;
      const transitioning = from !== null && from !== request.generation && blend < 1;
      if (transitioning) {
        renderGeneration(from, request, drawScene, drawSprites, outputs[0]);
        lastGenerationsDrawn = 2;
      } else {
        lastGenerationsDrawn = 1;
      }
      renderGeneration(request.generation, request, drawScene, drawSprites, outputs[1]);
      blendValue = transitioning ? blend : 1;
      glitchValue = transitioning ? (options.glitchAmount?.() ?? 1) : 0;
      bindScreen(ctx, request.screenWidth, request.screenHeight);
      compose.run(outputs[1].color, request.screenWidth, request.screenHeight, request.timeSeconds);
    },
    dispose(): void {
      compose.dispose();
      for (const output of outputs) output.dispose();
      for (const id of GENERATION_IDS) {
        chains[id].dispose();
        scenes[id].dispose();
        sprites[id]?.dispose();
      }
    },
  };
}
