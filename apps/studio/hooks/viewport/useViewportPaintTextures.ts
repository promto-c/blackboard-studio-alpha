import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { NodeType, type AnyNode, type PaintNode, type SceneNode } from '@blackboard/types';
import {
  buildPaintAlphaCompositeCanvas,
  buildPaintCompositeCanvas,
  buildPaintStrokeCanvas,
  cloneCanvas,
  compositePaintRasterOntoCanvas,
  resizeOrClearPaintCanvas,
  type PaintLivePreview,
} from '@/effects/paint/paintRaster';
import { withSharedPaintSnapshotRenderer } from '@/effects/paint/paintSnapshotRenderer';
import { getPaintTextureCommittedState } from '@/effects/paint/paintTextureKeys';
import { renderWithSharedPipeline } from '@/renderer/pipeline';
import { getCanvasStorageColorTypeForBitDepth } from '@/utils/canvasColorType';

interface PaintTextureEntry {
  colorTexture: THREE.CanvasTexture;
  alphaTexture: THREE.CanvasTexture;
  key: string;
  committedKey: string;
  committedColorCanvas: HTMLCanvasElement | null;
  committedAlphaCanvas: HTMLCanvasElement | null;
  previewColorCanvas: HTMLCanvasElement | null;
  previewAlphaCanvas: HTMLCanvasElement | null;
  preview: PaintLivePreview | null;
}

interface UseViewportPaintTexturesOptions {
  nodes: AnyNode[];
  currentFrame: number;
  sceneNode: SceneNode | undefined;
  livePreview?: PaintLivePreview | null;
  bumpMediaUpdate: () => void;
}

const configurePaintTexture = (texture: THREE.CanvasTexture) => {
  texture.needsUpdate = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
};

const removePaintTextureEntry = (
  entries: Map<string, PaintTextureEntry>,
  nodeId: string,
): boolean => {
  const existing = entries.get(nodeId);
  if (!existing) return false;

  existing.colorTexture.dispose();
  existing.alphaTexture.dispose();
  entries.delete(nodeId);
  return true;
};

const upsertPaintTextureEntry = (
  entries: Map<string, PaintTextureEntry>,
  nodeId: string,
  key: string,
  committedKey: string,
  colorCanvas: HTMLCanvasElement,
  alphaCanvas: HTMLCanvasElement,
  committedColorCanvas: HTMLCanvasElement | null,
  committedAlphaCanvas: HTMLCanvasElement | null,
  previewColorCanvas: HTMLCanvasElement | null,
  previewAlphaCanvas: HTMLCanvasElement | null,
  preview: PaintLivePreview | null,
) => {
  const existing = entries.get(nodeId);
  const colorTexture = existing?.colorTexture ?? new THREE.CanvasTexture(colorCanvas);
  const alphaTexture = existing?.alphaTexture ?? new THREE.CanvasTexture(alphaCanvas);

  colorTexture.image = colorCanvas;
  alphaTexture.image = alphaCanvas;
  configurePaintTexture(colorTexture);
  configurePaintTexture(alphaTexture);

  entries.set(nodeId, {
    colorTexture,
    alphaTexture,
    key,
    committedKey,
    committedColorCanvas,
    committedAlphaCanvas,
    previewColorCanvas,
    previewAlphaCanvas,
    preview,
  });
};

const createBlankPaintCanvas = (
  width: number,
  height: number,
  canvasColorType: ReturnType<typeof getCanvasStorageColorTypeForBitDepth>,
  source?: HTMLCanvasElement | null,
) => resizeOrClearPaintCanvas(source ?? null, width, height, canvasColorType);

const copyCommittedPaintCanvas = (
  committedCanvas: HTMLCanvasElement | null,
  previewCanvas: HTMLCanvasElement | null | undefined,
  width: number,
  height: number,
  canvasColorType: ReturnType<typeof getCanvasStorageColorTypeForBitDepth>,
): HTMLCanvasElement => {
  const nextCanvas = createBlankPaintCanvas(width, height, canvasColorType, previewCanvas ?? null);
  const nextContext = nextCanvas.getContext('2d');
  if (nextContext && committedCanvas) {
    nextContext.drawImage(committedCanvas, 0, 0);
  }
  return nextCanvas;
};

