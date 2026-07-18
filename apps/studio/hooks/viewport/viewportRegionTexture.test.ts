import { describe, expect, it, vi } from 'vitest';
import { createViewportRegionBitmapTexture } from './viewportRegionTexture';

describe('createViewportRegionBitmapTexture', () => {
  it('pre-flips a top-left browser crop for bottom-left compositor sampling', async () => {
    const bitmap = { width: 300, height: 200 } as ImageBitmap;
    const createBitmap = vi.fn(async () => bitmap);

    const texture = await createViewportRegionBitmapTexture({
      blob: new Blob(['image']),
      region: { x: 100, y: 50, width: 300, height: 200 },
      fullSize: { width: 1000, height: 500 },
      createBitmap,
    });

    expect(createBitmap).toHaveBeenCalledWith(expect.any(Blob), 100, 50, 300, 200, {
      imageOrientation: 'flipY',
    });
    expect(texture.flipY).toBe(false);
    expect(texture.userData.blackboardSourceRegion).toEqual({
      x: 100,
      y: 50,
      width: 300,
      height: 200,
      fullWidth: 1000,
      fullHeight: 500,
      coordinateSpace: 'top-left',
    });
  });
});
