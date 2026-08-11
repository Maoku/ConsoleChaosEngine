import {
  ENGINE_VERSION,
  createAssetManager,
  createBrowserLoopHost,
  createGameHost,
  createGenerationAudioService,
  createGenerationWebGlRenderer,
  createKeyboardGamepadSource,
  createNullAudioService,
  installAudioUnlock,
  observeCanvasResize,
} from '@console-chaos/engine';
import { createRacingGameModule } from './app';
import { RACING_MASTER_SCORE } from './content/audio/score';
import { createRacingRenderManifest } from './presentation/catalog';
import { createRacingHud, hudModelFromRace } from './ui/hud';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('Missing #game canvas');
const hudRoot = document.querySelector<HTMLElement>('#racing-hud');
if (!hudRoot) throw new Error('Missing #racing-hud');

canvas.width = 960;
canvas.height = 672;
const assets = createAssetManager();
const renderer = await createGenerationWebGlRenderer(canvas, {
  assets,
  manifest: createRacingRenderManifest(),
});
const input = createKeyboardGamepadSource();
let audio = createNullAudioService(RACING_MASTER_SCORE.bpm);
try {
  audio = createGenerationAudioService(new AudioContext({ latencyHint: 'interactive' }), RACING_MASTER_SCORE);
} catch {
  // Web Audio can be unavailable in automated browsers; racing remains playable without sound.
}

const hud = createRacingHud(hudRoot);
const resize = observeCanvasResize(canvas, () => renderer.resize());
const unlock = installAudioUnlock(document, () => audio.unlock());
const host = createGameHost({
  loopHost: createBrowserLoopHost(),
  renderer,
  input,
  audio,
  assets,
  initialGeneration: 'PS1',
  seed: 0x72616365,
});

await host.start(createRacingGameModule({
  onCreate(state, generation) {
    hud.update(hudModelFromRace(state, generation));
  },
  onFixedUpdate(state, generation, events) {
    hud.update(hudModelFromRace(state, generation), events, state);
  },
}));

window.addEventListener('pagehide', () => {
  resize.dispose();
  unlock.dispose();
  hud.dispose();
  host.dispose();
}, { once: true });

document.documentElement.dataset.racingEngine = ENGINE_VERSION;
document.documentElement.dataset.racingRenderer = 'generation-webgl';
if (import.meta.env.DEV) {
  (globalThis as Record<string, unknown>)['__racing'] = { host, renderer };
}