const renderPaintLivePreviewCanvases = ({
  committedColorCanvas,
  committedAlphaCanvas,
  preview,
  previewColorCanvas,
  previewAlphaCanvas,
  width,
  height,
  canvasColorType,
}: {
  committedColorCanvas: HTMLCanvasElement | null;
  committedAlphaCanvas: HTMLCanvasElement | null;
  preview: PaintLivePreview;
  previewColorCanvas: HTMLCanvasElement | null | undefined;
  previewAlphaCanvas: HTMLCanvasElement | null | undefined;
  width: number;
  height: number;
  canvasColorType: ReturnType<typeof getCanvasStorageColorTypeForBitDepth>;
}): { colorCanvas: HTMLCanvasElement; alphaCanvas: HTMLCanvasElement } | null => {
  const nextColorCanvas = copyCommittedPaintCanvas(
    committedColorCanvas,
    previewColorCanvas,
    width,
    height,
    canvasColorType,
  );
  const nextAlphaCanvas = copyCommittedPaintCanvas(
    committedAlphaCanvas,
    previewAlphaCanvas,
    width,
    height,
    canvasColorType,
  );

  const strokeCanvas = buildPaintStrokeCanvas({
    tool: preview.tool,
    points: preview.points,
    width,
    height,
    size: preview.size,
    softness: preview.softness,
    opacity: preview.opacity,
    color: preview.color,
    alpha: preview.alpha,
    channels: preview.channels,
    cloneOffset: preview.cloneOffset,
    sourceCanvas: preview.sourceCanvas,
    canvasColorType: preview.canvasColorType ?? canvasColorType,
  });
  if (!strokeCanvas) {
    return {
      colorCanvas: nextColorCanvas,
      alphaCanvas: nextAlphaCanvas,
    };
  }

  const targetCanvas = preview.channels === 'a' ? nextAlphaCanvas : nextColorCanvas;
  if (!compositePaintRasterOntoCanvas(targetCanvas, strokeCanvas, preview.tool, preview.channels)) {
    return null;
  }

  return {
    colorCanvas: nextColorCanvas,
    alphaCanvas: nextAlphaCanvas,
  };
};

