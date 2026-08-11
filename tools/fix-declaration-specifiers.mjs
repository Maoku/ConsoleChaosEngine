import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const directory = process.argv[2];
if (!directory)
  throw new Error(
    "Usage: node tools/fix-declaration-specifiers.mjs <declaration-directory>",
  );

const root = resolve(directory);
if (!(await stat(root)).isDirectory())
  throw new Error(`Not a directory: ${root}`);

const runtimeExtension = /\.(?:[cm]?js|json|node)$/;
const relativeSpecifier = /(['"])(\.\.?\/[^'"]+)\1/g;

async function visit(current) {
  const entries = await readdir(current, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        return;
      }
      if (!entry.name.endsWith(".d.ts")) return;

      const source = await readFile(path, "utf8");
      const updated = source.replace(
        relativeSpecifier,
        (match, quote, specifier) =>
          runtimeExtension.test(specifier)
            ? match
            : `${quote}${specifier}.js${quote}`,
      );
      if (updated !== source) await writeFile(path, updated);
    }),
  );
}

await visit(root);
