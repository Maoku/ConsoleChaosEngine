import type { RasterSurfaceCommand, Vec2 } from '../frame';

export interface RasterLookupEncoder {
  readonly bytes: Uint8Array;
  readonly rows: number;
  encode(scanlines: Float32Array): Uint8Array;
}

function finite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`Raster surface ${label} must be finite`);
}

export function validateRasterSurface(command: RasterSurfaceCommand, resolution?: Vec2): number {
  const [left, top, width, height] = command.screenRect;
  [left, top, width, height].forEach((value, index) => finite(value, `screenRect[${index}]`));
  if (left < 0 || top < 0 || width <= 0 || height <= 0) {
    throw new Error('Raster surface screenRect must have a non-negative origin and positive size');
  }
  if (!Number.isInteger(height)) throw new Error('Raster surface screenRect height must be an integer');
  const rows = command.scanlines.length / 4;
  if (!Number.isInteger(rows) || rows !== height) {
    throw new Error(`Raster surface ${command.id} requires exactly four scanline values per screen row`);
  }
  if (resolution && (left + width > resolution[0] || top + height > resolution[1])) {
    throw new Error(`Raster surface ${command.id} lies outside the generation target`);
  }
  for (let row = 0; row < rows; row++) {
    const offset = row * 4;
    const center = command.scanlines[offset]!;
    const sourceWidth = command.scanlines[offset + 1]!;
    const sourceY = command.scanlines[offset + 2]!;
    const brightness = command.scanlines[offset + 3]!;
    finite(center, `scanline ${row} center`);
    finite(sourceWidth, `scanline ${row} width`);
    finite(sourceY, `scanline ${row} sourceY`);
    finite(brightness, `scanline ${row} brightness`);
    if (sourceWidth <= 0 || sourceWidth > 1) throw new Error(`Raster surface scanline ${row} width must be in (0, 1]`);
    if (brightness < 0 || brightness > 1) throw new Error(`Raster surface scanline ${row} brightness must be in [0, 1]`);
  }
  return rows;
}

function byte(value: number): number {
  return Math.round(Math.min(Math.max(value, 0), 1) * 255);
}

export function createRasterLookupEncoder(): RasterLookupEncoder {
  let bytes = new Uint8Array(4);
  let rows = 0;
  return {
    get bytes() {
      return bytes;
    },
    get rows() {
      return rows;
    },
    encode(scanlines): Uint8Array {
      rows = scanlines.length / 4;
      if (bytes.length < scanlines.length) bytes = new Uint8Array(scanlines.length);
      for (let index = 0; index < scanlines.length; index += 4) {
        const center = scanlines[index]!;
        const sourceY = scanlines[index + 2]!;
        bytes[index] = byte(center - Math.floor(center));
        bytes[index + 1] = byte(scanlines[index + 1]!);
        bytes[index + 2] = byte(sourceY - Math.floor(sourceY));
        bytes[index + 3] = byte(scanlines[index + 3]!);
      }
      return bytes;
    },
  };
}
