import {
  createBrowserLoopHost,
  createCanvasCommandRenderer,
  createGameHost,
  createKeyboardGamepadSource,
  createNullAudioService,
  createWebAudioService,
  installAudioUnlock,
  observeCanvasResize,
} from '@console-chaos/engine';
import { RACING_GAME_MODULE } from './app';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('Missing #game canvas');

const renderer = createCanvasCommandRenderer(canvas);
const input = createKeyboardGamepadSource();
let audio = createNullAudioService(132);
try {
  audio = createWebAudioService(new AudioContext({ latencyHint: 'interactive' }), 132);
} catch {
  // Web Audio can be unavailable in automated browsers; racing remains playable without sound.
}

const resize = observeCanvasResize(canvas, () => renderer.resize());
const unlock = installAudioUnlock(document, () => audio.unlock());
const host = createGameHost({
  loopHost: createBrowserLoopHost(),
  renderer,
  input,
  audio,
  initialGeneration: 'PS1',
  seed: 0x72616365,
});

await host.start(RACING_GAME_MODULE);

window.addEventListener('pagehide', () => {
  resize.dispose();
  unlock.dispose();
  host.dispose();
}, { once: true });
