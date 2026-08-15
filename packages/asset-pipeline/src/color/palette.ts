import { type Rgb, type RgbaImage } from '../image/types';

export function colorDistance(color: Rgb, red: number, green: number, blue: number): number {
  const deltaRed = color[0] - red;
  const deltaGreen = color[1] - green;
  const deltaBlue = color[2] - blue;
  return (
    0.5 * (deltaRed * deltaRed * 0.3 + deltaGreen * deltaGreen * 0.59 + deltaBlue * deltaBlue * 0.11) +
    (0.5 / 3) * (deltaRed * deltaRed + deltaGreen * deltaGreen + deltaBlue * deltaBlue)
  );
}

export const distance = colorDistance;

export function nearestColor(palette: readonly Rgb[], red: number, green: number, blue: number): Rgb {
  const first = palette[0];
  if (!first) throw new Error('palette must contain at least one color');
  let best = first;
  let bestDistance = Infinity;
  for (const color of palette) {
    const candidateDistance = colorDistance(color, red, green, blue);
    if (candidateDistance < bestDistance) {
      bestDistance = candidateDistance;
      best = color;
    }
  }
  return best;
}

export const nearest = nearestColor;

export function medianCut(pixels: readonly Rgb[], count: number): Rgb[] {
  if (!Number.isInteger(count) || count < 0) throw new Error(`invalid palette size: ${count}`);
  if (count === 0 || pixels.length === 0) return [];
  let boxes: Rgb[][] = [[...pixels]];
  while (boxes.length < count) {
    let target = -1;
    let bestRange = 0;
    let bestChannel = 0;
    boxes.forEach((box, boxIndex) => {
      if (box.length < 2) return;
      for (let channel = 0; channel < 3; channel += 1) {
        let low = 255;
        let high = 0;
        for (const pixel of box) {
          low = Math.min(low, pixel[channel] ?? 0);
          high = Math.max(high, pixel[channel] ?? 0);
        }
        const range = (high - low) * Math.cbrt(box.length);
        if (range > bestRange) {
          bestRange = range;
          target = boxIndex;
          bestChannel = channel;
        }
      }
    });
    if (target < 0) break;
    const targetBox = boxes[target];
    if (!targetBox) break;
    const sorted = targetBox.slice().sort((left, right) => (left[bestChannel] ?? 0) - (right[bestChannel] ?? 0));
    const midpoint = sorted.length >> 1;
    boxes = boxes.filter((_, index) => index !== target).concat([sorted.slice(0, midpoint), sorted.slice(midpoint)]);
  }
  return boxes.filter((box) => box.length > 0).map((box) => {
    const sum = [0, 0, 0];
    for (const pixel of box) {
      sum[0] = (sum[0] ?? 0) + pixel[0];
      sum[1] = (sum[1] ?? 0) + pixel[1];
      sum[2] = (sum[2] ?? 0) + pixel[2];
    }
    return [
      Math.round((sum[0] ?? 0) / box.length),
      Math.round((sum[1] ?? 0) / box.length),
      Math.round((sum[2] ?? 0) / box.length),
    ];
  });
}

export function chooseFromFixedPalette(
  pixels: readonly Rgb[],
  candidates: readonly Rgb[],
  count: number,
): Rgb[] {
  if (!Number.isInteger(count) || count < 0) throw new Error(`invalid palette size: ${count}`);
  const bestDistances = new Float64Array(pixels.length).fill(Infinity);
  const chosen: Rgb[] = [];
  const taken = new Set<number>();
  while (chosen.length < count && taken.size < candidates.length) {
    let winner = -1;
    let winnerError = Infinity;
    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
      if (taken.has(candidateIndex)) continue;
      const candidate = candidates[candidateIndex];
      if (!candidate) continue;
      let error = 0;
      for (let pixelIndex = 0; pixelIndex < pixels.length; pixelIndex += 1) {
        const pixel = pixels[pixelIndex];
        if (!pixel) continue;
        const candidateDistance = colorDistance(candidate, pixel[0], pixel[1], pixel[2]);
        error += Math.min(candidateDistance, bestDistances[pixelIndex] ?? Infinity);
        if (error >= winnerError) break;
      }
      if (error < winnerError) {
        winner = candidateIndex;
        winnerError = error;
      }
    }
    if (winner < 0) break;
    const winnerColor = candidates[winner];
    if (!winnerColor) break;
    taken.add(winner);
    chosen.push(winnerColor);
    for (let pixelIndex = 0; pixelIndex < pixels.length; pixelIndex += 1) {
      const pixel = pixels[pixelIndex];
      if (!pixel) continue;
      bestDistances[pixelIndex] = Math.min(
        bestDistances[pixelIndex] ?? Infinity,
        colorDistance(winnerColor, pixel[0], pixel[1], pixel[2]),
      );
    }
  }
  return chosen;
}

export function samplePixels(image: RgbaImage, alphaFloor = 128): Rgb[] {
  const pixels: Rgb[] = [];
  for (let index = 0; index < image.data.length; index += 4) {
    if ((image.data[index + 3] ?? 0) < alphaFloor) continue;
    pixels.push([image.data[index] ?? 0, image.data[index + 1] ?? 0, image.data[index + 2] ?? 0]);
  }
  return pixels;
}
