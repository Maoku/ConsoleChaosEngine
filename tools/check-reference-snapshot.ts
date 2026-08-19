import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

interface SnapshotFile {
  path: string;
  size: number;
  sha256: string;
}

interface Snapshot {
  schemaVersion: number;
  source: {
    repository: string;
    commit: string;
    shortCommit: string;
    status: string;
  };
  fileCount: number;
  files: SnapshotFile[];
}

const EXPECTED_COMMIT = '628119358e720514a1f17006654f61e82cc4c207';
const root = resolve(import.meta.dirname, '..');
const path = resolve(root, 'tools/fixtures/reference-snapshot.json');
const snapshot = JSON.parse(readFileSync(path, 'utf8')) as Snapshot;

function fail(message: string): never {
  throw new Error(`REFERENCE_SNAPSHOT: ${message}`);
}

if (snapshot.schemaVersion !== 1) fail('schemaVersion must be 1');
if (snapshot.source.commit !== EXPECTED_COMMIT) fail(`unexpected commit ${snapshot.source.commit}`);
if (snapshot.source.shortCommit !== EXPECTED_COMMIT.slice(0, 7)) fail('short commit does not match');
if (snapshot.source.status !== 'clean') fail('reference was not recorded as clean');
if (snapshot.fileCount !== snapshot.files.length) fail('fileCount does not match files');
if (snapshot.files.length === 0) fail('no files were recorded');

const seen = new Set<string>();
for (const file of snapshot.files) {
  if (seen.has(file.path)) fail(`duplicate path ${file.path}`);
  seen.add(file.path);
  if (!Number.isSafeInteger(file.size) || file.size < 0) fail(`invalid size for ${file.path}`);
  if (!/^[a-f0-9]{64}$/.test(file.sha256)) fail(`invalid sha256 for ${file.path}`);
}

for (const required of ['package.json', 'src/main.ts', 'tests/unit/replay.test.ts', 'public/assets/levels/area1.json']) {
  if (!seen.has(required)) fail(`required baseline file is missing: ${required}`);
}

const reference = resolve(root, snapshot.source.repository);
if (existsSync(reference)) {
  const head = execFileSync('rtk', ['proxy', 'git', '-C', reference, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const status = execFileSync('rtk', ['proxy', 'git', '-C', reference, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
  if (head !== EXPECTED_COMMIT) fail(`reference HEAD changed to ${head}`);
  if (status !== '') fail('reference worktree is no longer clean');
}

console.log(`✓ reference snapshot: ${snapshot.fileCount} files at ${snapshot.source.shortCommit}`);
