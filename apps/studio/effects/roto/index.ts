import {
  NodeType,
  RotoPathBlend,
  RotoNode,
  type RotoTrackingTransform,
  type StabilizationConfig,
  type StabilizationScope,
} from '@blackboard/types';
import { EffectDefinition } from '../EffectDefinition';
import {
  createAnimatablePropertyCollector,
  type EffectAnimationBehavior,
} from '../effectAnimationHelpers';
import RotoAdjustments from './RotoAdjustments';
import RotoItemsPanel from './RotoItemsPanel';
import { RotoIcon } from './RotoIcon';
import { RotoTool } from './RotoTool';
import RotoViewportTools from './RotoViewportTools';
import RotoToolPanels from './RotoToolPanels';
import { getLinearValueAtFrame, getValueAtFrame, setKeyframeOnValue } from '@blackboard/renderer';
import { DEFAULT_ROTO_MOTION_BLUR } from '@/utils/rotoMotionBlur';
import { getRotoLayerPathIds, getRotoPathParentLayerId } from '@/utils/rotoHierarchy';
import {
  deriveUserTranslationFromPoints,
  multiplyRotoTrackingMatrix4,
  projectTrackingModelToMatrix4,
  resolveRotoLayerCompositeMatrix,
  resolveRotoPathCompositeMatrix,
  resolveRotoTrackingMatrix4,
  resolveRotoTrackingTransformDataFromMatrix,
} from '@/utils/rotoTracking';

type RotoStabilizeContext = {
  selectedRotoPathIds?: string[];
  selectedRotoLayerIds?: string[];
  stabilizationConfig?: Pick<StabilizationConfig, 'scope'>;
  stabilizationReferenceFrame?: number | null;
};

const getSelectedRotoPathIds = (context: unknown): string[] => {
  if (!context || typeof context !== 'object') return [];
  const maybeContext = context as RotoStabilizeContext;
  return Array.isArray(maybeContext.selectedRotoPathIds) ? maybeContext.selectedRotoPathIds : [];
};

const getSelectedRotoLayerIds = (context: unknown): string[] => {
  if (!context || typeof context !== 'object') return [];
  const maybeContext = context as RotoStabilizeContext;
  return Array.isArray(maybeContext.selectedRotoLayerIds) ? maybeContext.selectedRotoLayerIds : [];
};

const getStabilizationScope = (context: unknown): StabilizationScope => {
  if (!context || typeof context !== 'object') return 'parent';
  const maybeContext = context as RotoStabilizeContext;
  return maybeContext.stabilizationConfig?.scope ?? 'parent';
};

const getStabilizationReferenceFrame = (context: unknown): number | null => {
  if (!context || typeof context !== 'object') return null;
  const maybeContext = context as RotoStabilizeContext;
  return maybeContext.stabilizationReferenceFrame ?? null;
};

const getAverageTrackOffset = (paths: RotoNode['paths'], frame: number) => {
  let totalX = 0;
  let totalY = 0;
  let pointCount = 0;

  paths.forEach((path) => {
    path.trackPoints?.forEach((trackPoint) => {
      totalX += getLinearValueAtFrame(trackPoint.x, frame);
      totalY += getLinearValueAtFrame(trackPoint.y, frame);
      pointCount += 1;
    });
  });

  if (pointCount === 0) {
    return null;
  }

  return {
    x: totalX / pointCount,
    y: totalY / pointCount,
    scale: 1,
    rotation: 0,
    matrix: projectTrackingModelToMatrix4(
      [totalX / pointCount, totalY / pointCount],
      'translation',
    ),
  };
};

const getOwnStabilizeTransform = (
  trackingTransform: RotoTrackingTransform | undefined,
  userTransform: RotoTrackingTransform | undefined,
  frame: number,
) => {
  if (!trackingTransform && !userTransform) {
    return null;
  }

  let matrix = resolveRotoTrackingMatrix4(trackingTransform?.matrix, frame);
  if (userTransform) {
    matrix = multiplyRotoTrackingMatrix4(
      matrix,
      resolveRotoTrackingMatrix4(userTransform.matrix, frame),
    );
  }

  return resolveRotoTrackingTransformDataFromMatrix(matrix);
};

