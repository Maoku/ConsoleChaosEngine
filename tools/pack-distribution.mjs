import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const artifacts = join(root, "artifacts");
const cache = join(root, "node_modules", ".cache", "npm-pack");
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

await mkdir(artifacts, { recursive: true });
await mkdir(cache, { recursive: true });

const packed = [];
for (const descriptor of packages) {
  const manifest = JSON.parse(
    await readFile(join(root, descriptor.manifest), "utf8"),
  );
  const baseName = manifest.name.replace(/^@/, "").replaceAll("/", "-");
  const filename = `${baseName}-${manifest.version}.tgz`;
  const path = join(artifacts, filename);
  await rm(path, { force: true });

  const result = spawnSync(
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
    { cwd: root, stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);

  const sha256 = createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
  packed.push({ filename, sha256 });
}

await writeFile(
  join(artifacts, "SHA256SUMS"),
  `${packed.map(({ filename, sha256 }) => `${sha256}  ${filename}`).join("\n")}\n`,
);

console.log(`Distribution written to ${artifacts}`);
