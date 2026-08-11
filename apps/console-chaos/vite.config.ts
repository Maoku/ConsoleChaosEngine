import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { capturePlugin } from './tools/vite-plugin-capture';

export default defineConfig({
  // 相対パスで出力し、任意の静的ホスティングに置けるようにする（T4-03）
  base: './',
  plugins: [capturePlugin(fileURLToPath(new URL('./Docs/measurements', import.meta.url)))],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
