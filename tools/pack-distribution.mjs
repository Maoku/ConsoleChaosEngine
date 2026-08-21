import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDistributionDiagnostics,
  exitCodeFor,
} from "./distribution-diagnostics.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const artifacts = join(root, "artifacts");
const cache = join(root, "node_modules", ".cache", "npm-pack");
const diagnostics = await createDistributionDiagnostics({
  logPath: join(artifacts, "logs", "pack-distribution.log"),
  title: "Console Chaos distribution packaging started",
});
const packages = [
  {
    workspace: "@console-chaos/engine",
    manifest: "packages/engine/package.json",
  },
  {
    workspace: "@console-chaos/engine-testkit",
    manifest: "packages/engine-testkit/package.json",
  },
  {
    workspace: "@console-chaos/asset-pipeline",
    manifest: "packages/asset-pipeline/package.json",
  },
];

try {
  diagnostics.info(`Workspace root: ${root}`);
  diagnostics.info(`Artifact directory: ${artifacts}`);
  diagnostics.info(`npm cache: ${cache}`);
  await mkdir(artifacts, { recursive: true });
  await mkdir(cache, { recursive: true });

  const packed = [];
  for (const [index, descriptor] of packages.entries()) {
    const manifestPath = join(root, descriptor.manifest);
    diagnostics.info(
      `Package ${index + 1}/${packages.length}: ${descriptor.workspace} (${manifestPath})`,
    );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const baseName = manifest.name.replace(/^@/, "").replaceAll("/", "-");
    const filename = `${baseName}-${manifest.version}.tgz`;
    const path = join(artifacts, filename);
    await rm(path, { force: true });

    await diagnostics.run(
      "npm",
      [
        "pack",
        "--workspace",
        descriptor.workspace,
        "--pack-destination",
        artifacts,
        "--cache",
        cache,
      ],
      {
        cwd: root,
        label: `Build and pack ${descriptor.workspace}`,
      },
    );

    const archive = await readFile(path);
    const sha256 = createHash("sha256").update(archive).digest("hex");
    diagnostics.success(
      `Created ${path} (${archive.byteLength} bytes, sha256 ${sha256})`,
    );
    packed.push({ filename, sha256 });
  }

  const checksumPath = join(artifacts, "SHA256SUMS");
  diagnostics.info(`Writing checksums: ${checksumPath}`);
  await writeFile(
    checksumPath,
    `${packed.map(({ filename, sha256 }) => `${sha256}  ${filename}`).join("\n")}\n`,
  );

  diagnostics.success(`Distribution written to ${artifacts}`);
} catch (error) {
  diagnostics.reportFailure(error);
  process.exitCode = exitCodeFor(error);
} finally {
  diagnostics.info(`Packaging diagnostic log: ${diagnostics.logPath}`);
  await diagnostics.close();
}
