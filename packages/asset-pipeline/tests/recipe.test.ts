import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cloneImage,
  createImage,
  defineAssetClass,
  defineAssetPipeline,
  encodePng,
  resample,
  runAssetPipeline,
} from '../src/index';
import { parseCliArguments as parseInternalCliArguments } from '../src/cli/args';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'asset-pipeline-fixture-'));
  temporaryDirectories.push(root);
  const source = createImage(4, 4, [0, 0, 0, 255]);
  await writeFile(join(root, 'source.png'), encodePng(source));
  return root;
}

function fixturePipeline(options: { readonly failAt?: string; readonly onBuild?: () => void } = {}) {
  const assetClass = defineAssetClass({
    id: 'fixture',
    colorBudget: { FC: 2, SFC: 2, PS1: 2, PS2: null },
    targetSize: (generation) => ({ FC: 1, SFC: 2, PS1: 2, PS2: 4 })[generation],
  });
  return defineAssetPipeline({
    recipe: { tone: { gamma: 1 }, label: 'fixture' },
    manifestPath: 'generated/manifest.json',
    assets: [
      {
        id: 'sample',
        source: 'source.png',
        assetClass,
        outputs: {
          FC: 'generated/sample-fc.png',
          SFC: 'generated/sample-sfc.png',
          PS1: 'generated/sample-ps1.png',
          PS2: 'generated/sample-ps2.png',
        },
      },
    ],
    build({ generation, source, spec }) {
      options.onBuild?.();
      if (generation === options.failAt) throw new Error(`fixture failure at ${generation}`);
      return spec.width === source.width && spec.height === source.height
        ? cloneImage(source)
        : resample(source, spec.width, spec.height);
    },
  });
}

describe('recipe runner', () => {
  it('builds four generations deterministically and check detects decoded RGBA differences', async () => {
    const root = await fixtureRoot();
    const pipeline = fixturePipeline();
    const first = await runAssetPipeline(pipeline, { command: 'build', baseDir: root });
    expect(first.ok).toBe(true);
    expect(first.plan).toHaveLength(4);
    expect(first.written).toHaveLength(5);
    const firstManifest = await readFile(join(root, 'generated/manifest.json'), 'utf8');
    expect(firstManifest).not.toContain(root);
    expect(firstManifest).not.toMatch(/created|timestamp|20\d\d-/i);

    const second = await runAssetPipeline(pipeline, { command: 'build', baseDir: root });
    expect(second.written).toEqual([]);
    expect(await readFile(join(root, 'generated/manifest.json'), 'utf8')).toBe(firstManifest);
    expect((await runAssetPipeline(pipeline, { command: 'check', baseDir: root })).ok).toBe(true);

    const changed = createImage(1, 1, [255, 255, 255, 255]);
    await writeFile(join(root, 'generated/sample-fc.png'), encodePng(changed));
    const check = await runAssetPipeline(pipeline, { command: 'check', baseDir: root });
    expect(check.ok).toBe(false);
    expect(check.differences).toContain('generated/sample-fc.png: RGBA differs');
  });

  it('rejects unknown overrides and requires explicit all-asset override permission', async () => {
    const root = await fixtureRoot();
    const pipeline = fixturePipeline();
    await expect(
      runAssetPipeline(pipeline, {
        command: 'build',
        baseDir: root,
        only: 'sample',
        overrides: ['tone.unknown=2'],
      }),
    ).rejects.toThrow(/unknown recipe path/);
    await expect(
      runAssetPipeline(pipeline, { command: 'build', baseDir: root, overrides: ['tone.gamma=0.5'] }),
    ).rejects.toThrow(/allow-all-overrides/);
    expect(existsSync(join(root, 'generated'))).toBe(false);
  });

  it('does not write any output when a later generation build fails', async () => {
    const root = await fixtureRoot();
    await expect(
      runAssetPipeline(fixturePipeline({ failAt: 'PS1' }), { command: 'build', baseDir: root }),
    ).rejects.toThrow(/fixture failure/);
    expect(existsSync(join(root, 'generated'))).toBe(false);
  });

  it('dry-run validates inputs and prints a plan without invoking builders', async () => {
    const root = await fixtureRoot();
    let builds = 0;
    const result = await runAssetPipeline(fixturePipeline({ onBuild: () => builds += 1 }), {
      command: 'build',
      baseDir: root,
      dryRun: true,
    });
    expect(result.plan).toHaveLength(4);
    expect(result.dryRun).toBe(true);
    expect(builds).toBe(0);
    expect(existsSync(join(root, 'generated'))).toBe(false);
  });
});

describe('CLI arguments', () => {
  it('parses repeatable generations and overrides and rejects unknown values', () => {
    const parsed = parseInternalCliArguments([
      'build',
      '--config',
      'tools/art.config.mjs',
      '--generation',
      'FC',
      '--generation',
      'PS2',
      '--only',
      'sample',
      '--set',
      'tone.gamma=0.5',
      '--dry-run',
    ]);
    expect(parsed.generations).toEqual(['FC', 'PS2']);
    expect(parsed.overrides).toEqual(['tone.gamma=0.5']);
    expect(parsed.dryRun).toBe(true);
    expect(() => parseInternalCliArguments(['build', '--config', 'x', '--generation', 'PS3'])).toThrow(/unknown generation/);
    expect(() => parseInternalCliArguments(['build', '--config', 'x', '--mystery'])).toThrow(/unknown argument/);
  });

  it('builds and checks a four-generation fixture through the executable CLI', async () => {
    const root = await fixtureRoot();
    const publicEntry = pathToFileURL(resolve(import.meta.dirname, '../src/index.ts')).href;
    await writeFile(
      join(root, 'art.config.mjs'),
      `
import { cloneImage, defineAssetClass, defineAssetPipeline, resample } from ${JSON.stringify(publicEntry)};
const assetClass = defineAssetClass({
  id: 'fixture',
  colorBudget: { FC: 2, SFC: 2, PS1: 2, PS2: null },
  targetSize: generation => ({ FC: 1, SFC: 2, PS1: 2, PS2: 4 })[generation],
});
export default defineAssetPipeline({
  recipe: { tone: { gamma: 1 } },
  assets: [{
    id: 'sample',
    source: 'source.png',
    assetClass,
    outputs: { FC: 'out/fc.png', SFC: 'out/sfc.png', PS1: 'out/ps1.png', PS2: 'out/ps2.png' },
  }],
  build({ source, spec }) {
    return source.width === spec.width ? cloneImage(source) : resample(source, spec.width, spec.height);
  },
});
`,
    );
    const cli = resolve(import.meta.dirname, '../src/cli.ts');
    const tsxLoader = pathToFileURL(resolve(import.meta.dirname, '../../../node_modules/tsx/dist/loader.mjs')).href;
    const run = (command: 'build' | 'check') =>
      spawnSync(process.execPath, ['--import', tsxLoader, cli, command, '--config', 'art.config.mjs'], {
        cwd: root,
        encoding: 'utf8',
      });
    const build = run('build');
    expect(build.status, build.stderr).toBe(0);
    expect(existsSync(join(root, 'out/fc.png'))).toBe(true);
    expect(existsSync(join(root, 'asset-manifest.json'))).toBe(true);
    const check = run('check');
    expect(check.status, check.stderr).toBe(0);
    expect(check.stdout).toContain('Asset check passed (4 outputs)');
  });
});