const getLayerStabilizeTransform = (
  rotoNode: RotoNode,
  layerId: string,
  frame: number,
  scope: StabilizationScope,
  referenceFrame: number | null,
) => {
  const selectedLayer = rotoNode.layers?.find((layer) => layer.id === layerId);
  if (!selectedLayer) {
    return null;
  }

  if (scope === 'target') {
    return getOwnStabilizeTransform(
      selectedLayer.trackingTransform,
      selectedLayer.userTransform,
      frame,
    );
  }

  if (scope === 'full') {
    const compositeMatrix = resolveRotoLayerCompositeMatrix(rotoNode, layerId, frame, {
      includeUserTransform: true,
    });
    if (referenceFrame !== null) {
      const childPaths = rotoNode.paths.filter((p) => p.parentLayerId === layerId);
      if (childPaths.length > 0) {
        let refCX = 0,
          refCY = 0,
          curCX = 0,
          curCY = 0,
          count = 0;
        for (const path of childPaths) {
          for (const point of path.points) {
            refCX += getLinearValueAtFrame(point.x, referenceFrame);
            refCY += getLinearValueAtFrame(point.y, referenceFrame);
            curCX += getLinearValueAtFrame(point.x, frame);
            curCY += getLinearValueAtFrame(point.y, frame);
            count += 1;
          }
        }
        if (count > 0) {
          const dx = (curCX - refCX) / count;
          const dy = (curCY - refCY) / count;
          const derivedMatrix = projectTrackingModelToMatrix4([dx, dy], 'translation');
          return {
            ...resolveRotoTrackingTransformDataFromMatrix(compositeMatrix),
            auxiliaryTranslation: derivedMatrix,
          };
        }
      }
    }
    return resolveRotoTrackingTransformDataFromMatrix(compositeMatrix);
  }

  return resolveRotoTrackingTransformDataFromMatrix(
    scope === 'composite'
      ? resolveRotoLayerCompositeMatrix(rotoNode, layerId, frame, {
          includeUserTransform: true,
        })
      : resolveRotoLayerCompositeMatrix(rotoNode, layerId, frame, {
          includeSelf: false,
          includeUserTransform: true,
        }),
  );
};

const getPathStabilizeTransform = (
  rotoNode: RotoNode,
  pathId: string,
  frame: number,
  scope: StabilizationScope,
  referenceFrame: number | null,
) => {
  const selectedPath = rotoNode.paths.find((path) => path.id === pathId);
  if (!selectedPath) {
    return null;
  }

  if (scope === 'target') {
    return getOwnStabilizeTransform(
      selectedPath.trackingTransform,
      selectedPath.userTransform,
      frame,
    );
  }

  if (scope === 'composite') {
    return resolveRotoTrackingTransformDataFromMatrix(
      resolveRotoPathCompositeMatrix(rotoNode, selectedPath, frame, {
        includeUserTransform: true,
      }),
    );
  }

  if (scope === 'full') {
    const compositeMatrix = resolveRotoPathCompositeMatrix(rotoNode, selectedPath, frame, {
      includeUserTransform: true,
    });
    if (referenceFrame !== null) {
      const derivedMatrix = deriveUserTranslationFromPoints(selectedPath, referenceFrame, frame);
      return {
        ...resolveRotoTrackingTransformDataFromMatrix(compositeMatrix),
        auxiliaryTranslation: derivedMatrix,
      };
    }
    return resolveRotoTrackingTransformDataFromMatrix(compositeMatrix);
  }

  return resolveRotoTrackingTransformDataFromMatrix(
    resolveRotoLayerCompositeMatrix(
      rotoNode,
      getRotoPathParentLayerId(rotoNode, selectedPath),
      frame,
      { includeUserTransform: true },
    ),
  );
};

