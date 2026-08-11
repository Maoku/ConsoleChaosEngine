/**
 * 開発時アサーション（IMPLEMENTATION_PLAN §3）。
 *
 * `import.meta.env.DEV` を条件にしているため、本番ビルドでは
 * バンドラの dead code elimination により本体ごと除去される。
 */

const DEV = import.meta.env?.DEV ?? true;

export function assert(condition: unknown, message: string): asserts condition {
  if (DEV && !condition) {
    throw new Error(`[assert] ${message}`);
  }
}

/** 到達しないはずの分岐。switch の網羅性チェックにも使う */
export function unreachable(value: never, message = '到達しないはずの分岐'): never {
  throw new Error(`[assert] ${message}: ${JSON.stringify(value)}`);
}
