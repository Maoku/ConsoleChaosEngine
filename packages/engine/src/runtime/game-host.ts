import { createAssetManager, type AssetManager } from '../assets/manager';
import { createNullAudioService, type AudioService } from '../audio/service';
import { createEventBus, type EventBus } from '../core/events';
import { createRng, type DeterministicRng } from '../core/rng';
import { createFixedStepLoop, FIXED_DT_MS, FIXED_DT_SECONDS, type FixedStepLoop, type LoopHost } from '../core/time';
import { createWorld, type World } from '../core/world';
import { createGenerationController, type GenerationController, type GenerationSwitchEvent } from '../generation/controller';
import type { GenerationId } from '../generation/profiles';
import { createNullInputSource, type DeviceInputSource } from '../input/device';
import type { DeviceSnapshot } from '../input/actions';
import { createRenderFrame, type RenderFrame } from '../render/frame';
import type { FrameRenderer } from '../render/renderer';

export interface EngineEvents {
  generationSwitch: GenerationSwitchEvent;
  disposed: { moduleId: string };
}

export interface GameContext {
  readonly events: EventBus<EngineEvents>;
  readonly rng: DeterministicRng;
  readonly generation: GenerationController;
  readonly input: {
    readonly snapshot: DeviceSnapshot;
  };
  readonly assets: AssetManager;
  readonly audio: AudioService;
  readonly world: World;
}

export interface FixedUpdateFrame {
  tick: number;
  dtSeconds: number;
  dtMs: number;
}

export interface GameInstance {
  fixedUpdate(frame: FixedUpdateFrame): void;
  buildRenderFrame(frame: RenderFrame, alpha: number): void;
  dispose(): void;
}

export interface GameModule {
  readonly id: string;
  create(context: GameContext): Promise<GameInstance>;
}

export interface GameHostOptions {
  loopHost: LoopHost;
  renderer: FrameRenderer;
  input?: DeviceInputSource;
  audio?: AudioService;
  assets?: AssetManager;
  initialGeneration?: GenerationId;
  seed?: number;
}

export interface GameHost {
  readonly context: GameContext;
  readonly loop: FixedStepLoop;
  readonly running: boolean;
  initialize(module: GameModule): Promise<void>;
  start(module?: GameModule): Promise<void>;
  stop(): void;
  frame(nowMs: number): number;
  dispose(): void;
}

export function createGameHost(options: GameHostOptions): GameHost {
  const events = createEventBus<EngineEvents>();
  const generation = createGenerationController(options.initialGeneration ?? 'PS1');
  const inputSource = options.input ?? createNullInputSource();
  const assets = options.assets ?? createAssetManager();
  const audio = options.audio ?? createNullAudioService();
  const frame = createRenderFrame();
  const inputState: { snapshot: DeviceSnapshot } = { snapshot: inputSource.poll() };
  let instance: GameInstance | null = null;
  let moduleId = 'uninitialized';
  let running = false;
  let disposed = false;

  const context: GameContext = {
    events,
    rng: createRng(options.seed ?? 0x436861),
    generation,
    input: inputState,
    assets,
    audio,
    world: createWorld(),
  };

  generation.onSwitch((event) => {
    audio.setGenerationVoiceLimit(generation.profile.audio.channels);
    events.emit('generationSwitch', event);
  });
  audio.setGenerationVoiceLimit(generation.profile.audio.channels);

  const loop = createFixedStepLoop({
    fixedUpdate(tick): void {
      generation.advance(FIXED_DT_MS);
      inputState.snapshot = inputSource.poll();
      audio.update();
      instance?.fixedUpdate({ tick, dtSeconds: FIXED_DT_SECONDS, dtMs: FIXED_DT_MS });
    },
    render(alpha): void {
      if (!instance) return;
      frame.reset();
      instance.buildRenderFrame(frame, alpha);
      options.renderer.render(frame, generation.profile, generation);
    },
  }, options.loopHost);

  const initialize = async (module: GameModule): Promise<void> => {
    if (disposed) throw new Error('GameHost is disposed');
    if (instance) throw new Error('GameHost already has a module');
    moduleId = module.id;
    instance = await module.create(context);
  };

  return {
    context,
    loop,
    get running() {
      return running;
    },
    initialize,
    async start(module): Promise<void> {
      if (module) await initialize(module);
      if (!instance) throw new Error('Initialize a GameModule before starting');
      if (running) return;
      running = true;
      loop.start();
    },
    stop(): void {
      if (!running) return;
      running = false;
      loop.stop();
    },
    frame: (nowMs) => loop.frame(nowMs),
    dispose(): void {
      if (disposed) return;
      disposed = true;
      running = false;
      loop.stop();
      instance?.dispose();
      instance = null;
      inputSource.dispose();
      assets.dispose();
      audio.dispose();
      context.world.clear();
      options.renderer.dispose();
      events.emit('disposed', { moduleId });
      events.clear();
    },
  };
}

