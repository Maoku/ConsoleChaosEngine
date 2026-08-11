import type { LoopHost } from '../core/time';

export function createBrowserLoopHost(documentRef: Document = document, windowRef: Window = window): LoopHost {
  return {
    now: () => performance.now(),
    requestFrame: (callback) => windowRef.requestAnimationFrame(() => callback()),
    cancelFrame: (handle) => windowRef.cancelAnimationFrame(handle),
    isHidden: () => documentRef.hidden,
  };
}

export interface WebLifecycle {
  dispose(): void;
}

export function observeCanvasResize(canvas: HTMLCanvasElement, resize: () => void): WebLifecycle {
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  return { dispose: () => observer.disconnect() };
}

export function installAudioUnlock(target: HTMLElement | Document, unlock: () => Promise<void>): WebLifecycle {
  let disposed = false;
  const activate = (): void => {
    if (disposed) return;
    void unlock().then(() => dispose());
  };
  const dispose = (): void => {
    disposed = true;
    target.removeEventListener('pointerdown', activate);
    target.removeEventListener('keydown', activate);
  };
  target.addEventListener('pointerdown', activate, { passive: true });
  target.addEventListener('keydown', activate);
  return { dispose };
}

