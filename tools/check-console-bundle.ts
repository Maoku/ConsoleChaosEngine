import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'apps/console-chaos/dist');

function filesBelow(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

const files = filesBelow(dist);
const javascript = files.filter((file) => extname(file) === '.js');
const sourceMaps = files.filter((file) => file.endsWith('.js.map'));
if (javascript.length === 0 || sourceMaps.length === 0) throw new Error('Console production bundle is missing');

const code = javascript.map((file) => readFileSync(file, 'utf8')).join('\n');
const maps = sourceMaps.map((file) => readFileSync(file, 'utf8')).join('\n');
const forbiddenSources = [
  '../../src/main.ts',
  '../../src/generation/switcher.ts',
  '../../src/generation/transition.ts',
  '../../src/input/mapper.ts',
  '../../src/render/pipeline.ts',
  '../../src/render/renderer3d.ts',
  '../../src/audio/director.ts',
];

for (const source of forbiddenSources) {
  if (maps.includes(source)) throw new Error(`Console production bundle contains ${source}`);
}
for (const required of ['../../src/engine-bootstrap.ts', 'packages/engine/src/runtime/game-host.ts']) {
  if (!maps.includes(required)) throw new Error(`Console production bundle is missing ${required}`);
}
if (!code.includes('consoleChaosRuntime') || !code.includes('game-host')) {
  throw new Error('Console production bundle does not expose the GameHost runtime diagnostic');
}
if (code.includes('__consoleChaos')) throw new Error('development runtime global leaked into the production bundle');

const bytes = javascript.reduce((sum, file) => sum + statSync(file).size, 0);
console.log(`✓ Console bundle: GameHost present, legacy sources absent (${javascript.length} chunks / ${bytes} bytes)`);
