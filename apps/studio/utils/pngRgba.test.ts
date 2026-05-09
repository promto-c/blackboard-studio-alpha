import { describe, expect, it } from 'vitest';
import { encodePngRgba } from './pngRgba';

const readUint32BE = (bytes: Uint8Array, offset: number): number =>
  ((bytes[offset] << 24) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]) >>>
  0;

const getChunkType = (bytes: Uint8Array, offset: number): string =>
  String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);

const concat = (parts: Uint8Array[]): Uint8Array => {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.length;
  });
  return output;
};

const inflateStoredZlib = (bytes: Uint8Array): Uint8Array => {
  expect(bytes[0]).toBe(0x78);
  expect(bytes[1]).toBe(0x01);

  const blocks: Uint8Array[] = [];
  let offset = 2;
  while (offset < bytes.length - 4) {
    const header = bytes[offset];
    const isFinal = (header & 1) === 1;
    const blockType = (header >>> 1) & 0x03;
    const length = bytes[offset + 1] | (bytes[offset + 2] << 8);
    const invertedLength = bytes[offset + 3] | (bytes[offset + 4] << 8);
    expect(blockType).toBe(0);
    expect((length ^ invertedLength) & 0xffff).toBe(0xffff);
    blocks.push(bytes.subarray(offset + 5, offset + 5 + length));
    offset += 5 + length;
    if (isFinal) break;
  }

  return concat(blocks);
};

const inflateZlib = async (bytes: Uint8Array): Promise<Uint8Array> => {
  if (typeof DecompressionStream !== 'undefined') {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  return inflateStoredZlib(bytes);
};

const decodeRgbaPng = async (
  blob: Blob,
): Promise<{ width: number; height: number; data: Uint8Array }> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  expect(Array.from(bytes.subarray(0, 8))).toEqual([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);

  let width = 0;
  let height = 0;
  const idatParts: Uint8Array[] = [];
  let offset = 8;
  while (offset < bytes.length) {
    const length = readUint32BE(bytes, offset);
    const type = getChunkType(bytes, offset + 4);
    const dataOffset = offset + 8;
    const data = bytes.subarray(dataOffset, dataOffset + length);

    if (type === 'IHDR') {
      width = readUint32BE(data, 0);
      height = readUint32BE(data, 4);
      expect(data[8]).toBe(8);
      expect(data[9]).toBe(6);
    } else if (type === 'IDAT') {
      idatParts.push(data);
    } else if (type === 'IEND') {
      break;
    }

    offset = dataOffset + length + 4;
  }

  const scanlines = await inflateZlib(concat(idatParts));
  const rowStride = width * 4;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const scanlineOffset = y * (rowStride + 1);
    expect(scanlines[scanlineOffset]).toBe(0);
    data.set(scanlines.subarray(scanlineOffset + 1, scanlineOffset + 1 + rowStride), y * rowStride);
  }

  return { width, height, data };
};

describe('encodePngRgba', () => {
  it('preserves straight RGB bytes for translucent pixels', async () => {
    const data = new Uint8Array([255, 2, 2, 54, 7, 8, 9, 0, 10, 20, 30, 255, 100, 110, 120, 128]);

    const blob = await encodePngRgba({ data, width: 2, height: 2 });
    const decoded = await decodeRgbaPng(blob);

    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(2);
    expect(Array.from(decoded.data)).toEqual(Array.from(data));
  });
});
