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
  /** 'opaque' = output has alpha=255 everywhere, 'preserve' = keep alpha from render */
  regionInputAlphaMode?: 'opaque' | 'preserve';
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

/**
 * Crop a region from a float input, padding with zeros for areas outside the input bounds.
 * @param alphaMode - `'opaque'` forces alpha=1 everywhere (ignores scene alpha);
 *                    `'preserve'` keeps alpha from the source.
 */
export const cropFloatInputToPngBlob = (
  input: FloatInput,
  rect: PixelRect,
  alphaMode: 'opaque' | 'preserve' = 'opaque',
): Promise<Blob> => {
  if (input.channels !== 4) {
    throw new Error('Comfy input crop expects RGBA pixel data.');
  }

  const channels = input.channels;

  // Compute pixel-aligned bounds for the full requested rect.
  // Using floor/ceil consistently so output dimensions and the overlap
  // region never disagree on pixel boundaries.
  const pixelLeft = Math.floor(Math.min(rect.x, rect.x + rect.width));
  const pixelTop = Math.floor(Math.min(rect.y, rect.y + rect.height));
  const pixelRight = Math.ceil(Math.max(rect.x, rect.x + rect.width));
  const pixelBottom = Math.ceil(Math.max(rect.y, rect.y + rect.height));
  const outputWidth = Math.max(1, Math.abs(pixelRight - pixelLeft));
  const outputHeight = Math.max(1, Math.abs(pixelBottom - pixelTop));

  // Create a zeroed buffer at the full requested size.
  // For outpainting the region can extend beyond the input bounds;
  // we want the output to be the full region size with the overlapping
  // portion of the scene placed at the correct offset and the rest
  // filled with transparent (zero) pixels.
  const output = new Float32Array(outputWidth * outputHeight * channels);

  // Calculate overlap between the pixel-aligned rect and the input bounds
  const overlapLeft = Math.max(0, pixelLeft);
  const overlapTop = Math.max(0, pixelTop);
  const overlapRight = Math.min(input.width, pixelRight);
  const overlapBottom = Math.min(input.height, pixelBottom);
  const overlapWidth = overlapRight - overlapLeft;
  const overlapHeight = overlapBottom - overlapTop;

  if (overlapWidth > 0 && overlapHeight > 0) {
    // Where the overlap sits within the output rect.
    // When the rect starts at a negative x (outpainting left), pixelLeft < 0
    // and overlapLeft = 0, so outputOffsetX = -pixelLeft > 0.
    // When the rect starts inside the scene, pixelLeft >= 0 and
    // overlapLeft = pixelLeft, so outputOffsetX = 0.
    const outputOffsetX = overlapLeft - pixelLeft;
    const outputOffsetY = overlapTop - pixelTop;

    // Sanity-check: the overlap must fit inside the output at this offset.
    // This is guaranteed by the pixel-aligned approach, but guard against
    // off-by-one rounding edge cases.
    const copyWidth = Math.min(overlapWidth, outputWidth - outputOffsetX);
    const copyHeight = Math.min(overlapHeight, outputHeight - outputOffsetY);

    if (copyWidth > 0 && copyHeight > 0 && outputOffsetX >= 0 && outputOffsetY >= 0) {
      for (let row = 0; row < copyHeight; row += 1) {
        const sourceStart = ((overlapTop + row) * input.width + overlapLeft) * channels;
        const sourceEnd = sourceStart + copyWidth * channels;
        const targetStart = ((outputOffsetY + row) * outputWidth + outputOffsetX) * channels;
        output.set(input.data.subarray(sourceStart, sourceEnd), targetStart);
      }
    }
  }
  // If there is no overlap the output stays all zeros.

  // In opaque mode, set all alpha values to 1.0 so the PNG has no transparency.
  // This is the default because most Comfy models expect fully opaque input.
  if (alphaMode === 'opaque') {
    for (let i = 3; i < output.length; i += channels) {
      output[i] = 1.0;
    }
  }
  // In preserve mode, alpha values from the source are kept as-is.

  return floatInputToPngBlob({
    data: output,
    width: outputWidth,
    height: outputHeight,
    channels,
  });
};

export const renderNodeInputRegionToPngBlob = async (
  options: RenderNodeInputRegionOptions,
): Promise<Blob> =>
  cropFloatInputToPngBlob(
    await renderNodeInputFrameToFloat(options),
    options.regionRect,
    options.regionInputAlphaMode,
  );
