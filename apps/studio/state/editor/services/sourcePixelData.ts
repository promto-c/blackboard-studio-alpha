import * as THREE from 'three';
import { AnyNode, ImageSequenceNode, MediaSourceNode, SceneNode } from '@blackboard/types';
import { renderWithSharedPipeline } from '@/renderer/pipeline';
import { type PixelDataResult, createPixelDataReader } from './pixelData';
import {
  getUpstreamMediaSourceNode,
  getUpstreamSourceNodes,
  isMediaSourceNode,
  isUpstreamMediaSourceId,
} from '@/utils/mediaSourceSelection';
import { findSceneNode } from '@/utils/graphCommands';

type SourcePixelMediaNode = MediaSourceNode | ImageSequenceNode;

export type SourcePixelSource =
  | { kind: 'media-node'; node: SourcePixelMediaNode }
  | { kind: 'upstream'; nodes: AnyNode[]; sceneNode: SceneNode };

export interface SourcePixelDataReader {
  getFramePixelData: (frame: number) => Promise<PixelDataResult | null>;
  dispose: () => void;
}

const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));

const readRenderTargetPixelData = (
  renderer: THREE.WebGLRenderer,
  renderTarget: THREE.WebGLRenderTarget,
): PixelDataResult => {
  const { width, height } = renderTarget;
  const pixelCount = width * height * 4;
  const pixels = new Uint8ClampedArray(pixelCount);
  const textureType = renderTarget.texture.type;

  if (textureType === THREE.FloatType) {
    const source = new Float32Array(pixelCount);
    renderer.readRenderTargetPixels(renderTarget, 0, 0, width, height, source);

    for (let y = 0; y < height; y += 1) {
      const srcRow = (height - 1 - y) * width * 4;
      const dstRow = y * width * 4;
      for (let x = 0; x < width * 4; x += 1) {
        pixels[dstRow + x] = Math.round(clampUnit(source[srcRow + x]) * 255);
      }
    }

    return { data: pixels, width, height };
  }

  if (textureType === THREE.HalfFloatType) {
    const source = new Uint16Array(pixelCount);
    renderer.readRenderTargetPixels(renderTarget, 0, 0, width, height, source);

    for (let y = 0; y < height; y += 1) {
      const srcRow = (height - 1 - y) * width * 4;
      const dstRow = y * width * 4;
      for (let x = 0; x < width * 4; x += 1) {
        pixels[dstRow + x] = Math.round(
          clampUnit(THREE.DataUtils.fromHalfFloat(source[srcRow + x])) * 255,
        );
      }
    }

    return { data: pixels, width, height };
  }

  const source = new Uint8Array(pixelCount);
  renderer.readRenderTargetPixels(renderTarget, 0, 0, width, height, source);

  for (let y = 0; y < height; y += 1) {
    const srcRow = (height - 1 - y) * width * 4;
    const dstRow = y * width * 4;
    pixels.set(source.subarray(srcRow, srcRow + width * 4), dstRow);
  }

  return { data: pixels, width, height };
};

export const resolveSourcePixelSource = (
  nodes: AnyNode[],
  currentNodeId: string,
  sourceId: string,
): SourcePixelSource | null => {
  if (isUpstreamMediaSourceId(sourceId)) {
    const upstreamMediaNode = getUpstreamMediaSourceNode(nodes, currentNodeId);
    if (upstreamMediaNode) {
      return {
        kind: 'media-node',
        node: upstreamMediaNode,
      };
    }

    const sceneNode = findSceneNode(nodes);
    const upstreamNodes = getUpstreamSourceNodes(nodes, currentNodeId);

    if (!sceneNode || upstreamNodes.length === 0) {
      return null;
    }

    return {
      kind: 'upstream',
      nodes: upstreamNodes,
      sceneNode,
    };
  }

  const sourceNode = nodes.find((node) => node.id === sourceId);
  if (!sourceNode || !isMediaSourceNode(sourceNode)) {
    return null;
  }

  return {
    kind: 'media-node',
    node: sourceNode,
  };
};

export const getSourcePixelDataForFrame = async (
  source: SourcePixelSource,
  frame: number,
  fps: number,
): Promise<PixelDataResult | null> => {
  const reader = createSourcePixelDataReader(source, fps);
  try {
    return await reader.getFramePixelData(frame);
  } finally {
    reader.dispose();
  }
};

export const createSourcePixelDataReader = (
  source: SourcePixelSource,
  fps: number,
): SourcePixelDataReader => {
  if (source.kind === 'media-node') {
    const reader = createPixelDataReader(source.node, fps);
    return {
      getFramePixelData: (frame) => reader.getFramePixelData(frame),
      dispose: () => reader.dispose(),
    };
  }

  let sharedRenderer: THREE.WebGLRenderer | null = null;
  let isDisposed = false;

  return {
    getFramePixelData: async (frame) => {
      if (isDisposed || source.nodes.length === 0) {
        return null;
      }

      const renderResult = await renderWithSharedPipeline({
        captureFinalOutput: true,
        nodes: source.nodes,
        sceneNode: source.sceneNode,
        frame,
        width: source.sceneNode.width,
        height: source.sceneNode.height,
        finalColorSpace: source.sceneNode.colorSpace === 'Linear' ? 'srgb' : 'raw_texture',
        textureCacheMode: 'persistent',
        presentToCanvas: false,
        keepRendererAlive: true,
        renderer: sharedRenderer ?? undefined,
      });
      sharedRenderer = renderResult.renderer;

      try {
        if (!renderResult.finalOutputTarget) {
          return null;
        }

        return readRenderTargetPixelData(renderResult.renderer, renderResult.finalOutputTarget);
      } finally {
        renderResult.dispose();
      }
    },
    dispose: () => {
      isDisposed = true;
      sharedRenderer?.dispose?.();
      sharedRenderer = null;
    },
  };
};
