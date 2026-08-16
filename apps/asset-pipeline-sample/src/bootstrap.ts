import {
  GENERATION_IDS,
  createAssetManager,
  createBrowserLoopHost,
  createGameHost,
  createGenerationWebGlRenderer,
  createKeyboardGamepadSource,
  observeCanvasResize,
  type GenerationId,
} from '@console-chaos/engine';
import { createTitleModule } from './app';
import { createTitleRenderManifest } from './render-manifest';
import './style.css';

export const DISPLAY_WIDTH = 960;
export const DISPLAY_HEIGHT = 672;

export function initialGenerationFromSearch(search: string): GenerationId {
  const requested = new URLSearchParams(search).get('generation');
  return GENERATION_IDS.find((generation) => generation === requested) ?? 'FC';
}

export function captureTimeFromSearch(search: string): number | null {
  const value = new URLSearchParams(search).get('captureTime');
  if (value === null || value.trim() === '') return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

export function fitCanvasToStage(canvas: HTMLCanvasElement): void {
  const stage = canvas.parentElement;
  if (!stage) return;
  const rect = stage.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const scale = Math.min(rect.width / DISPLAY_WIDTH, rect.height / DISPLAY_HEIGHT, 1);
  canvas.style.width = `${Math.floor(DISPLAY_WIDTH * scale)}px`;
  canvas.style.height = `${Math.floor(DISPLAY_HEIGHT * scale)}px`;
}

async function freezeCaptureFrame(canvas: HTMLCanvasElement): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const image = new Image();
  image.id = canvas.id;
  image.alt = 'Captured Console Chaos Engine title screen';
  image.dataset.captureReady = 'true';
  image.style.width = canvas.style.width;
  image.style.height = canvas.style.height;
  image.src = canvas.toDataURL('image/png');
  await image.decode();
  canvas.replaceWith(image);
}

function requireElement<ElementType extends Element>(selector: string): ElementType {
  const element = document.querySelector<ElementType>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}

export async function bootstrap(): Promise<() => void> {
  const canvas = requireElement<HTMLCanvasElement>('#screen');
  const label = requireElement<HTMLElement>('#generation-label');
  const initialGeneration = initialGenerationFromSearch(window.location.search);
  const captureTime = captureTimeFromSearch(window.location.search);
  canvas.width = DISPLAY_WIDTH;
  canvas.height = DISPLAY_HEIGHT;
  label.textContent = initialGeneration;
  fitCanvasToStage(canvas);

  const assets = createAssetManager();
  const renderer = await createGenerationWebGlRenderer(canvas, {
    assets,
    manifest: createTitleRenderManifest(),
    preserveDrawingBuffer: captureTime !== null,
  });
  const input = createKeyboardGamepadSource();
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reducedMotion = motionPreference.matches;
  const updateMotionPreference = (): void => {
    reducedMotion = motionPreference.matches;
  };
  motionPreference.addEventListener('change', updateMotionPreference);

  const host = createGameHost({
    loopHost: createBrowserLoopHost(),
    renderer,
    input,
    assets,
    initialGeneration,
    seed: 0x41535345,
  });
  const disconnectGeneration = host.context.events.on('generationSwitch', (event) => {
    label.textContent = event.to;
  });
  await host.start(createTitleModule({
    reducedMotion: () => reducedMotion,
    ...(captureTime === null ? {} : { fixedTimeSeconds: captureTime }),
  }));

  if (captureTime !== null) await freezeCaptureFrame(canvas);

  const canvasResize = observeCanvasResize(canvas, () => renderer.resize());
  const windowResize = (): void => fitCanvasToStage(canvas);
  window.addEventListener('resize', windowResize);
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('resize', windowResize);
    motionPreference.removeEventListener('change', updateMotionPreference);
    disconnectGeneration();
    canvasResize.dispose();
    host.dispose();
  };
  window.addEventListener('pagehide', dispose, { once: true });
  return dispose;
}

if (typeof document !== 'undefined') void bootstrap();
