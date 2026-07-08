import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { configureRawStraightAlphaTexture } from '@blackboard/renderer';
import {
  NodeType,
  type AnyNode,
  type PaintNode,
  type ProjectColorManagement,
  type SceneNode,
} from '@blackboard/types';
import {
  applyPaintStrokeToRaster,
  buildPaintAlphaCompositeRaster,
  buildPaintCompositeRaster,
  clonePaintRaster,
  createPaintRaster,
  type PaintLivePreview,
} from '@/nodes/builtin/paint/paintRaster';
import { withSharedPaintSnapshotRenderer } from '@/nodes/builtin/paint/paintSnapshotRenderer';
import {
  renderTargetToPaintCloneSource,
  type PaintCloneSource,
  type PaintRaster,
} from '@/nodes/builtin/paint/paintFloatReadback';
import { getPaintTextureCommittedState } from '@/nodes/builtin/paint/paintTextureKeys';
import { renderWithSharedPipeline } from '@/renderer/pipeline';

interface PaintTextureEntry {
  colorTexture: THREE.DataTexture;
  alphaTexture: THREE.DataTexture;
  key: string;
  committedKey: string;
  committedColorRaster: PaintRaster | null;
  committedAlphaRaster: PaintRaster | null;
  previewColorRaster: PaintRaster | null;
  previewAlphaRaster: PaintRaster | null;
  preview: PaintLivePreview | null;
}

interface UseViewportPaintTexturesOptions {
  nodes: AnyNode[];
  currentFrame: number;
  sceneNode: SceneNode | undefined;
  projectColorManagement: ProjectColorManagement;
  livePreview?: PaintLivePreview | null;
  bumpMediaUpdate: () => void;
}

const createPaintTexture = (raster: PaintRaster): THREE.DataTexture => {
  const texture = configureRawStraightAlphaTexture(
    new THREE.DataTexture(
      raster.rgba,
      raster.width,
      raster.height,
      THREE.RGBAFormat,
      THREE.FloatType,
    ),
  );
  texture.flipY = true;
  texture.unpackAlignment = 1;
  return texture;
};

const updatePaintTexture = (texture: THREE.DataTexture, raster: PaintRaster) => {
  texture.image = {
    data: raster.rgba,
    width: raster.width,
    height: raster.height,
  };
  texture.needsUpdate = true;
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
  colorRaster: PaintRaster,
  alphaRaster: PaintRaster,
  committedColorRaster: PaintRaster | null,
  committedAlphaRaster: PaintRaster | null,
  previewColorRaster: PaintRaster | null,
  previewAlphaRaster: PaintRaster | null,
  preview: PaintLivePreview | null,
) => {
  const existing = entries.get(nodeId);
  const colorTexture = existing?.colorTexture ?? createPaintTexture(colorRaster);
  const alphaTexture = existing?.alphaTexture ?? createPaintTexture(alphaRaster);
  if (existing) {
    updatePaintTexture(colorTexture, colorRaster);
    updatePaintTexture(alphaTexture, alphaRaster);
  }

  entries.set(nodeId, {
    colorTexture,
    alphaTexture,
    key,
    committedKey,
    committedColorRaster,
    committedAlphaRaster,
    previewColorRaster,
    previewAlphaRaster,
    preview,
  });
};

const copyCommittedPaintRaster = (
  committed: PaintRaster | null,
  reusable: PaintRaster | null | undefined,
  width: number,
  height: number,
): PaintRaster => {
  const next =
    reusable?.width === width && reusable.height === height
      ? reusable
      : createPaintRaster(width, height);
  next.rgba.fill(0);
  if (committed) {
    next.rgba.set(committed.rgba);
  }
  return next;
};

const renderPaintLivePreviewRasters = ({
  committedColorRaster,
  committedAlphaRaster,
  preview,
  previewColorRaster,
  previewAlphaRaster,
  width,
  height,
}: {
  committedColorRaster: PaintRaster | null;
  committedAlphaRaster: PaintRaster | null;
  preview: PaintLivePreview;
  previewColorRaster: PaintRaster | null | undefined;
  previewAlphaRaster: PaintRaster | null | undefined;
  width: number;
  height: number;
}): { colorRaster: PaintRaster; alphaRaster: PaintRaster } => {
  const colorRaster = copyCommittedPaintRaster(
    committedColorRaster,
    previewColorRaster,
    width,
    height,
  );
  const alphaRaster = copyCommittedPaintRaster(
    committedAlphaRaster,
    previewAlphaRaster,
    width,
    height,
  );
  applyPaintStrokeToRaster(preview.channels === 'a' ? alphaRaster : colorRaster, {
    tool: preview.tool,
    points: preview.points,
    width,
    height,
    size: preview.size,
    spacing: preview.spacing,
    softness: preview.softness,
    opacity: preview.opacity,
    color: preview.color,
    alpha: preview.alpha,
    channels: preview.channels,
    cloneOffset: preview.cloneOffset,
    cloneSource: preview.cloneSource,
  });
  return { colorRaster, alphaRaster };
};

