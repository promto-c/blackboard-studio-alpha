import * as THREE from 'three';
import type { ViewportPresentationOptions } from '@/renderer/pipeline';
import type { ViewportInterpolation } from './viewportInterpolation';

export const createViewportPresentation = (
  inverseMatrix: number[][] | null,
  interpolation: ViewportInterpolation,
  viewport: {
    size: { width: number; height: number };
    zoom: number;
    pan: { x: number; y: number };
    pixelGrid?: ViewportPresentationOptions['pixelGrid'];
  },
): ViewportPresentationOptions | undefined => {
  if (!inverseMatrix) return undefined;

  const stabilizationInverse = new THREE.Matrix3().set(
    inverseMatrix[0]?.[0] ?? 1,
    inverseMatrix[0]?.[1] ?? 0,
    inverseMatrix[0]?.[3] ?? 0,
    inverseMatrix[1]?.[0] ?? 0,
    inverseMatrix[1]?.[1] ?? 1,
    inverseMatrix[1]?.[3] ?? 0,
    inverseMatrix[3]?.[0] ?? 0,
    inverseMatrix[3]?.[1] ?? 0,
    inverseMatrix[3]?.[3] ?? 1,
  );
  const inverseZoom = 1 / Math.max(viewport.zoom, Number.EPSILON);
  const viewportInverse = new THREE.Matrix3().set(
    inverseZoom,
    0,
    -viewport.pan.x * inverseZoom,
    0,
    inverseZoom,
    viewport.pan.y * inverseZoom,
    0,
    0,
    1,
  );

  return {
    inverseTransform: stabilizationInverse.multiply(viewportInverse),
    destinationSize: {
      width: Math.max(1, Math.round(viewport.size.width)),
      height: Math.max(1, Math.round(viewport.size.height)),
    },
    interpolation,
    pixelGrid: viewport.pixelGrid,
  };
};
