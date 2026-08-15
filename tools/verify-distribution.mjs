import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const artifacts = join(root, "artifacts");
const cache = join(root, "node_modules", ".cache", "npm-distribution-smoke");
const engine = JSON.parse(
  await readFile(join(root, "packages/engine/package.json"), "utf8"),
);
const testkit = JSON.parse(
  await readFile(join(root, "packages/engine-testkit/package.json"), "utf8"),
);
const assetPipeline = JSON.parse(
  await readFile(join(root, "packages/asset-pipeline/package.json"), "utf8"),
);
const archiveFor = (manifest) =>
  join(
    artifacts,
    `${manifest.name.replace(/^@/, "").replaceAll("/", "-")}-${manifest.version}.tgz`,
  );
const consumer = await mkdtemp(join(tmpdir(), "console-chaos-distribution-"));

function run(command, args) {
  const result = spawnSync(command, args, { cwd: consumer, stdio: "inherit" });
  if (result.status !== 0)
    throw new Error(
      `${command} failed with status ${result.status ?? "unknown"}`,
    );
}

try {
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify(
      {
        name: "console-chaos-distribution-smoke",
        private: true,
        type: "module",
      },
      null,
      2,
    ),
  );

  run("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--offline",
    "--cache",
    cache,
    archiveFor(engine),
    archiveFor(testkit),
    archiveFor(assetPipeline),
    join(root, "node_modules/gl-matrix"),
  ]);

  await writeFile(
    join(consumer, "smoke.mjs"),
    `
import { ENGINE_VERSION, createRng, createWorld } from '@console-chaos/engine';
import { createRecordingRenderer } from '@console-chaos/engine-testkit';
import { ASSET_PIPELINE_VERSION, createImage, encodePng } from '@console-chaos/asset-pipeline';
import { writeFileSync } from 'node:fs';

if (ENGINE_VERSION !== '${engine.version}') throw new Error('ENGINE_VERSION does not match package version');
if (ASSET_PIPELINE_VERSION !== '${assetPipeline.version}') throw new Error('Asset pipeline version does not match package version');
const sample = createRng(7).int(10);
if (!Number.isInteger(sample) || sample < 0 || sample >= 10) throw new Error('Engine runtime import failed');
if (createWorld().entities().length !== 0) throw new Error('World did not initialize empty');
if (createRecordingRenderer().frames.length !== 0) throw new Error('Testkit runtime import failed');
writeFileSync('source.png', encodePng(createImage(4, 4, [0, 0, 0, 255])));
`,
  );
  run(process.execPath, ["smoke.mjs"]);

  await writeFile(
    join(consumer, "art.config.mjs"),
    `
import { cloneImage, defineAssetClass, defineAssetPipeline, resample } from '@console-chaos/asset-pipeline';

const fixture = defineAssetClass({
  id: 'fixture',
  colorBudget: { FC: 2, SFC: 2, PS1: 2, PS2: null },
  targetSize: generation => ({ FC: 1, SFC: 2, PS1: 2, PS2: 4 })[generation],
});

export default defineAssetPipeline({
  recipe: { tone: { gamma: 1 } },
  assets: [{
    id: 'sample',
    source: 'source.png',
    assetClass: fixture,
    outputs: {
      FC: 'generated/sample-fc.png', SFC: 'generated/sample-sfc.png',
      PS1: 'generated/sample-ps1.png', PS2: 'generated/sample-ps2.png',
    },
  }],
  build({ source, spec }) {
    return source.width === spec.width ? cloneImage(source) : resample(source, spec.width, spec.height);
  },
});
`,
  );
  const assetCli = join(consumer, "node_modules/@console-chaos/asset-pipeline/dist/cli.js");
  run(process.execPath, [assetCli, "build", "--config", "art.config.mjs"]);
  run(process.execPath, [assetCli, "check", "--config", "art.config.mjs"]);

  await writeFile(
    join(consumer, "smoke.ts"),
    `
import { createGameHost, type GameModule, type GenerationId } from '@console-chaos/engine';
import { createManualLoopHost, createRecordingRenderer } from '@console-chaos/engine-testkit';
import {
  defineAssetClass,
  deriveGenerationAssetSpec,
  type RgbaImage,
} from '@console-chaos/asset-pipeline';

const generation: GenerationId = 'PS1';
const module: GameModule = {
  id: 'distribution-smoke',
  async create() {
    return { fixedUpdate() {}, buildRenderFrame() {}, dispose() {} };
  },
};
const host = createGameHost({
  initialGeneration: generation,
  loopHost: createManualLoopHost(),
  renderer: createRecordingRenderer(),
});
void host.initialize(module);
const image: RgbaImage = { width: 1, height: 1, data: new Uint8Array(4) };
void image;
const assetClass = defineAssetClass({
  id: 'type-smoke',
  colorBudget: { FC: 2, SFC: 2, PS1: 2, PS2: null },
  targetSize: () => 1,
});
if (assetClass.specFor('FC').internalWidth !== deriveGenerationAssetSpec('FC').internalWidth) {
  throw new Error('Asset pipeline type/runtime smoke failed');
}
`,
  );
  await writeFile(
    join(consumer, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          lib: ["ES2022", "DOM", "DOM.Iterable"],
        },
        include: ["smoke.ts"],
      },
      null,
      2,
    ),
  );
  run(process.execPath, [
    join(root, "node_modules/typescript/bin/tsc"),
    "-p",
    "tsconfig.json",
  ]);
  console.log("Distribution runtime and type smoke tests passed");
} finally {
  await rm(consumer, { recursive: true, force: true });
}
