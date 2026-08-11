/**
 * 最小の PNG 読み書き（T1-21）。
 *
 * テクスチャの生成（`make-textures.ts`）と検査（`check-textures.ts`）の両方が
 * PNG を扱うため、依存を増やさずに済む範囲だけを自前で持つ（§1.3）。
 *
 * 対応範囲は**このリポジトリが実際に置く PNG だけ**に絞る:
 *   - 8bit / カラータイプ 2（RGB）と 6（RGBA）
 *   - インターレースなし
 *   - パレット（カラータイプ 3）とグレースケールは読まない
 *
 * 範囲外は黙って無視せず例外にする（asset-rules.md §1 と同じ考え方）。
 */
import { deflateSync, inflateSync } from 'node:zlib';

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA8。長さは width * height * 4 */
  data: Uint8Array;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, payload: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), payload]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** RGBA8 を PNG（カラータイプ 6・フィルタ 0）へ書き出す */
export function encodePng(image: RgbaImage): Buffer {
  const { width, height, data } = image;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // フィルタなし。生成する絵は平坦で、圧縮率を競う必要が無い
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** PNG を RGBA8 へ読む。対応範囲外は例外にする */
export function decodePng(buffer: Buffer): RgbaImage {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('PNG の署名が合わない');
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const payload = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === 'IHDR') {
      width = payload.readUInt32BE(0);
      height = payload.readUInt32BE(4);
      const depth = payload[8];
      const colorType = payload[9];
      if (depth !== 8) throw new Error(`ビット深度 ${depth} は読まない（8 のみ）`);
      if (colorType !== 2 && colorType !== 6) {
        throw new Error(`カラータイプ ${colorType} は読まない（2 = RGB / 6 = RGBA のみ）`);
      }
      if (payload[12] !== 0) throw new Error('インターレース PNG は読まない');
      channels = colorType === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(payload));
    } else if (type === 'IEND') {
      break;
    }
  }
  if (width === 0 || height === 0) throw new Error('IHDR が無い');

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const line = new Uint8Array(stride);
  const previous = new Uint8Array(stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const source = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let i = 0; i < stride; i++) {
      const rawByte = source[i]!;
      const a = i >= channels ? line[i - channels]! : 0;
      const b = previous[i]!;
      const c = i >= channels ? previous[i - channels]! : 0;
      let value = rawByte;
      if (filter === 1) value = rawByte + a;
      else if (filter === 2) value = rawByte + b;
      else if (filter === 3) value = rawByte + ((a + b) >> 1);
      else if (filter === 4) value = rawByte + paeth(a, b, c);
      else if (filter !== 0) throw new Error(`未知のフィルタ ${filter}`);
      line[i] = value & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const target = (y * width + x) * 4;
      out[target] = line[x * channels]!;
      out[target + 1] = line[x * channels + 1]!;
      out[target + 2] = line[x * channels + 2]!;
      out[target + 3] = channels === 4 ? line[x * channels + 3]! : 255;
    }
    previous.set(line);
  }
  return { width, height, data: out };
}
