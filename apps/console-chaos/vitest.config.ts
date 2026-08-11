import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // 単体・ゴールデン・リプレイはすべてヘッドレス（描画なし）で回す（§7.1）
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