export const useViewportPaintTextures = ({
  nodes,
  currentFrame,
  sceneNode,
  projectColorManagement,
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
      let cloneSourcePromise: Promise<PaintCloneSource | null> | null = null;
      const resolveCloneSource = (): Promise<PaintCloneSource | null> => {
        if (!requiresDynamicCloneSource) return Promise.resolve(null);
        cloneSourcePromise ??= (async () => {
          const paintNodeIndex = nodes.findIndex((candidate) => candidate.id === node.id);
          if (paintNodeIndex < 0) return null;
          const upstreamNodes = nodes.slice(0, paintNodeIndex);
          return withSharedPaintSnapshotRenderer(async (renderer) => {
            const { finalOutputTarget, dispose } = await renderWithSharedPipeline({
              captureFinalOutput: true,
              nodes: upstreamNodes,
              sceneNode,
              projectColorManagement,
              frame: currentFrame,
              width: sceneNode.width,
              height: sceneNode.height,
              finalColorSpace: 'scene_linear',
              presentToCanvas: false,
              textureCacheMode: 'persistent',
              renderer,
            });
            try {
              if (!finalOutputTarget) {
                throw new Error('Clone sampling requires a floating-point renderer capture.');
              }
              return renderTargetToPaintCloneSource(renderer, finalOutputTarget);
            } finally {
              dispose();
            }
          });
        })();
        return cloneSourcePromise;
      };

      if (existing?.key === key) return;

      const shouldHoldExistingPreview =
        !previewForNode &&
        existing?.previewColorRaster &&
        existing.previewAlphaRaster &&
        existing.preview &&
        existing.committedKey === committedKey;
      const canPromoteExistingPreview =
        !previewForNode &&
        existing?.previewColorRaster &&
        existing.previewAlphaRaster &&
        existing.preview &&
        existing.committedKey !== committedKey &&
        node.strokes.length > 0 &&
        node.strokes[0].pointCount === existing.preview.cursor &&
        node.strokes[0].tool === existing.preview.tool &&
        node.strokes[0].size === existing.preview.size &&
        node.strokes[0].spacing === existing.preview.spacing &&
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
          existing.previewColorRaster,
          existing.previewAlphaRaster,
          existing.committedColorRaster,
          existing.committedAlphaRaster,
          existing.previewColorRaster,
          existing.previewAlphaRaster,
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
          existing.previewColorRaster,
          existing.previewAlphaRaster,
          existing.previewColorRaster,
          existing.previewAlphaRaster,
          null,
          null,
          null,
        );
        bumpMediaUpdate();
        return;
      }

      if (previewForNode && existing?.committedKey === committedKey) {
        const previewRasters = renderPaintLivePreviewRasters({
          committedColorRaster: existing.committedColorRaster,
          committedAlphaRaster: existing.committedAlphaRaster,
          preview: previewForNode,
          previewColorRaster: existing.previewColorRaster,
          previewAlphaRaster: existing.previewAlphaRaster,
          width: sceneNode.width,
          height: sceneNode.height,
        });
        upsertPaintTextureEntry(
          paintTexturesRef.current,
          node.id,
          key,
          committedKey,
          previewRasters.colorRaster,
          previewRasters.alphaRaster,
          existing.committedColorRaster,
          existing.committedAlphaRaster,
          previewRasters.colorRaster,
          previewRasters.alphaRaster,
          previewForNode,
        );
        bumpMediaUpdate();
        return;
      }

      const committedColorPromise =
        existing?.committedKey === committedKey
          ? Promise.resolve(existing.committedColorRaster)
          : buildPaintCompositeRaster(
              node.strokes,
              sceneNode.width,
              sceneNode.height,
              node.layers,
              currentFrame,
              { resolveCloneSource },
            );
      const committedAlphaPromise =
        existing?.committedKey === committedKey
          ? Promise.resolve(existing.committedAlphaRaster)
          : buildPaintAlphaCompositeRaster(
              node.strokes,
              sceneNode.width,
              sceneNode.height,
              node.layers,
              currentFrame,
              { resolveCloneSource },
            );

      void Promise.all([committedColorPromise, committedAlphaPromise])
        .then(([committedColorRaster, committedAlphaRaster]) => {
          if (isDisposed) return;
          const latestNode = nodes.find(
            (candidate) => candidate.id === node.id && candidate.type === NodeType.PAINT,
          ) as PaintNode | undefined;
          if (
            !latestNode ||
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

          if (!committedColorRaster && !committedAlphaRaster && !previewForNode) {
            if (removePaintTextureEntry(paintTexturesRef.current, node.id)) bumpMediaUpdate();
            return;
          }

          const activeRasters = previewForNode
            ? renderPaintLivePreviewRasters({
                committedColorRaster,
                committedAlphaRaster,
                preview: previewForNode,
                previewColorRaster: existing?.previewColorRaster,
                previewAlphaRaster: existing?.previewAlphaRaster,
                width: sceneNode.width,
                height: sceneNode.height,
              })
            : {
                colorRaster: committedColorRaster
                  ? clonePaintRaster(committedColorRaster)
                  : createPaintRaster(sceneNode.width, sceneNode.height),
                alphaRaster: committedAlphaRaster
                  ? clonePaintRaster(committedAlphaRaster)
                  : createPaintRaster(sceneNode.width, sceneNode.height),
              };

          upsertPaintTextureEntry(
            paintTexturesRef.current,
            node.id,
            key,
            committedKey,
            activeRasters.colorRaster,
            activeRasters.alphaRaster,
            committedColorRaster,
            committedAlphaRaster,
            previewForNode ? activeRasters.colorRaster : null,
            previewForNode ? activeRasters.alphaRaster : null,
            previewForNode,
          );
          bumpMediaUpdate();
        })
        .catch(() => undefined);
    });

    paintTexturesRef.current.forEach((_entry, nodeId) => {
      if (!activeIds.has(nodeId)) removePaintTextureEntry(paintTexturesRef.current, nodeId);
    });
    return () => {
      isDisposed = true;
    };
  }, [nodes, currentFrame, sceneNode, projectColorManagement, livePreview, bumpMediaUpdate]);

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
