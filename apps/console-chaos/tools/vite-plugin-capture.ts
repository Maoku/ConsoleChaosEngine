/**
 * 開発サーバ専用のスクリーンショット保存エンドポイント。
 *
 * フェーズ 0 の各検証（T0-08 / T0-10 / T0-11 / T0-19）は
 * 「見え」を Docs/measurements/ に残すことが受け入れ条件になっている。
 * ブラウザからキャンバスの内容を送って保存するための最小の経路であり、
 * 本番ビルドには含まれない（apply: 'serve'）。
 *
 *   await fetch('/__capture', {
 *     method: 'POST',
 *     body: JSON.stringify({ name: 'ps1_quantize_off', dataUrl: canvas.toDataURL() }),
 *   });
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

export function capturePlugin(outputDir: string): Plugin {
  return {
    name: 'chaos-capture',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__capture', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              name?: string;
              dataUrl?: string;
            };
            const name = (body.name ?? 'capture').replace(/[^a-z0-9_-]/gi, '_');
            const dataUrl = body.dataUrl ?? '';
            const comma = dataUrl.indexOf(',');
            if (comma < 0) throw new Error('dataUrl が不正');
            mkdirSync(outputDir, { recursive: true });
            const file = join(outputDir, `${name}.png`);
            writeFileSync(file, Buffer.from(dataUrl.slice(comma + 1), 'base64'));
            res.statusCode = 200;
            res.end(file);
          } catch (e) {
            res.statusCode = 400;
            res.end((e as Error).message);
          }
        });
      });
    },
  };
}
