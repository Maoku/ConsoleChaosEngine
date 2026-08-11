import {
  createAssetManager,
  createBrowserLoopHost,
  createGameHost,
  createGenerationWebGlRenderer,
  createNullAudioService,
  createNullInputSource,
} from '@console-chaos/engine';
import { createRacingGameModule } from '../app';
import { RACING_MASTER_SCORE } from '../content/audio/score';
import { createRacingRenderManifest } from '../presentation/catalog';

const canvas = document.querySelector<HTMLCanvasElement>('#proof-canvas');
const status = document.querySelector<HTMLElement>('#status');
const output = document.querySelector<HTMLElement>('#results');
if (!canvas || !status || !output) throw new Error('Performance proof DOM is incomplete');
window.addEventListener('error', (event) => {
  status.textContent = `FAIL: ${event.error instanceof Error ? `${event.error.name}: ${event.error.message}` : event.message}`;
});
window.addEventListener('unhandledrejection', (event) => {
  status.textContent = `FAIL: ${event.reason instanceof Error ? `${event.reason.name}: ${event.reason.message}` : String(event.reason)}`;
});

status.textContent = 'Loading renderer…';
const assets = createAssetManager();
const renderer = await createGenerationWebGlRenderer(canvas, {
  assets,
  manifest: createRacingRenderManifest(),
  quality: () => 'light',
});
const host = createGameHost({
  loopHost: createBrowserLoopHost(),
  input: createNullInputSource(),
  renderer,
  audio: createNullAudioService(RACING_MASTER_SCORE.bpm),
  assets,
  initialGeneration: 'PS2',
  seed: 0x72616365,
});
status.textContent = 'Starting host…';
await host.start(createRacingGameModule());

status.textContent = 'Measuring 180 frames…';
const timestamps: number[] = [];
await new Promise<void>((resolve) => {
  const measure = (time: number): void => {
    timestamps.push(time);
    if (timestamps.length >= 181) resolve();
    else requestAnimationFrame(measure);
  };
  requestAnimationFrame(measure);
});
const intervals = timestamps.slice(1).map((time, index) => time - (timestamps[index] ?? time));
const ordered = [...intervals].sort((left, right) => left - right);
const averageFrameMs = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
const p95FrameMs = ordered[Math.floor(ordered.length * 0.95)] ?? Infinity;
const beforeDispose = {
  allocatedTargets: renderer.allocatedTargets,
  renderedGenerations: renderer.renderedGenerations,
  triangleCount: renderer.triangleCount,
  activeAssets: host.context.assets.activeCount,
  generationListeners: host.context.events.listenerCount('generationSwitch'),
};
host.dispose();
const proof = {
  frames: intervals.length,
  averageFrameMs,
  p95FrameMs,
  ...beforeDispose,
  activeAssetsAfterDispose: host.context.assets.activeCount,
  listenersAfterDispose: host.context.events.listenerCount('generationSwitch'),
};
const passed = averageFrameMs < 20
  && p95FrameMs < 34
  && proof.allocatedTargets === 4
  && proof.renderedGenerations === 1
  && proof.triangleCount < 60_000
  && proof.activeAssetsAfterDispose === 0
  && proof.listenersAfterDispose === 0;
const labels: Record<keyof typeof proof, string> = {
  frames: 'Measured frames',
  averageFrameMs: 'Average frame (ms)',
  p95FrameMs: 'P95 frame (ms)',
  allocatedTargets: 'Generation targets',
  renderedGenerations: 'Rendered generations',
  triangleCount: 'Last frame triangles',
  activeAssets: 'Active assets before dispose',
  generationListeners: 'Generation listeners before dispose',
  activeAssetsAfterDispose: 'Active assets after dispose',
  listenersAfterDispose: 'Listeners after dispose',
};
for (const [key, value] of Object.entries(proof) as Array<[keyof typeof proof, number]>) {
  const term = document.createElement('dt');
  const detail = document.createElement('dd');
  term.textContent = labels[key];
  detail.textContent = Number.isInteger(value) ? String(value) : value.toFixed(4);
  output.append(term, detail);
}
status.textContent = passed ? 'PASS' : 'FAIL';
status.dataset.status = passed ? 'pass' : 'fail';
document.documentElement.dataset.performanceProof = passed ? 'pass' : 'fail';
(globalThis as Record<string, unknown>)['__racingPerformanceProof'] = proof;
