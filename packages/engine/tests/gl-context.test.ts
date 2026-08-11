import { describe, expect, it, vi } from 'vitest';
import { createGLContext } from '../src/render/gl/context';
import { orientImageBitmap } from '../src/render/gl/texture';

function createFakeCanvas(): HTMLCanvasElement {
  const maxTextureSize = 0x0d33;
  const maxColorAttachments = 0x8cdf;
  const gl = {
    MAX_TEXTURE_SIZE: maxTextureSize,
    MAX_COLOR_ATTACHMENTS: maxColorAttachments,
    getParameter(parameter: number) {
      if (parameter === maxTextureSize) return 8192;
      if (parameter === maxColorAttachments) return 4;
      return 0;
    },
    getExtension(name: string) {
      return name === 'EXT_color_buffer_float' ? {} : null;
    },
  } as unknown as WebGL2RenderingContext;
  const canvas = new EventTarget();
  Object.assign(canvas, { getContext: vi.fn(() => gl) });
  return canvas as unknown as HTMLCanvasElement;
}

describe('GLContext lifecycle', () => {
  it('tracks context loss, notifies restore, and removes every listener on dispose', () => {
    const canvas = createFakeCanvas();
    const context = createGLContext(canvas);
    const restored = vi.fn();
    const disconnect = context.onRestored(restored);

    expect(context.caps).toEqual({
      maxTextureSize: 8192,
      maxColorAttachments: 4,
      float: true,
    });
    expect(context.lost).toBe(false);

    const lost = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatchEvent(lost);
    expect(lost.defaultPrevented).toBe(true);
    expect(context.lost).toBe(true);

    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(context.lost).toBe(false);
    expect(restored).toHaveBeenCalledOnce();

    disconnect();
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(restored).toHaveBeenCalledOnce();

    context.dispose();
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(context.lost).toBe(false);
  });

  it('bakes vertical orientation into ImageBitmap before WebGL upload', async () => {
    const source = { close: vi.fn() } as unknown as ImageBitmap;
    const oriented = { close: vi.fn() } as unknown as ImageBitmap;
    const factory = vi.fn(async () => oriented) as unknown as typeof createImageBitmap;

    await expect(orientImageBitmap(source, true, factory)).resolves.toBe(oriented);
    expect(factory).toHaveBeenCalledWith(source, { imageOrientation: 'flipY' });
    await expect(orientImageBitmap(source, false, factory)).resolves.toBe(source);
    expect(factory).toHaveBeenCalledOnce();
  });
});
