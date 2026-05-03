import * as THREE from 'three';
import { createStudioRenderer } from '@blackboard/renderer';
import { AnyNode, SceneNode } from '@blackboard/types';
import { getNodeAssetIds, nodeFlags } from '@/effects/effectHelpers';
import { renderWithSharedPipeline } from '@/renderer/pipeline';

const THUMBNAIL_MAX_DIMENSION = 96;
const TRANSPARENT_PLACEHOLDER =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const hasRenderableSource = (node: AnyNode): boolean => {
  const flags = nodeFlags(node.type);
  if (!flags.isSource) return false;
  if (!flags.isMediaNode) return true;
  return getNodeAssetIds(node).length > 0;
};

// ---------------------------------------------------------------------------
// Shared WebGL renderer – a single off-screen context reused by all thumbnail
// renders so we never exceed the browser's WebGL context limit.
// ---------------------------------------------------------------------------

let sharedRenderer: THREE.WebGLRenderer | null = null;

function getSharedRenderer(): THREE.WebGLRenderer {
  if (!sharedRenderer) {
    const canvas = document.createElement('canvas');
    canvas.width = THUMBNAIL_MAX_DIMENSION;
    canvas.height = THUMBNAIL_MAX_DIMENSION;
    sharedRenderer = createStudioRenderer({
      canvas,
      preserveDrawingBuffer: true,
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
    });
  }
  return sharedRenderer;
}

// Simple serial queue – only one thumbnail render may use the shared renderer
// at a time.  New requests wait for the previous one to finish.
let renderQueue: Promise<void> = Promise.resolve();

const getThumbnailRenderSize = (
  sceneNode: SceneNode,
): { width: number; height: number; maxSceneDimension: number } => {
  const sceneWidth = Math.max(1, sceneNode.width);
  const sceneHeight = Math.max(1, sceneNode.height);
  const maxSceneDimension = Math.max(sceneWidth, sceneHeight);
  const scale = THUMBNAIL_MAX_DIMENSION / maxSceneDimension;

  return {
    width: Math.max(1, Math.round(sceneWidth * scale)),
    height: Math.max(1, Math.round(sceneHeight * scale)),
    maxSceneDimension,
  };
};

export async function renderStackToDataURL(
  stack: AnyNode[],
  sceneNode: SceneNode,
  frame = 0,
): Promise<string> {
  if (stack.length === 0) {
    return TRANSPARENT_PLACEHOLDER;
  }
  if (!hasRenderableSource(stack[0])) {
    return TRANSPARENT_PLACEHOLDER;
  }

  // Chain onto the queue so renders are serialized.
  let resolve!: () => void;
  const gate = new Promise<void>((r) => {
    resolve = r;
  });
  const prevQueue = renderQueue;
  renderQueue = gate;
  await prevQueue;

  try {
    const renderer = getSharedRenderer();
    const { width, height, maxSceneDimension } = getThumbnailRenderSize(sceneNode);
    const blurRadiusScale = THUMBNAIL_MAX_DIMENSION / maxSceneDimension;
    const { canvas, dispose } = await renderWithSharedPipeline({
      nodes: stack,
      sceneNode,
      frame,
      width,
      height,
      blurRadiusScale,
      finalColorSpace: 'raw_texture',
      textureCacheMode: 'persistent',
      renderer,
    });

    try {
      return canvas.toDataURL('image/png');
    } finally {
      dispose();
    }
  } finally {
    resolve();
  }
}
