import * as THREE from 'three';
import { createStudioRenderer } from '@blackboard/renderer';

let sharedRenderer: THREE.WebGLRenderer | null = null;
let renderQueue: Promise<void> = Promise.resolve();

const getSharedPaintSnapshotRenderer = (): THREE.WebGLRenderer => {
  if (!sharedRenderer) {
    sharedRenderer = createStudioRenderer({
      canvas: document.createElement('canvas'),
      preserveDrawingBuffer: true,
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
    });
  }

  return sharedRenderer;
};

export const withSharedPaintSnapshotRenderer = async <T>(
  render: (renderer: THREE.WebGLRenderer) => Promise<T>,
): Promise<T> => {
  let release: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previousRender = renderQueue;
  renderQueue = gate;
  await previousRender;

  try {
    return await render(getSharedPaintSnapshotRenderer());
  } finally {
    release?.();
  }
};

export const resetSharedPaintSnapshotRendererForTests = () => {
  sharedRenderer?.dispose();
  sharedRenderer = null;
  renderQueue = Promise.resolve();
};
