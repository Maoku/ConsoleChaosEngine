import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';
import { assertImage, type RgbaImage } from './types';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    table[value] = crc >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, payload: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), payload]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

export function encodePng(image: RgbaImage): Buffer {
  assertImage(image);
  const stride = image.width * 4;
  const raw = Buffer.alloc((stride + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(image.data.buffer, image.data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function paeth(left: number, above: number, upperLeft: number): number {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

export function decodePng(buffer: Uint8Array): RgbaImage {
  const bytes = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('invalid PNG signature');
  }
  let width = 0;
  let height = 0;
  let channels = 0;
  let sawHeader = false;
  const compressed: Buffer[] = [];
  for (let offset = 8; offset + 12 <= bytes.length; ) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new Error('truncated PNG chunk');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const payload = bytes.subarray(offset + 8, offset + 8 + length);
    offset = end;
    if (type === 'IHDR') {
      if (length !== 13) throw new Error('invalid PNG IHDR length');
      width = payload.readUInt32BE(0);
      height = payload.readUInt32BE(4);
      if (payload[8] !== 8) throw new Error(`unsupported PNG bit depth: ${payload[8]}`);
      if (payload[9] !== 2 && payload[9] !== 6) throw new Error(`unsupported PNG color type: ${payload[9]}`);
      if (payload[10] !== 0 || payload[11] !== 0) throw new Error('unsupported PNG compression or filter method');
      if (payload[12] !== 0) throw new Error('interlaced PNG is unsupported');
      channels = payload[9] === 6 ? 4 : 3;
      sawHeader = true;
    } else if (type === 'IDAT') {
      compressed.push(payload);
    } else if (type === 'IEND') {
      break;
    }
  }
  if (!sawHeader || width <= 0 || height <= 0) throw new Error('PNG is missing a valid IHDR');
  if (compressed.length === 0) throw new Error('PNG is missing IDAT data');
  const raw = inflateSync(Buffer.concat(compressed));
  const stride = width * channels;
  const expected = (stride + 1) * height;
  if (raw.length !== expected) throw new Error(`invalid PNG data length: expected ${expected}, received ${raw.length}`);
  const output = new Uint8Array(width * height * 4);
  const line = new Uint8Array(stride);
  const previous = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart] ?? 0;
    const source = raw.subarray(rowStart + 1, rowStart + 1 + stride);
    for (let index = 0; index < stride; index += 1) {
      const left = index >= channels ? (line[index - channels] ?? 0) : 0;
      const above = previous[index] ?? 0;
      const upperLeft = index >= channels ? (previous[index - channels] ?? 0) : 0;
      const input = source[index] ?? 0;
      let value: number;
      if (filter === 0) value = input;
      else if (filter === 1) value = input + left;
      else if (filter === 2) value = input + above;
      else if (filter === 3) value = input + ((left + above) >> 1);
      else if (filter === 4) value = input + paeth(left, above, upperLeft);
      else throw new Error(`unsupported PNG filter: ${filter}`);
      line[index] = value & 0xff;
    }
    for (let x = 0; x < width; x += 1) {
      const sourceIndex = x * channels;
      const outputIndex = (y * width + x) * 4;
      output[outputIndex] = line[sourceIndex] ?? 0;
      output[outputIndex + 1] = line[sourceIndex + 1] ?? 0;
      output[outputIndex + 2] = line[sourceIndex + 2] ?? 0;
      output[outputIndex + 3] = channels === 4 ? (line[sourceIndex + 3] ?? 0) : 255;
    }
    previous.set(line);
  }
  return { width, height, data: output };
}

export function readPng(path: string): RgbaImage {
  return decodePng(readFileSync(path));
}

export function rgbaEqual(left: RgbaImage, right: RgbaImage): boolean {
  return (
    left.width === right.width &&
    left.height === right.height &&
    left.data.length === right.data.length &&
    left.data.every((value, index) => value === right.data[index])
  );
}

/** Avoids Node/zlib-version-only byte churn when decoded pixels did not change. */
export function writePngIfChanged(path: string, image: RgbaImage): boolean {
  if (existsSync(path) && rgbaEqual(readPng(path), image)) return false;
  writeFileSync(path, encodePng(image));
  return true;
}
