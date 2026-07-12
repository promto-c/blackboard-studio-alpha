import * as THREE from 'three';
import {
  AnyNode,
  ImageSequenceNode,
  MediaSourceNode,
  ProjectColorManagement,
  SceneNode,
} from '@blackboard/types';
import { renderWithSharedPipeline } from '@/renderer/pipeline';
import { colorManagementService, getScenePreviewColorSpace } from '@/color-management';
import { type PixelDataResult, createPixelDataReader } from './pixelData';
import {
  getUpstreamMediaSourceNode,
  getUpstreamSourceNodes,
  isMediaSourceNode,
  isUpstreamMediaSourceId,
} from '@/utils/mediaSourceSelection';
import { findSceneNode } from '@/utils/graphCommands';
import { readRenderTargetRgbaFloat } from '@blackboard/renderer';

type SourcePixelMediaNode = MediaSourceNode | ImageSequenceNode;

export type SourcePixelSource =
  | { kind: 'media-node'; node: SourcePixelMediaNode }
  | {
      kind: 'upstream';
      nodes: AnyNode[];
      sceneNode: SceneNode;
      projectColorManagement: ProjectColorManagement;
    };

export interface SourcePixelDataReader {
  getFramePixelData: (frame: number) => Promise<PixelDataResult | null>;
  dispose: () => void;
}

export interface SourcePixelDataReaderOptions {
  finalColorSpace?: 'raw_texture' | 'scene_linear' | 'srgb' | 'match_viewport';
}

const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));

const readRenderTargetPixelData = (
  renderer: THREE.WebGLRenderer,
  renderTarget: THREE.WebGLRenderTarget,
): PixelDataResult => {
  const { width, height } = renderTarget;
  const source = readRenderTargetRgbaFloat(renderer, renderTarget);
  const pixels = new Uint8ClampedArray(source.length);
  for (let index = 0; index < source.length; index += 1) {
    pixels[index] = Math.round(clampUnit(source[index]) * 255);
  }

  return { data: pixels, width, height };
};

export const resolveSourcePixelSource = (
  nodes: AnyNode[],
  currentNodeId: string,
  sourceId: string,
  projectColorManagement: ProjectColorManagement,
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
      projectColorManagement,
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
  options?: SourcePixelDataReaderOptions,
): Promise<PixelDataResult | null> => {
  const reader = createSourcePixelDataReader(source, fps, options);
  try {
    return await reader.getFramePixelData(frame);
  } finally {
    reader.dispose();
  }
};

export const createSourcePixelDataReader = (
  source: SourcePixelSource,
  fps: number,
  options: SourcePixelDataReaderOptions = {},
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
        projectColorManagement: source.projectColorManagement,
        frame,
        width: source.sceneNode.width,
        height: source.sceneNode.height,
        finalColorSpace:
          options.finalColorSpace ??
          getScenePreviewColorSpace(
            source.sceneNode.colorSpace,
            colorManagementService.resolveProjectColorManagement(source.projectColorManagement)
              .workingColorSpace,
          ),
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
