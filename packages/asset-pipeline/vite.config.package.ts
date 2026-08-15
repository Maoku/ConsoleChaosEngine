import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'node22',
    sourcemap: true,
    emptyOutDir: true,
    lib: {
      entry: {
        index: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
        cli: fileURLToPath(new URL('./src/cli.ts', import.meta.url)),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: [/^node:/, '@console-chaos/engine'],
    },
  },
});
