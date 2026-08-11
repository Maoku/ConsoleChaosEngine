import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import chaos from './tools/eslint-rules/index.js';

/**
 * 依存方向（IMPLEMENTATION_PLAN §4.2）を機械化する。
 *
 *         ui/          debug/
 *           |             |
 *       gameplay/  <---  level/
 *           |
 *       generation/
 *        /    |    \
 *   render/ audio/ input/
 *        \    |    /
 *          core/
 */
const layerRules = [
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/render/*', '@/audio/*', '@/input/*', '@/generation/*', '@/gameplay/*', '@/level/*', '@/ui/*', '@/debug/*', '../render/*', '../audio/*', '../input/*', '../generation/*', '../gameplay/*', '../level/*', '../ui/*', '../debug/*'],
              message: 'core/ は他のどのレイヤにも依存できない（§4.2）',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/render/**/*.ts', 'src/audio/**/*.ts', 'src/input/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/gameplay/*', '@/ui/*', '@/level/*', '../gameplay/*', '../ui/*', '../level/*'],
              message: 'render/ audio/ input/ は core/ と generation/profiles.ts にのみ依存できる（§4.2）',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/generation/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/gameplay/*', '@/ui/*', '@/level/*', '@/debug/*', '../gameplay/*', '../ui/*', '../level/*', '../debug/*'],
              message: 'generation/ は core/ にのみ依存できる（§4.2）',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/gameplay/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/render/gl/*', '@/render/postfx/*', '@/render/quantize/*', '@/render/shaders/*', '@/render/loader/*', '@/render/pipeline', '@/render/renderer*', '@/ui/*', '../render/gl/*', '../render/postfx/*', '../render/quantize/*', '../render/pipeline', '../ui/*'],
              message:
                'gameplay/ は render/ の内部を知らない。描画コマンドを render/frame.ts に積むだけにする（§4.2）',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/level/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/gameplay/*', '@/render/*', '@/ui/*', '../gameplay/*', '../render/*', '../ui/*'],
              message: 'level/ は core/ にのみ依存できる（§4.2）',
            },
          ],
        },
      ],
    },
  },
];

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'public/**', 'tools/eslint-rules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { chaos },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // 不変条件 I2 / §5.6 の機械検査。例外は 2 ファイルのみ。
    files: ['src/**/*.ts'],
    rules: {
      'chaos/no-generation-branch': [
        'error',
        { allow: ['src/generation/profiles.ts', 'src/render/pipeline.ts'] },
      ],
      'chaos/no-raw-aabb-compare': ['error', { allow: ['src/gameplay/projection.ts'] }],
    },
  },
  ...layerRules,
  {
    files: ['tools/**/*.ts', 'tests/**/*.ts', '*.config.ts'],
    rules: {
      'no-console': 'off',
    },
  },
);
