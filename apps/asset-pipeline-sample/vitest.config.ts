import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { engineSourceEntry } from '../../vite.config.shared';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@console-chaos/engine': engineSourceEntry,
      '@console-chaos/engine-testkit': fileURLToPath(
        new URL('../../packages/engine-testkit/src/index.ts', import.meta.url),
      ),
      '@console-chaos/asset-pipeline': fileURLToPath(
        new URL('../../packages/asset-pipeline/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
