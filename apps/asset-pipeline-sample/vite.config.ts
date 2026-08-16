import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { engineSourceEntry } from '../../vite.config.shared';

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@console-chaos/engine': engineSourceEntry,
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
