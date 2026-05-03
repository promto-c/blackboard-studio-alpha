import type { SceneNode } from '@blackboard/types';

export type CanvasStorageColorType = 'unorm8' | 'float16';

export const getCanvasStorageColorTypeForBitDepth = (
  bitDepth: SceneNode['bitDepth'],
): CanvasStorageColorType =>
  // Canvas 2D currently exposes float16 as the high-precision option, so
  // 16-bit and 32-bit scenes both request float16 storage.
  bitDepth === 8 ? 'unorm8' : 'float16';

export const resolveCanvasStorageColorType = (
  attributes?: { colorType?: unknown } | null,
): CanvasStorageColorType => (attributes?.colorType === 'float16' ? 'float16' : 'unorm8');
