import { afterEach, describe, expect, it, vi } from 'vitest';
import { getComfyInputUploadFilename } from './comfyInputUploadFilename';

const candidate = { nodeId: '12', inputName: 'image' };

describe('Comfy input upload filenames', () => {
  afterEach(() => vi.useRealTimers());

  it('uses the rendered blob encoding instead of the original source extension', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-14T00:00:00Z'));

    expect(
      getComfyInputUploadFilename({
        sourceName: 'camera plate.exr',
        candidate,
        blob: new Blob(['png'], { type: 'image/png' }),
      }),
    ).toBe('camera_plate_exr_12_image_1783987200000.png');
  });

  it('falls back to the source extension when the blob has no useful MIME type', () => {
    expect(
      getComfyInputUploadFilename({
        sourceName: 'linear-input.exr',
        candidate,
        blob: new Blob(['exr'], { type: 'application/octet-stream' }),
      }),
    ).toMatch(/\.exr$/);
  });
});
