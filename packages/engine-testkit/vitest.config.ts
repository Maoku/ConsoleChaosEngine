import { defineConfig } from "vitest/config";
import { engineSourceEntry } from "../../vite.config.shared";

export default defineConfig({
  resolve: {
    alias: {
      "@console-chaos/engine": engineSourceEntry,
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
