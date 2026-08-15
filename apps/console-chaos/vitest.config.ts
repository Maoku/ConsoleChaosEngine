import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { engineSourceEntry } from '../../vite.config.shared';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@console-chaos/engine': engineSourceEntry,
      '@console-chaos/asset-pipeline': fileURLToPath(new URL('../../packages/asset-pipeline/src/index.ts', import.meta.url)),
    },
  },
  test: {
    // 単体・ゴールデン・リプレイはすべてヘッドレス（描画なし）で回す（§7.1）
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
