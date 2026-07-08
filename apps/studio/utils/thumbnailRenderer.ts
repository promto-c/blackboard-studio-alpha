import * as THREE from 'three';
import { createStudioRenderer } from '@blackboard/renderer';
import {
  BlendMode,
  ImageFitMode,
  NodeType,
  type AnyNode,
  type MediaColorManagement,
  type MediaSourceNode,
  type ProjectColorManagement,
  type SceneNode,
} from '@blackboard/types';
import { getNodeAssetIds, nodeFlags } from '@/nodes/helpers';
import { renderWithSharedPipeline } from '@/renderer/pipeline';
import {
  colorManagementService,
  getMediaSourceColorSpace,
  resolveProjectDisplayOutput,
} from '@/color-management';
import {
  assetPreviewScheduler,
  createAbortError,
} from '@/services/assetPreview/assetPreviewScheduler';
import type { PreviewPriority } from '@/services/assetPreview/types';

const THUMBNAIL_MAX_DIMENSION = 96;
const TRANSPARENT_PLACEHOLDER =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
let transparentPlaceholderBlob: Blob | null = null;

const getTransparentPlaceholderBlob = (): Blob => {
  if (!transparentPlaceholderBlob) {
    const encoded = TRANSPARENT_PLACEHOLDER.slice(TRANSPARENT_PLACEHOLDER.indexOf(',') + 1);
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    transparentPlaceholderBlob = new Blob([bytes], { type: 'image/png' });
  }
  return transparentPlaceholderBlob;
};

const hasRenderableSource = (node: AnyNode): boolean => {
  const flags = nodeFlags(node.type);
  if (!flags.isSource) return false;
  if (!flags.isMediaNode) return true;
  return getNodeAssetIds(node).length > 0;
};

const asIsolatedThumbnailNode = (node: AnyNode): AnyNode => {
  const { detachedFromPipe: _detachedFromPipe, ...rest } = node as AnyNode & {
    detachedFromPipe?: boolean;
  };
  return rest as AnyNode;
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
    });
  }
  return sharedRenderer;
}

const getThumbnailRenderSize = (
  sceneNode: SceneNode,
  maxDimension = THUMBNAIL_MAX_DIMENSION,
): { width: number; height: number; maxSceneDimension: number } => {
  const sceneWidth = Math.max(1, sceneNode.width);
  const sceneHeight = Math.max(1, sceneNode.height);
  const maxSceneDimension = Math.max(sceneWidth, sceneHeight);
  const scale = maxDimension / maxSceneDimension;

  return {
    width: Math.max(1, Math.round(sceneWidth * scale)),
    height: Math.max(1, Math.round(sceneHeight * scale)),
    maxSceneDimension,
  };
};

const canvasToBlob = (
  canvas: HTMLCanvasElement,
  type = 'image/png',
  quality?: number,
): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error(`Could not encode the rendered preview as ${type}.`));
        }
      },
      type,
      quality,
    );
  });

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result)));
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Blob read failed.')));
    reader.readAsDataURL(blob);
  });

export interface ThumbnailRenderOptions {
  priority?: PreviewPriority;
  signal?: AbortSignal;
}

