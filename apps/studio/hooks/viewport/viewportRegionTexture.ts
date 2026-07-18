import * as THREE from 'three';
import { configureRawStraightAlphaTexture } from '@blackboard/renderer';
import type { PixelRect } from '@/features/viewport/workingArea';

type CreateImageBitmapForRegion = (
  image: ImageBitmapSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  options?: ImageBitmapOptions,
) => Promise<ImageBitmap>;

/**
 * Decode a browser-addressed (top-left) crop into the compositor's bottom-left texture
 * orientation. ImageBitmap uploads do not reliably honor THREE.Texture.flipY, so the bitmap itself
 * is flipped during decode and texture upload flipping is explicitly disabled.
 */
export const createViewportRegionBitmapTexture = async ({
  blob,
  region,
  fullSize,
  createBitmap = createImageBitmap,
}: {
  blob: Blob;
  region: PixelRect;
  fullSize: { width: number; height: number };
  createBitmap?: CreateImageBitmapForRegion;
}): Promise<THREE.Texture> => {
  const bitmap = await createBitmap(blob, region.x, region.y, region.width, region.height, {
    imageOrientation: 'flipY',
  });
  const texture = new THREE.Texture(bitmap);
  texture.flipY = false;
  configureRawStraightAlphaTexture(texture);
  texture.userData.blackboardSourceRegion = {
    ...region,
    fullWidth: fullSize.width,
    fullHeight: fullSize.height,
    coordinateSpace: 'top-left',
  };
  return texture;
};
