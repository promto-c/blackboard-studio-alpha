import * as THREE from 'three';
import { getValueAtFrame } from '@blackboard/renderer';
import {
  NodeType,
  RotoDrawMode,
  RotoPathBlend,
  RotoShapeType,
  type AnyNode,
  type RotoNode,
  type SceneNode,
} from '@blackboard/types';
import { drawBSplineOnCanvas } from '@/utils/bspline';
import {
  getRotoLayerMap,
  getRotoPathParentLayerId,
  getVisibleRotoPaths,
} from '@/utils/rotoHierarchy';
import { resolveRotoPathPointsAtFrame } from '@/utils/rotoTracking';
import { DEFAULT_ROTO_POINT_WEIGHT_MODE } from '@/utils/rotoPointWeights';

export interface RotoMaskTextureBundle {
  textures: Map<string, THREE.CanvasTexture>;
  dispose: () => void;
}

const createMaskCanvas = (
  node: RotoNode,
  sceneNode: SceneNode,
  frame: number,
): HTMLCanvasElement | null => {
  const canvas = document.createElement('canvas');
  canvas.width = sceneNode.width;
  canvas.height = sceneNode.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const layerMap = getRotoLayerMap(node);
  const getBlendForPath = (path: RotoNode['paths'][number]) => {
    const parentLayerId = getRotoPathParentLayerId(node, path);
    const layer = parentLayerId ? layerMap.get(parentLayerId) : undefined;
    return layer?.blend ?? path.blend;
  };

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = node.invert ? 'white' : 'black';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const path of getVisibleRotoPaths(node)) {
    const opacity = getValueAtFrame(path.opacity, frame);
    if (opacity <= 0) continue;

    const { mode, strokeWidth } = path.style;
    const strokeWidthAtFrame = getValueAtFrame(strokeWidth, frame);
    const feather = getValueAtFrame(path.feather, frame);
    const blend = getBlendForPath(path);

    ctx.save();
    ctx.globalAlpha = opacity / 100;
    if (node.invert) {
      ctx.globalCompositeOperation =
        blend === RotoPathBlend.ADD ? 'destination-out' : 'destination-in';
      ctx.fillStyle = 'black';
      ctx.strokeStyle = 'black';
    } else {
      ctx.globalCompositeOperation =
        blend === RotoPathBlend.SUBTRACT ? 'destination-out' : 'source-over';
      ctx.fillStyle = 'white';
      ctx.strokeStyle = 'white';
    }
    if (feather > 0) {
      ctx.filter = `blur(${feather}px)`;
    }

    ctx.beginPath();
    if (path.points.length > 0) {
      const sceneCenterX = canvas.width / 2;
      const sceneCenterY = canvas.height / 2;
      const resolvedPoints = resolveRotoPathPointsAtFrame(node, path, frame);
      const translatedPoints = resolvedPoints.map((point) => ({
        x: point.x + sceneCenterX,
        y: point.y + sceneCenterY,
      }));

      if (path.shapeType === RotoShapeType.BSPLINE) {
        drawBSplineOnCanvas(
          ctx,
          translatedPoints,
          path.closed,
          path.pointWeights,
          DEFAULT_ROTO_POINT_WEIGHT_MODE,
          path.pointTypes,
          path.pointWeightModes,
        );
      } else {
        ctx.moveTo(translatedPoints[0].x, translatedPoints[0].y);
        for (let pointIndex = 1; pointIndex < translatedPoints.length; pointIndex += 1) {
          ctx.lineTo(translatedPoints[pointIndex].x, translatedPoints[pointIndex].y);
        }
      }
    }

    if (path.closed) ctx.closePath();
    ctx.lineWidth = strokeWidthAtFrame;
    if (mode === RotoDrawMode.FILL) {
      if (path.closed) ctx.fill();
    } else if (mode === RotoDrawMode.STROKE) {
      ctx.stroke();
    } else if (mode === RotoDrawMode.FILL_AND_STROKE) {
      if (path.closed) ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  return canvas;
};

export const createRotoMaskTextureBundle = (
  nodes: AnyNode[],
  sceneNode: SceneNode,
  frame: number,
): RotoMaskTextureBundle => {
  const textures = new Map<string, THREE.CanvasTexture>();

  nodes.forEach((node) => {
    if (node.type !== NodeType.ROTO || !node.visible) return;

    const canvas = createMaskCanvas(node as RotoNode, sceneNode, frame);
    if (!canvas) return;

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.NoColorSpace;
    texture.needsUpdate = true;
    textures.set(node.id, texture);
  });

  return {
    textures,
    dispose: () => {
      textures.forEach((texture) => texture.dispose());
    },
  };
};