export async function renderStackToBlob(
  stack: AnyNode[],
  sceneNode: SceneNode,
  projectColorManagement: ProjectColorManagement,
  frame = 0,
  maxDimension = THUMBNAIL_MAX_DIMENSION,
  options: ThumbnailRenderOptions = {},
): Promise<Blob> {
  if (stack.length === 0 || !hasRenderableSource(stack[0])) {
    return getTransparentPlaceholderBlob();
  }

  return assetPreviewScheduler.schedule(
    async (signal) => {
      if (signal.aborted) throw createAbortError();
      const renderer = getSharedRenderer();
      const { width, height, maxSceneDimension } = getThumbnailRenderSize(sceneNode, maxDimension);
      const blurRadiusScale = maxDimension / maxSceneDimension;
      const output = resolveProjectDisplayOutput(projectColorManagement.viewer);
      const { canvas, dispose } = await renderWithSharedPipeline({
        nodes: stack.map(asIsolatedThumbnailNode),
        sceneNode,
        projectColorManagement,
        frame,
        width,
        height,
        blurRadiusScale,
        ...output,
        textureCacheMode: 'persistent',
        renderer,
      });

      try {
        if (signal.aborted) throw createAbortError();
        const blob = await canvasToBlob(canvas, 'image/png');
        if (signal.aborted) throw createAbortError();
        return blob;
      } finally {
        dispose();
      }
    },
    {
      priority: options.priority ?? 'visible-thumbnail',
      signal: options.signal,
    },
  );
}

export async function renderStackToDataURL(
  stack: AnyNode[],
  sceneNode: SceneNode,
  projectColorManagement: ProjectColorManagement,
  frame = 0,
  maxDimension = THUMBNAIL_MAX_DIMENSION,
  options: ThumbnailRenderOptions = {},
): Promise<string> {
  if (stack.length === 0 || !hasRenderableSource(stack[0])) {
    return TRANSPARENT_PLACEHOLDER;
  }
  return blobToDataUrl(
    await renderStackToBlob(stack, sceneNode, projectColorManagement, frame, maxDimension, options),
  );
}

export interface MediaAssetPreviewDescriptor {
  assetId: string;
  width: number;
  height: number;
  mediaKind?: 'image' | 'video';
  mediaColorManagement: MediaColorManagement;
  fps?: number;
}

export const createMediaPreviewGraph = (
  media: MediaAssetPreviewDescriptor,
  projectColorManagement: ProjectColorManagement,
  maxDimension = 512,
): { nodes: AnyNode[]; sceneNode: SceneNode } => {
  const workingColorSpace =
    colorManagementService.resolveProjectColorManagement(projectColorManagement).workingColorSpace;
  const sourceWidth = Math.max(1, media.width);
  const sourceHeight = Math.max(1, media.height);
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const sceneNode: SceneNode = {
    id: '__asset_preview_scene__',
    type: NodeType.SCENE,
    name: 'Asset Preview',
    enabled: true,
    width,
    height,
    bitDepth: 16,
    colorSpace: workingColorSpace,
    maxFrames: 0,
    fps: media.fps ?? 30,
  };
  const sourceNode: MediaSourceNode = {
    id: '__asset_preview_source__',
    type: NodeType.MEDIA_SOURCE,
    name: 'Asset Preview Source',
    enabled: true,
    src: media.assetId,
    mediaKind: media.mediaKind ?? 'image',
    width,
    height,
    opacity: 100,
    operator: BlendMode.OVER,
    transform: {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      fitMode: ImageFitMode.NONE,
    },
    colorSpace: getMediaSourceColorSpace(media.mediaColorManagement),
    mediaColorManagement: media.mediaColorManagement,
  };

  return { nodes: [sourceNode], sceneNode };
};

export const renderMediaAssetToDataURL = (
  media: MediaAssetPreviewDescriptor,
  projectColorManagement: ProjectColorManagement,
  maxDimension = 512,
): Promise<string> => {
  const { nodes, sceneNode } = createMediaPreviewGraph(media, projectColorManagement, maxDimension);
  return renderStackToDataURL(nodes, sceneNode, projectColorManagement, 0, maxDimension);
};

export const renderMediaAssetToBlob = (
  media: MediaAssetPreviewDescriptor,
  projectColorManagement: ProjectColorManagement,
  maxDimension = 512,
  options: ThumbnailRenderOptions = {},
): Promise<Blob> => {
  const { nodes, sceneNode } = createMediaPreviewGraph(media, projectColorManagement, maxDimension);
  return renderStackToBlob(nodes, sceneNode, projectColorManagement, 0, maxDimension, options);
};
