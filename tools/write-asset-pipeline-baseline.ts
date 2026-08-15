import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { decodePng, type RgbaImage } from '../apps/console-chaos/tools/png';

const root = resolve(import.meta.dirname, '..');
const textureRoot = resolve(root, 'apps/console-chaos/public/assets/textures');
const output = resolve(root, 'Docs/ASSET_PIPELINE_BASELINE.json');

function pngFilesBelow(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return pngFilesBelow(path);
      return entry.name.endsWith('.png') && statSync(path).isFile() ? [path] : [];
    })
    .sort();
}

function visibleColorCount(image: RgbaImage): number {
  const colors = new Set<string>();
  for (let index = 0; index < image.data.length; index += 4) {
    if (image.data[index + 3] === 0) continue;
    colors.add(`${image.data[index]},${image.data[index + 1]},${image.data[index + 2]}`);
  }
  return colors.size;
}

function alphaMode(image: RgbaImage): 'opaque' | 'binary' | '8bit' {
  let transparent = false;
  for (let index = 3; index < image.data.length; index += 4) {
    const alpha = image.data[index];
    if (alpha !== 255) transparent = true;
    if (alpha !== 0 && alpha !== 255) return '8bit';
  }
  return transparent ? 'binary' : 'opaque';
}

const files = pngFilesBelow(textureRoot).map((path) => {
  const image = decodePng(readFileSync(path));
  const generation = relative(textureRoot, path).split('/')[0] ?? '';
  const colors = visibleColorCount(image);
  return {
    path: relative(root, path).replaceAll('\\', '/'),
    generation,
    width: image.width,
    height: image.height,
    visibleColorCount: colors,
    alphaMode: alphaMode(image),
    paletteColorCount: generation === 'gen4' ? null : colors,
    rgbaSha256: createHash('sha256').update(image.data).digest('hex'),
  };
});

writeFileSync(
  output,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      description: 'Migration oracle for decoded Console Chaos generation textures.',
      generationCommands: [
        'npm run import:textures -w @console-chaos/console-chaos',
        'npm run make:textures -w @console-chaos/console-chaos',
      ],
      files,
    },
    null,
    2,
  )}\n`,
);

console.log(`Wrote ${relative(root, output)} (${files.length} decoded PNG records)`);
