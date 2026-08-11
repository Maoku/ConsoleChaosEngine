/**
 * M0 comparison runtime. This route is compiled out of production because
 * bootstrap only reaches it behind import.meta.env.DEV.
 */
import {
  createBrowserLoopHost,
  createCanvasCommandRenderer,
  createGameHost,
  createKeyboardGamepadSource,
  createNullAudioService,
  observeCanvasResize,
} from '@console-chaos/engine';
import { createConsoleChaosModule } from './app';
import { loadLevel } from './level/loader';

const canvas = document.querySelector<HTMLCanvasElement>('#screen');
if (!canvas) throw new Error('Missing #screen canvas');

const params = new URLSearchParams(location.search);
const levelId = params.get('level') ?? 'area1';
const level = await loadLevel(`${import.meta.env.BASE_URL}assets/levels/${levelId}.json`);
const renderer = createCanvasCommandRenderer(canvas);
const resize = observeCanvasResize(canvas, () => renderer.resize());
const host = createGameHost({
  loopHost: createBrowserLoopHost(),
  renderer,
  input: createKeyboardGamepadSource(),
  audio: createNullAudioService(),
  initialGeneration: 'PS1',
  seed: 0x436861,
});

await host.start(createConsoleChaosModule(level));

window.addEventListener('pagehide', () => {
  resize.dispose();
  host.dispose();
}, { once: true });

if (import.meta.env.DEV) {
  (globalThis as Record<string, unknown>)['__consoleChaosEngineComparison'] = host;
}
