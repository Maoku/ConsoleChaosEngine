import { crop } from './geometry';
import { assertImage, createImage, luma, setPixel, type Rgba, type RgbaImage } from './types';

/** Area resampling with premultiplied-alpha color averaging. */
export function resample(image: RgbaImage, targetWidth: number, targetHeight: number): RgbaImage {
  assertImage(image);
  if (targetWidth > image.width || targetHeight > image.height) {
    throw new Error(`area resample does not upscale (${image.width}x${image.height} -> ${targetWidth}x${targetHeight})`);
  }
  const output = createImage(targetWidth, targetHeight);
  const scaleX = image.width / targetWidth;
  const scaleY = image.height / targetHeight;
  for (let y = 0; y < targetHeight; y += 1) {
    const y0 = Math.floor(y * scaleY);
    const y1 = Math.max(Math.ceil((y + 1) * scaleY), y0 + 1);
    for (let x = 0; x < targetWidth; x += 1) {
      const x0 = Math.floor(x * scaleX);
      const x1 = Math.max(Math.ceil((x + 1) * scaleX), x0 + 1);
      let red = 0;
      let green = 0;
      let blue = 0;
      let alphaSum = 0;
      let samples = 0;
      for (let sourceY = y0; sourceY < Math.min(y1, image.height); sourceY += 1) {
        for (let sourceX = x0; sourceX < Math.min(x1, image.width); sourceX += 1) {
          const index = (sourceY * image.width + sourceX) * 4;
          const alpha = (image.data[index + 3] ?? 0) / 255;
          red += (image.data[index] ?? 0) * alpha;
          green += (image.data[index + 1] ?? 0) * alpha;
          blue += (image.data[index + 2] ?? 0) * alpha;
          alphaSum += alpha;
          samples += 1;
        }
      }
      if (samples === 0 || alphaSum === 0) continue;
      setPixel(output, x, y, [
        Math.round(red / alphaSum),
        Math.round(green / alphaSum),
        Math.round(blue / alphaSum),
        Math.round((alphaSum / samples) * 255),
      ]);
    }
  }
  return output;
}

export function resampleCover(image: RgbaImage, targetWidth: number, targetHeight: number): RgbaImage {
  const scale = Math.max(targetWidth / image.width, targetHeight / image.height);
  if (scale > 1) throw new Error(`cover resample does not upscale (${image.width}x${image.height})`);
  const width = Math.max(Math.round(image.width * scale), targetWidth);
  const height = Math.max(Math.round(image.height * scale), targetHeight);
  const scaled = resample(image, width, height);
  const x0 = Math.floor((width - targetWidth) / 2);
  const y0 = Math.floor((height - targetHeight) / 2);
  return crop(scaled, x0, y0, x0 + targetWidth - 1, y0 + targetHeight - 1);
}

/** Deterministic block mode reduction used by Console Chaos textures. */
export function shrinkByMode(image: RgbaImage, factor: number): RgbaImage {
  assertImage(image);
  if (!Number.isInteger(factor) || factor <= 0) throw new Error(`invalid shrink factor: ${factor}`);
  if (image.width % factor !== 0 || image.height % factor !== 0) {
    throw new Error(`${image.width}x${image.height} is not divisible by ${factor}`);
  }
  const width = image.width / factor;
  const height = image.height / factor;
  const output = createImage(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const counts = new Map<string, { readonly rgba: Rgba; count: number }>();
      for (let blockY = 0; blockY < factor; blockY += 1) {
        for (let blockX = 0; blockX < factor; blockX += 1) {
          const index = ((y * factor + blockY) * image.width + x * factor + blockX) * 4;
          const alpha = image.data[index + 3] ?? 0;
          const rgba: Rgba = alpha === 0
            ? [0, 0, 0, 0]
            : [
                image.data[index] ?? 0,
                image.data[index + 1] ?? 0,
                image.data[index + 2] ?? 0,
                alpha,
              ];
          const key = alpha === 0 ? 'clear' : rgba.join(',');
          const current = counts.get(key);
          if (current) current.count += 1;
          else counts.set(key, { rgba, count: 1 });
        }
      }
      let best: { readonly rgba: Rgba; count: number } = { rgba: [0, 0, 0, 0], count: -1 };
      for (const candidate of counts.values()) {
        const candidateLuma = luma(candidate.rgba[0], candidate.rgba[1], candidate.rgba[2]);
        const bestLuma = luma(best.rgba[0], best.rgba[1], best.rgba[2]);
        if (candidate.count > best.count || (candidate.count === best.count && candidateLuma > bestLuma)) {
          best = candidate;
        }
      }
      setPixel(output, x, y, best.rgba);
    }
  }
  return output;
}
