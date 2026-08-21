import { describe, expect, it } from 'vitest';
import { loadGltf, type GltfIO } from '../src/assets/gltf';

describe('glTF external buffer paths', () => {
  it('resolves a buffer next to a glTF opened with a Windows path', async () => {
    const modelPath = String.raw`C:\workspace\apps\console-chaos\public\assets\models\player.gltf`;
    const requestedBinaryPaths: string[] = [];
    const io: GltfIO = {
      async fetchJson(url) {
        expect(url).toBe(modelPath);
        return {
          asset: { version: '2.0' },
          buffers: [{ uri: 'player.bin', byteLength: 0 }],
        };
      },
      async fetchBinary(url) {
        requestedBinaryPaths.push(url);
        return new ArrayBuffer(0);
      },
    };

    await loadGltf(modelPath, io);

    expect(requestedBinaryPaths).toEqual([
      String.raw`C:\workspace\apps\console-chaos\public\assets\models\player.bin`,
    ]);
  });
});
