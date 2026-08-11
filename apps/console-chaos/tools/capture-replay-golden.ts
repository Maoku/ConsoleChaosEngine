import { createHash } from 'node:crypto';
import { readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadReplay, runReplay } from '../tests/unit/replay/harness';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const replayDirectory = join(root, 'tests/unit/replay');
const names = readdirSync(replayDirectory)
  .filter((file) => file.endsWith('.replay.json'))
  .map((file) => file.replace('.replay.json', ''))
  .sort();

const replays = Object.fromEntries(names.map((name) => {
  const state = runReplay(loadReplay(name));
  const canonical = JSON.stringify(state);
  return [name, {
    sha256: createHash('sha256').update(canonical).digest('hex'),
    state,
  }];
}));

const golden = {
  schemaVersion: 1,
  baselineCommit: '628119358e720514a1f17006654f61e82cc4c207',
  canonicalization: 'JSON.stringify(ReplayResult)',
  replays,
};

const output = join(root, 'tests/golden/replay-state.json');
writeFileSync(output, `${JSON.stringify(golden, null, 2)}\n`);
console.log(`Captured ${names.length} replay state hashes in ${output}`);

