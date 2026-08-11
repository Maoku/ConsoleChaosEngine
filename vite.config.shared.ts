import { fileURLToPath } from "node:url";
import type { UserConfig } from "vite";

export const engineSourceEntry = fileURLToPath(
  new URL("./packages/engine/src/index.ts", import.meta.url),
);

export const sharedViteConfig = {
  base: "./",
  resolve: {
    alias: {
      "@console-chaos/engine": engineSourceEntry,
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
} satisfies UserConfig;
