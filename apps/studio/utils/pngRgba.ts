export type RgbaByteImage = {
  data: Uint8Array;
  width: number;
  height: number;
};

const makeCrc32Table = (): Uint32Array => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
};

const PNG_CRC32_TABLE = makeCrc32Table();
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_MAX_STORED_BLOCK_SIZE = 0xffff;

const writeUint32BE = (buffer: Uint8Array, offset: number, value: number) => {
  buffer[offset] = (value >>> 24) & 0xff;
  buffer[offset + 1] = (value >>> 16) & 0xff;
  buffer[offset + 2] = (value >>> 8) & 0xff;
  buffer[offset + 3] = value & 0xff;
};

const concatUint8Arrays = (parts: Uint8Array[]): Uint8Array => {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.length;
  });
  return output;
};

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = PNG_CRC32_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const adler32 = (bytes: Uint8Array): number => {
  let a = 1;
  let b = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    a += bytes[index];
    b += a;
    if ((index & 0x0fff) === 0x0fff) {
      a %= 65521;
      b %= 65521;
    }
  }
  a %= 65521;
  b %= 65521;
  return ((b << 16) | a) >>> 0;
};

const createPngChunk = (type: string, data = new Uint8Array(0)): Uint8Array => {
  const chunk = new Uint8Array(12 + data.length);
  writeUint32BE(chunk, 0, data.length);
  for (let index = 0; index < 4; index += 1) {
    chunk[4 + index] = type.charCodeAt(index);
  }
  chunk.set(data, 8);
  writeUint32BE(chunk, 8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
};

const zlibStore = (bytes: Uint8Array): Uint8Array => {
  const blockCount = Math.max(1, Math.ceil(bytes.length / PNG_MAX_STORED_BLOCK_SIZE));
  const output = new Uint8Array(2 + bytes.length + blockCount * 5 + 4);
  output[0] = 0x78;
  output[1] = 0x01;

  let sourceOffset = 0;
  let outputOffset = 2;
  for (let block = 0; block < blockCount; block += 1) {
    const blockLength = Math.min(PNG_MAX_STORED_BLOCK_SIZE, bytes.length - sourceOffset);
    const isFinalBlock = block === blockCount - 1;
    output[outputOffset] = isFinalBlock ? 0x01 : 0x00;
    output[outputOffset + 1] = blockLength & 0xff;
    output[outputOffset + 2] = (blockLength >>> 8) & 0xff;
    output[outputOffset + 3] = ~blockLength & 0xff;
    output[outputOffset + 4] = (~blockLength >>> 8) & 0xff;
    output.set(bytes.subarray(sourceOffset, sourceOffset + blockLength), outputOffset + 5);
    sourceOffset += blockLength;
    outputOffset += 5 + blockLength;
  }

  writeUint32BE(output, outputOffset, adler32(bytes));
  return output;
};

const deflatePngData = async (bytes: Uint8Array): Promise<Uint8Array> => {
  if (typeof CompressionStream === 'undefined') return zlibStore(bytes);

  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return zlibStore(bytes);
  }
};

export const encodePngRgba = async ({ data, width, height }: RgbaByteImage): Promise<Blob> => {
  const expectedLength = width * height * 4;
  if (data.length !== expectedLength) {
    throw new Error(`RGBA PNG data length must be ${expectedLength}, received ${data.length}.`);
  }

  const ihdr = new Uint8Array(13);
  writeUint32BE(ihdr, 0, width);
  writeUint32BE(ihdr, 4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolor with alpha
  ihdr[10] = 0; // deflate compression
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const rowStride = width * 4;
  const scanlines = new Uint8Array((rowStride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const scanlineOffset = y * (rowStride + 1);
    scanlines[scanlineOffset] = 0;
    scanlines.set(data.subarray(y * rowStride, (y + 1) * rowStride), scanlineOffset + 1);
  }

  const pngBytes = concatUint8Arrays([
    PNG_SIGNATURE,
    createPngChunk('IHDR', ihdr),
    createPngChunk('IDAT', await deflatePngData(scanlines)),
    createPngChunk('IEND'),
  ]);

  return new Blob([pngBytes], { type: 'image/png' });
};
