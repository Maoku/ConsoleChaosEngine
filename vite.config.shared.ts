import type { UserConfig } from 'vite';

export const sharedViteConfig = {
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
} satisfies UserConfig;

