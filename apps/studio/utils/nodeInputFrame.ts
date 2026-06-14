import * as THREE from 'three';
import type { AnyNode, Flow, SceneNode } from '@blackboard/types';
import { createStudioRenderer } from '@blackboard/renderer';
import { renderWithSharedPipeline, type RenderPipelineResult } from '@/renderer/pipeline';
import { expandGroupNodesForRender } from '@/utils/groupRenderProjection';
import { getViewerRenderNodes } from '@/utils/viewerSlots';
import { encodePngRgba } from '@/utils/pngRgba';
import type { FloatInput } from '@/services/onnx/onnxRuntime';

interface RenderNodeInputOptions {
  nodes: AnyNode[];
  flows: Record<string, Flow>;
  sourceNodeId: string;
  sceneNode: SceneNode;
  frame: number;
  finalColorSpace: 'raw_texture' | 'scene_linear' | 'srgb' | 'match_viewport';
}

interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RenderNodeInputRegionOptions extends RenderNodeInputOptions {
  regionRect: PixelRect;
}

let sharedRenderer: THREE.WebGLRenderer | null = null;

function getSharedRenderer(): THREE.WebGLRenderer {
  if (!sharedRenderer) {
    sharedRenderer = createStudioRenderer({
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

const toByteChannel = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.max(0, Math.min(1, value)) * 255);
};

export const clampPixelRect = (
  rect: PixelRect,
  bounds: { width: number; height: number },
): PixelRect | null => {
  const left = Math.max(0, Math.min(bounds.width, Math.floor(rect.x)));
  const top = Math.max(0, Math.min(bounds.height, Math.floor(rect.y)));
  const right = Math.max(left, Math.min(bounds.width, Math.ceil(rect.x + rect.width)));
  const bottom = Math.max(top, Math.min(bounds.height, Math.ceil(rect.y + rect.height)));
  const width = right - left;
  const height = bottom - top;

  if (width <= 0 || height <= 0) return null;
  return { x: left, y: top, width, height };
};

const getRenderedSourceNodes = (
  nodes: AnyNode[],
  flows: Record<string, Flow>,
  sourceNodeId: string,
): AnyNode[] => {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const activeFlow =
    Object.values(flows).find((flow) => {
      const flowNodeIds = new Set(flow.nodes.map((node) => node.id));
      return (
        flowNodeIds.has(sourceNodeId) && [...nodeIds].every((nodeId) => flowNodeIds.has(nodeId))
      );
    }) ?? null;

  return expandGroupNodesForRender(getViewerRenderNodes(nodes, sourceNodeId, activeFlow), flows);
};

const readRenderTargetToFloatInput = (
  result: RenderPipelineResult,
  target: NonNullable<RenderPipelineResult['finalOutputTarget']>,
): FloatInput => {
  const { width, height } = target;
  const pixelCount = width * height;
  const output = new Float32Array(pixelCount * 4);
  const textureType = target.texture.type;

  if (textureType === THREE.FloatType) {
    const buffer = new Float32Array(pixelCount * 4);
    result.renderer.readRenderTargetPixels(target, 0, 0, width, height, buffer);
    for (let sourceY = 0; sourceY < height; sourceY += 1) {
      const targetY = height - sourceY - 1;
      output.set(
        buffer.subarray(sourceY * width * 4, (sourceY + 1) * width * 4),
        targetY * width * 4,
      );
    }
  } else if (textureType === THREE.HalfFloatType) {
    const buffer = new Uint16Array(pixelCount * 4);
    result.renderer.readRenderTargetPixels(target, 0, 0, width, height, buffer);
    for (let sourceY = 0; sourceY < height; sourceY += 1) {
      const targetY = height - sourceY - 1;
      for (let x = 0; x < width * 4; x += 1) {
        output[targetY * width * 4 + x] = THREE.DataUtils.fromHalfFloat(
          buffer[sourceY * width * 4 + x],
        );
      }
    }
  } else {
    const buffer = new Uint8Array(pixelCount * 4);
    result.renderer.readRenderTargetPixels(target, 0, 0, width, height, buffer);
    for (let sourceY = 0; sourceY < height; sourceY += 1) {
      const targetY = height - sourceY - 1;
      for (let x = 0; x < width * 4; x += 1) {
        output[targetY * width * 4 + x] = buffer[sourceY * width * 4 + x] / 255;
      }
    }
  }

  return { data: output, width, height, channels: 4 };
};

const floatInputToPngBlob = (input: FloatInput): Promise<Blob> => {
  const { data, width, height } = input;
  const output = new Uint8Array(width * height * 4);

  for (let i = 0; i < width * height; i += 1) {
    const offset = i * 4;
    output[offset] = toByteChannel(data[offset]);
    output[offset + 1] = toByteChannel(data[offset + 1]);
    output[offset + 2] = toByteChannel(data[offset + 2]);
    output[offset + 3] = toByteChannel(data[offset + 3]);
  }

  return encodePngRgba({ data: output, width, height });
};

export const renderNodeInputFrameToFloat = async (
  options: RenderNodeInputOptions,
): Promise<FloatInput> => {
  const renderNodes = getRenderedSourceNodes(options.nodes, options.flows, options.sourceNodeId);
  const result = await renderWithSharedPipeline({
    captureFinalOutput: true,
    preserveAlpha: true,
    nodes: renderNodes,
    sceneNode: options.sceneNode,
    frame: options.frame,
    width: options.sceneNode.width,
    height: options.sceneNode.height,
    finalColorSpace: options.finalColorSpace,
    textureCacheMode: 'persistent',
    presentToCanvas: false,
    renderer: getSharedRenderer(),
  });

  try {
    if (!result.finalOutputTarget) {
      throw new Error('Could not capture rendered input frame.');
    }

    return readRenderTargetToFloatInput(result, result.finalOutputTarget);
  } finally {
    result.dispose();
  }
};

export const renderNodeInputFrameToPngBlob = async (
  options: RenderNodeInputOptions,
): Promise<Blob> => floatInputToPngBlob(await renderNodeInputFrameToFloat(options));

export const cropFloatInputToPngBlob = (input: FloatInput, rect: PixelRect): Promise<Blob> => {
  if (input.channels !== 4) {
    throw new Error('Comfy input crop expects RGBA pixel data.');
  }

  const cropRect = clampPixelRect(rect, input);
  if (!cropRect) {
    throw new Error('Selected Comfy region is outside the rendered input frame.');
  }

  const output = new Float32Array(cropRect.width * cropRect.height * input.channels);

  for (let row = 0; row < cropRect.height; row += 1) {
    const sourceStart = ((cropRect.y + row) * input.width + cropRect.x) * input.channels;
    const sourceEnd = sourceStart + cropRect.width * input.channels;
    const targetStart = row * cropRect.width * input.channels;
    output.set(input.data.subarray(sourceStart, sourceEnd), targetStart);
  }

  return floatInputToPngBlob({
    data: output,
    width: cropRect.width,
    height: cropRect.height,
    channels: input.channels,
  });
};

export const renderNodeInputRegionToPngBlob = async (
  options: RenderNodeInputRegionOptions,
): Promise<Blob> =>
  cropFloatInputToPngBlob(await renderNodeInputFrameToFloat(options), options.regionRect);
