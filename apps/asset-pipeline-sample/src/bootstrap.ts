import {
  GENERATION_IDS,
  HARDWARE_GENERATION_PROFILES,
  type GenerationId,
} from '@console-chaos/engine';
import './style.css';

export const DISPLAY_WIDTH = 960;
export const DISPLAY_HEIGHT = 672;

export function initialGenerationFromSearch(search: string): GenerationId {
  const requested = new URLSearchParams(search).get('generation');
  return GENERATION_IDS.find((generation) => generation === requested) ?? 'FC';
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

function requireElement<ElementType extends Element>(selector: string): ElementType {
  const element = document.querySelector<ElementType>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}

function drawScaffold(canvas: HTMLCanvasElement, generation: GenerationId): void {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context is unavailable');
  const profile = HARDWARE_GENERATION_PROFILES[generation];
  context.fillStyle = '#120d2a';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#fff3dc';
  context.textAlign = 'center';
  context.font = '700 42px system-ui, sans-serif';
  context.fillText('Asset Pipeline Sample', canvas.width / 2, canvas.height / 2 - 12);
  context.fillStyle = '#ff6652';
  context.font = '600 24px ui-monospace, monospace';
  context.fillText(
    `${generation} · ${profile.video.internalWidth}×${profile.video.internalHeight}`,
    canvas.width / 2,
    canvas.height / 2 + 36,
  );
}

export function bootstrap(): () => void {
  const canvas = requireElement<HTMLCanvasElement>('#screen');
  const label = requireElement<HTMLElement>('#generation-label');
  const generation = initialGenerationFromSearch(window.location.search);
  canvas.width = DISPLAY_WIDTH;
  canvas.height = DISPLAY_HEIGHT;
  label.textContent = generation;
  drawScaffold(canvas, generation);

  const resize = (): void => fitCanvasToStage(canvas);
  const dispose = (): void => window.removeEventListener('resize', resize);
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('pagehide', dispose, { once: true });
  return dispose;
}

void bootstrap();