export const useViewportPaintTextures = ({
  nodes,
  currentFrame,
  sceneNode,
  livePreview = null,
  bumpMediaUpdate,
}: UseViewportPaintTexturesOptions) => {
  const paintTexturesRef = useRef<Map<string, PaintTextureEntry>>(new Map());

  useEffect(() => {
    if (!sceneNode) {
      paintTexturesRef.current.forEach((entry) => {
        entry.colorTexture.dispose();
        entry.alphaTexture.dispose();
      });
      paintTexturesRef.current.clear();
      return;
    }

    let isDisposed = false;
    const paintNodes = nodes.filter((node) => node.type === NodeType.PAINT) as PaintNode[];
    const activeIds = new Set(paintNodes.map((node) => node.id));
    const requestedCanvasColorType = getCanvasStorageColorTypeForBitDepth(sceneNode.bitDepth);

    paintNodes.forEach((node) => {
      const { committedKey, requiresDynamicCloneSource } = getPaintTextureCommittedState({
        node,
        nodes,
        frame: currentFrame,
        width: sceneNode.width,
        height: sceneNode.height,
      });
      const existing = paintTexturesRef.current.get(node.id);
      const previewForNode = livePreview?.nodeId === node.id ? livePreview : null;
      const key = previewForNode
        ? `${committedKey}:preview:${previewForNode.cacheKey}`
        : committedKey;
      let cloneSourceCanvasPromise: Promise<HTMLCanvasElement | null> | null = null;
      const resolveCloneSourceCanvas = (): Promise<HTMLCanvasElement | null> => {
        if (!requiresDynamicCloneSource) {
          return Promise.resolve(null);
        }
        if (cloneSourceCanvasPromise) {
          return cloneSourceCanvasPromise;
        }

        cloneSourceCanvasPromise = (async () => {
          const paintNodeIndex = nodes.findIndex((candidate) => candidate.id === node.id);
          if (paintNodeIndex < 0) {
            return null;
          }

          const upstreamNodes = nodes.slice(0, paintNodeIndex);
          const finalColorSpace = sceneNode.colorSpace === 'Linear' ? 'srgb' : 'raw_texture';

          return withSharedPaintSnapshotRenderer(async (renderer) => {
            const { canvas, dispose } = await renderWithSharedPipeline({
              captureFinalOutput: true,
              nodes: upstreamNodes,
              sceneNode,
              frame: currentFrame,
              width: sceneNode.width,
              height: sceneNode.height,
              finalColorSpace,
              textureCacheMode: 'persistent',
              renderer,
            });

            try {
              return cloneCanvas(canvas, requestedCanvasColorType);
            } finally {
              dispose();
            }
          });
        })();

        return cloneSourceCanvasPromise;
      };

      if (existing && existing.key === key) {
        return;
      }

      const shouldHoldExistingPreview =
        !previewForNode &&
        existing?.previewColorCanvas &&
        existing.previewAlphaCanvas &&
        existing.preview &&
        existing.committedKey === committedKey;

      const canPromoteExistingPreview =
        !previewForNode &&
        existing?.previewColorCanvas &&
        existing.previewAlphaCanvas &&
        existing.preview &&
        existing.committedKey !== committedKey &&
        node.strokes.length > 0 &&
        node.strokes[0].pointCount === existing.preview.cursor &&
        node.strokes[0].tool === existing.preview.tool &&
        node.strokes[0].size === existing.preview.size &&
        node.strokes[0].softness === existing.preview.softness &&
        node.strokes[0].opacity === existing.preview.opacity &&
        (node.strokes[0].channels ?? 'rgb') === existing.preview.channels &&
        (node.strokes[0].alpha ?? 1) ===
          (existing.preview.channels === 'a' ? existing.preview.alpha : 1);

      if (shouldHoldExistingPreview) {
        upsertPaintTextureEntry(
          paintTexturesRef.current,
          node.id,
          key,
          committedKey,
          existing.previewColorCanvas,
          existing.previewAlphaCanvas,
          existing.committedColorCanvas,
          existing.committedAlphaCanvas,
          existing.previewColorCanvas,
          existing.previewAlphaCanvas,
          existing.preview,
        );
        bumpMediaUpdate();
        return;
      }

      if (canPromoteExistingPreview) {
        upsertPaintTextureEntry(
          paintTexturesRef.current,
          node.id,
          key,
          committedKey,
          existing.previewColorCanvas,
          existing.previewAlphaCanvas,
          existing.previewColorCanvas,
          existing.previewAlphaCanvas,
          null,
          null,
          null,
        );
        bumpMediaUpdate();
        return;
      }

      if (previewForNode && existing?.committedKey === committedKey) {
        const previewCanvases = renderPaintLivePreviewCanvases({
          committedColorCanvas: existing.committedColorCanvas,
          committedAlphaCanvas: existing.committedAlphaCanvas,
          preview: previewForNode,
          previewColorCanvas: existing.previewColorCanvas,
          previewAlphaCanvas: existing.previewAlphaCanvas,
          width: sceneNode.width,
          height: sceneNode.height,
          canvasColorType: requestedCanvasColorType,
        });

        if (!previewCanvases) {
          return;
        }

        upsertPaintTextureEntry(
          paintTexturesRef.current,
          node.id,
          key,
          committedKey,
          previewCanvases.colorCanvas,
          previewCanvases.alphaCanvas,
          existing.committedColorCanvas,
          existing.committedAlphaCanvas,
          previewCanvases.colorCanvas,
          previewCanvases.alphaCanvas,
          previewForNode,
        );
        bumpMediaUpdate();
        return;
      }

      const committedColorCanvasPromise =
        existing?.committedKey === committedKey
          ? Promise.resolve(existing.committedColorCanvas)
          : buildPaintCompositeCanvas(
              node.strokes,
              sceneNode.width,
              sceneNode.height,
              node.layers,
              currentFrame,
              requestedCanvasColorType,
              { resolveCloneSourceCanvas },
            );
      const committedAlphaCanvasPromise =
        existing?.committedKey === committedKey
          ? Promise.resolve(existing.committedAlphaCanvas)
          : buildPaintAlphaCompositeCanvas(
              node.strokes,
              sceneNode.width,
              sceneNode.height,
              node.layers,
              currentFrame,
              requestedCanvasColorType,
              { resolveCloneSourceCanvas },
            );

      void Promise.all([committedColorCanvasPromise, committedAlphaCanvasPromise])
        .then(([committedColorCanvas, committedAlphaCanvas]) => {
          if (isDisposed) return;
          const latestNode = nodes.find(
            (candidate) => candidate.id === node.id && candidate.type === NodeType.PAINT,
          ) as PaintNode | undefined;
          if (!latestNode) {
            return;
          }

          if (
            getPaintTextureCommittedState({
              node: latestNode,
              nodes,
              frame: currentFrame,
              width: sceneNode.width,
              height: sceneNode.height,
            }).committedKey !== committedKey
          ) {
            return;
          }

          if (!committedColorCanvas && !committedAlphaCanvas && !previewForNode) {
            if (removePaintTextureEntry(paintTexturesRef.current, node.id)) {
              bumpMediaUpdate();
            }
            return;
          }

          const activeCanvases = previewForNode
            ? renderPaintLivePreviewCanvases({
                committedColorCanvas,
                committedAlphaCanvas,
                preview: previewForNode,
                previewColorCanvas: existing?.previewColorCanvas,
                previewAlphaCanvas: existing?.previewAlphaCanvas,
                width: sceneNode.width,
                height: sceneNode.height,
                canvasColorType: requestedCanvasColorType,
              })
            : {
                colorCanvas: copyCommittedPaintCanvas(
                  committedColorCanvas,
                  existing?.previewColorCanvas,
                  sceneNode.width,
                  sceneNode.height,
                  requestedCanvasColorType,
                ),
                alphaCanvas: copyCommittedPaintCanvas(
                  committedAlphaCanvas,
                  existing?.previewAlphaCanvas,
                  sceneNode.width,
                  sceneNode.height,
                  requestedCanvasColorType,
                ),
              };

          if (!activeCanvases) {
            if (removePaintTextureEntry(paintTexturesRef.current, node.id)) {
              bumpMediaUpdate();
            }
            return;
          }

          upsertPaintTextureEntry(
            paintTexturesRef.current,
            node.id,
            key,
            committedKey,
            activeCanvases.colorCanvas,
            activeCanvases.alphaCanvas,
            committedColorCanvas,
            committedAlphaCanvas,
            previewForNode ? activeCanvases.colorCanvas : null,
            previewForNode ? activeCanvases.alphaCanvas : null,
            previewForNode,
          );
          bumpMediaUpdate();
        })
        .catch(() => undefined);
    });

    paintTexturesRef.current.forEach((entry, nodeId) => {
      if (!activeIds.has(nodeId)) {
        entry.colorTexture.dispose();
        entry.alphaTexture.dispose();
        paintTexturesRef.current.delete(nodeId);
      }
    });

    return () => {
      isDisposed = true;
    };
  }, [nodes, currentFrame, sceneNode, livePreview, bumpMediaUpdate]);

  useEffect(
    () => () => {
      paintTexturesRef.current.forEach((entry) => {
        entry.colorTexture.dispose();
        entry.alphaTexture.dispose();
      });
      paintTexturesRef.current.clear();
    },
    [],
  );

  return paintTexturesRef;
};