const rotoAnimation: EffectAnimationBehavior = {
  getAnimatableProperties: (node, options) => {
    const rotoNode = node as RotoNode;
    const { props, addProp } = createAnimatablePropertyCollector();
    const selectedIds = options?.selectedRotoPathIds || [];
    const hasSelection = selectedIds.length > 0;

    rotoNode.paths.forEach((path, index) => {
      if (hasSelection && !selectedIds.includes(path.id)) {
        return;
      }

      const allKeyframes = new Set<number>();
      path.points.forEach((pt) => {
        if (Array.isArray(pt.x)) pt.x.forEach((k) => allKeyframes.add(k.frame));
        if (Array.isArray(pt.y)) pt.y.forEach((k) => allKeyframes.add(k.frame));
      });

      addProp(
        'Path Animation',
        `paths[${index}].points`,
        Array.from(allKeyframes)
          .sort((a, b) => a - b)
          .map((frame) => ({ frame, value: 0 })),
        path.name,
        path.trackingData,
      );

      addProp('Opacity', `paths[${index}].opacity`, path.opacity, path.name);
      addProp('Feather', `paths[${index}].feather`, path.feather, path.name);
      if (path.style.strokeWidth !== undefined) {
        addProp(
          'Stroke Width',
          `paths[${index}].style.strokeWidth`,
          path.style.strokeWidth,
          path.name,
        );
      }

      path.points.forEach((pt, ptIndex) => {
        addProp(`Pt ${ptIndex} X`, `paths[${index}].points[${ptIndex}].x`, pt.x, path.name);
        addProp(`Pt ${ptIndex} Y`, `paths[${index}].points[${ptIndex}].y`, pt.y, path.name);
      });
    });

    return props;
  },
  setKeyframeValue: (node, propertyPath, frame, value) => {
    const rotoNode = node as RotoNode;
    if (!propertyPath.includes('.points[')) {
      return undefined;
    }

    const pathIndexMatch = propertyPath.match(/paths\[(\d+)\]/);
    const pointIndexMatch = propertyPath.match(/points\[(\d+)\]/);
    const axisMatch = propertyPath.match(/\.(x|y)$/);

    if (!pathIndexMatch || !pointIndexMatch || !axisMatch) {
      return undefined;
    }

    const pathIndex = parseInt(pathIndexMatch[1]);
    const pointIndex = parseInt(pointIndexMatch[1]);
    const axis = axisMatch[1] as 'x' | 'y';

    if (pathIndex >= rotoNode.paths.length) {
      return undefined;
    }

    const path = rotoNode.paths[pathIndex];
    const currentPoint = path.points[pointIndex];
    if (!currentPoint) {
      return undefined;
    }

    const updatedProp = setKeyframeOnValue(currentPoint[axis], frame, value);
    const newPoints = [...path.points];
    newPoints[pointIndex] = {
      ...currentPoint,
      [axis]: updatedProp,
    };

    const syncedPoints = newPoints.map((pt, idx) => {
      let newX = pt.x;
      let newY = pt.y;

      if (!(idx === pointIndex && axis === 'x')) {
        newX = setKeyframeOnValue(pt.x, frame, getValueAtFrame(pt.x, frame));
      }

      if (!(idx === pointIndex && axis === 'y')) {
        newY = setKeyframeOnValue(pt.y, frame, getValueAtFrame(pt.y, frame));
      }

      return { x: newX, y: newY };
    });

    const newPaths = [...rotoNode.paths];
    newPaths[pathIndex] = { ...path, points: syncedPoints };

    return { ...rotoNode, paths: newPaths };
  },
};

export const rotoEffect: EffectDefinition = {
  type: NodeType.ROTO,
  name: 'Roto',
  category: 'Effect',
  renderMode: 'mask',
  description: 'Create masks using vector shapes.',
  IconComponent: RotoIcon,
  ToolComponent: RotoTool,
  AdjustmentComponent: RotoAdjustments,
  ItemsComponent: RotoItemsPanel,
  ViewportToolsComponent: RotoViewportTools,
  ViewportToolPanelComponent: RotoToolPanels,
  animation: rotoAnimation,
  defaultViewportTool: 'select',
  flags: {},
  getInitialNodeProps: () => ({
    paths: [],
    layers: [],
    invert: false,
    motionBlur: { ...DEFAULT_ROTO_MOTION_BLUR },
  }),
  getStabilizeTransform: (node, frame, context) => {
    const rotoNode = node as RotoNode;
    const stabilizationScope = getStabilizationScope(context);
    const referenceFrame = getStabilizationReferenceFrame(context);
    const selectedLayerIds = getSelectedRotoLayerIds(context);

    if (selectedLayerIds.length === 1) {
      const selectedLayer = rotoNode.layers?.find((layer) => layer.id === selectedLayerIds[0]);
      const matrixTransform = getLayerStabilizeTransform(
        rotoNode,
        selectedLayerIds[0],
        frame,
        stabilizationScope,
        referenceFrame,
      );
      if (matrixTransform) {
        return matrixTransform;
      }
      const sourcePathIds = selectedLayer?.trackingTransform?.sourcePathIds?.length
        ? selectedLayer.trackingTransform.sourcePathIds
        : getRotoLayerPathIds(rotoNode, selectedLayerIds[0]);

      return getAverageTrackOffset(
        rotoNode.paths.filter((path) => sourcePathIds.includes(path.id)),
        frame,
      );
    }

    const selectedPathIds = getSelectedRotoPathIds(context);
    if (selectedPathIds.length === 1) {
      const matrixTransform = getPathStabilizeTransform(
        rotoNode,
        selectedPathIds[0],
        frame,
        stabilizationScope,
        referenceFrame,
      );
      if (matrixTransform) {
        return matrixTransform;
      }
    }
    const candidatePaths =
      selectedPathIds.length > 0
        ? rotoNode.paths.filter((path) => selectedPathIds.includes(path.id))
        : rotoNode.paths.slice(0, 1);

    return getAverageTrackOffset(candidatePaths, frame);
  },
  toolHotkeys: {
    q: 'select',
    b: 'bspline',
    r: 'rectangle',
    f: 'freehand',
    w: 'nudge',
  },
  onNodeUpdate: (node, changes) => {
    if ('paths' in changes || 'layers' in changes) {
      return { changes, label: `Edit ${node.name} Shapes` };
    }
    return { changes };
  },
};
