import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const fixtureRoot = resolve(root, 'tools/fixtures');
const roots = [resolve(root, 'packages'), resolve(root, 'apps')];
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.mjs']);
const importPattern = /(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)['"]([^'"]+)['"]/g;

interface Violation {
  file: string;
  specifier: string;
  reason: string;
}

function filesBelow(directory: string): string[] {
  if (!statSync(directory).isDirectory()) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', 'dist', 'coverage'].includes(entry.name)) return [];
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : sourceExtensions.has(extname(path)) ? [path] : [];
  });
}

function checkFile(path: string): Violation[] {
  const file = relative(root, path).replaceAll('\\', '/');
  const imports = [...readFileSync(path, 'utf8').matchAll(importPattern)].map((match) => match[1] ?? '');
  const violations: Violation[] = [];

  for (const specifier of imports) {
    const add = (reason: string): void => violations.push({ file, specifier, reason });
    if (file.startsWith('tools/fixtures/') && specifier.includes('apps/console-chaos')) {
      add('fixture imports Console Chaos across a forbidden boundary');
    }
    if (file.startsWith('packages/engine/') && (specifier.includes('/apps/') || specifier.startsWith('../../apps/'))) {
      add('engine must not import an app');
    }
    if (file.startsWith('apps/racing/') && (specifier.startsWith('@console-chaos/console-chaos') || specifier.includes('apps/console-chaos'))) {
      add('racing must not import Console Chaos');
    }
    if (file.startsWith('apps/') && /^@console-chaos\/engine\//.test(specifier)) {
      add('apps must use the engine public entry point');
    }
    if (file.startsWith('packages/engine/src/core/') && /(?:platform|render|audio|gameplay|runtime)/.test(specifier)) {
      add('engine core must stay platform and game independent');
    }
  }
  if (file.startsWith('packages/engine/src/')) {
    const source = readFileSync(path, 'utf8');
    if (/\b(?:puzzle|torch|hero|lap|race)\b/i.test(source)) {
      violations.push({ file, specifier: '(source vocabulary)', reason: 'engine contains a game-specific concept' });
    }
  }
  return violations;
}

const fixtureViolations = filesBelow(fixtureRoot).flatMap(checkFile);
if (fixtureViolations.length === 0) throw new Error('boundary self-test fixture was not rejected');

const violations = roots.flatMap(filesBelow).flatMap(checkFile);
if (violations.length > 0) {
  for (const violation of violations) {
    console.error(`${violation.file}: ${violation.reason} (${violation.specifier})`);
  }
  process.exitCode = 1;
} else {
  console.log('✓ package/import boundaries (including violation self-test)');
}
