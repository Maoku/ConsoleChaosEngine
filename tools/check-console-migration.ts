import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Finding {
  file: string;
  rule: string;
}

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE = join(ROOT, 'apps/console-chaos/src');
const FIXTURES = join(ROOT, 'tools/fixtures/console-migration');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs']);

interface Rule {
  name: string;
  pattern: RegExp;
  sourcePath?: RegExp;
}

const RULES: readonly Rule[] = [
  { name: 'legacy generation state machine', pattern: /generation\/(?:switcher|transition)/ },
  { name: 'legacy raw input', pattern: /\b(?:RawInput|createMapper|applyConstraints|createKeyboardSource|createGamepadSource)\b/ },
  { name: 'app-owned loop', pattern: /(?:@\/core\/loop|\bcreateLoop\s*\(|\bbrowserHost\s*\()/ },
  {
    name: 'direct renderer asset load',
    pattern: /\b(?:new\s+Image|fetch|loadGltf)\s*\(/,
    sourcePath: /(?:^|\/)(?:render|presentation)\//,
  },
  { name: 'app-owned generation graphics', pattern: /render\/(?:pipeline|postfx|quantize)/ },
  { name: 'legacy bootstrap', pattern: /import\s*\(\s*['"]\.\/main['"]\s*\)/ },
  { name: 'engine deep import', pattern: /@console-chaos\/engine\// },
  { name: 'app-owned hardware profile literal', pattern: /\bmaxSimultaneousColors\s*:/ },
];

const FORBIDDEN_FILES = [
  'main.ts',
  'generation/profiles.ts',
  'generation/switcher.ts',
  'generation/transition.ts',
  'render/frame.ts',
  'render/pipeline.ts',
  'render/renderer3d.ts',
  'core/loop.ts',
  'audio/director.ts',
  'audio/engine.ts',
] as const;

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (SOURCE_EXTENSIONS.has(extname(path))) files.push(path);
  }
  return files;
}

function scan(directory: string): Finding[] {
  const findings: Finding[] = [];
  for (const file of sourceFiles(directory)) {
    const source = readFileSync(file, 'utf8');
    const sourcePath = relative(directory, file);
    for (const rule of RULES) {
      const fixture = directory === FIXTURES;
      if ((!rule.sourcePath || rule.sourcePath.test(sourcePath) || fixture) && rule.pattern.test(source)) {
        findings.push({ file: relative(ROOT, file), rule: rule.name });
      }
    }
  }
  if (directory === SOURCE) {
    for (const file of FORBIDDEN_FILES) {
      const path = join(directory, file);
      if (existsSync(path)) findings.push({ file: relative(ROOT, path), rule: 'forbidden legacy file' });
    }
  }
  return findings;
}

function selfTest(): void {
  const legacy = scan(FIXTURES).filter((finding) => finding.file.endsWith('legacy.ts'));
  const clean = scan(FIXTURES).filter((finding) => finding.file.endsWith('clean.ts'));
  if (legacy.length < 2) throw new Error('migration checker fixture did not trigger expected violations');
  if (clean.length !== 0) throw new Error('migration checker rejected public engine API fixture');
}

selfTest();
const findings = scan(SOURCE);
if (findings.length > 0) {
  for (const finding of findings) console.error(`${finding.file}: ${finding.rule}`);
  process.exitCode = 1;
} else {
  console.log('Console migration checker: 0 legacy findings, fixture detection passed (strict mode).');
}
