import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { sharedViteConfig } from '../../vite.config.shared';

export default defineConfig({
  ...sharedViteConfig,
  resolve: {
    alias: {
      '@racing': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});

