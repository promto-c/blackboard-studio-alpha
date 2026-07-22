import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type RefObject,
} from 'react';
import type {
  AnyNode,
  RotoNode,
  SceneNode,
  StabilizationConfig,
  TransformData,
} from '@blackboard/types';
import { getRotoPathParentLayerId } from '@/utils/rotoHierarchy';
import { nodeRegistry } from '@/nodes/registry';
import {
  applyRotoTrackingMatrix4ToPoint,
  formatRotoTrackingMatrix4AsCssMatrix3d,
  invertRotoTrackingMatrix4,
  multiplyRotoTrackingMatrix4,
  reduceRotoTrackingMatrix4ToComponents,
  resolveRotoTrackingTransformDataFromMatrix,
} from '@/utils/rotoTracking';

type UseViewportStabilizationOptions = {
  isStabilized: boolean;
  stabilizationReference: TransformData | null;
  stabilizationReferenceFrame: number | null;
  stabilizationConfig: StabilizationConfig;
  selectedNode: AnyNode | null | undefined;
  hierarchySelections: Record<string, { layerIds: string[]; itemIds: string[] }>;
  selectedNodeId: string | null;
  sceneNode: SceneNode | null | undefined;
  visualFrame: number;
  pan: { x: number; y: number };
  zoom: number;
  viewportRef: RefObject<HTMLDivElement | null>;
  recaptureStabilizationReference: () => void;
};

const buildScalarTransformMatrix = (transform: TransformData) => {
  const scale = Number.isFinite(transform.scale) ? transform.scale : 1;
  const rotation = Number.isFinite(transform.rotation) ? transform.rotation : 0;
  const cos = Math.cos(rotation) * scale;
  const sin = Math.sin(rotation) * scale;
  return [
    [cos, -sin, 0, transform.x],
    [sin, cos, 0, transform.y],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
};

const resolveParentLayer = (
  rotoNode: RotoNode,
  pathIds: string[],
  layerIds: string[],
): string | null => {
  if (pathIds.length === 1) {
    const path = rotoNode.paths.find((p) => p.id === pathIds[0]);
    return path ? getRotoPathParentLayerId(rotoNode, path) : null;
  }
  if (layerIds.length === 1) {
    const layer = rotoNode.layers?.find((l) => l.id === layerIds[0]);
    return layer?.parentLayerId ?? null;
  }
  return null;
};

export const useViewportStabilization = ({
  isStabilized,
  stabilizationReference,
  stabilizationReferenceFrame,
  stabilizationConfig,
  selectedNode,
  hierarchySelections,
  selectedNodeId,
  sceneNode,
  visualFrame,
  pan,
  zoom,
  viewportRef,
  recaptureStabilizationReference,
}: UseViewportStabilizationOptions) => {
  const selectedRotoLayerIds = useMemo(
    () => hierarchySelections[selectedNodeId ?? '']?.layerIds ?? [],
    [hierarchySelections, selectedNodeId],
  );
  const selectedRotoPathIds = useMemo(
    () => hierarchySelections[selectedNodeId ?? '']?.itemIds ?? [],
    [hierarchySelections, selectedNodeId],
  );

  const prevRotoSelectionRef = useRef({
    pathIds: selectedRotoPathIds,
    layerIds: selectedRotoLayerIds,
  });

  useEffect(() => {
    const prev = prevRotoSelectionRef.current;

    prevRotoSelectionRef.current = {
      pathIds: selectedRotoPathIds,
      layerIds: selectedRotoLayerIds,
    };

    if (!isStabilized || !selectedNode) return;

    const prevKey = [...prev.pathIds, ...prev.layerIds].sort().join(',');
    const nextKey = [...selectedRotoPathIds, ...selectedRotoLayerIds].sort().join(',');
    if (prevKey === nextKey) return;

    if (stabilizationConfig.scope === 'parent') {
      const rotoNode = selectedNode as RotoNode;
      const prevParent = resolveParentLayer(rotoNode, prev.pathIds, prev.layerIds);
      const nextParent = resolveParentLayer(rotoNode, selectedRotoPathIds, selectedRotoLayerIds);
      if (prevParent !== null && nextParent !== null && prevParent === nextParent) return;
    }

    recaptureStabilizationReference();
  }, [
    isStabilized,
    selectedNode,
    selectedRotoPathIds,
    selectedRotoLayerIds,
    stabilizationConfig.scope,
    recaptureStabilizationReference,
  ]);

  const stabilizationMatrix = useMemo<number[][] | null>(() => {
    if (!isStabilized || !stabilizationReference || !selectedNode) return null;
    const def = nodeRegistry.get(selectedNode.type);
    if (!def?.getStabilizeTransform) return null;

    const currentTransform = def.getStabilizeTransform(selectedNode, visualFrame, {
      stabilizationConfig,
      selectedRotoLayerIds,
      selectedRotoPathIds,
      stabilizationReferenceFrame,
    });
    if (!currentTransform) return null;

    const referenceMatrix =
      stabilizationReference.matrix ?? buildScalarTransformMatrix(stabilizationReference);
    const currentMatrix = currentTransform.matrix ?? buildScalarTransformMatrix(currentTransform);
    const currentInverseMatrix = invertRotoTrackingMatrix4(currentMatrix);
    if (!currentInverseMatrix) {
      return null;
    }

    let result = reduceRotoTrackingMatrix4ToComponents(
      multiplyRotoTrackingMatrix4(referenceMatrix, currentInverseMatrix),
      stabilizationConfig,
    );

    const refAux = stabilizationReference.auxiliaryTranslation;
    const curAux = currentTransform.auxiliaryTranslation;
    if (refAux || curAux) {
      const identity = [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
      ];
      const refAuxMatrix = refAux ?? identity;
      const curAuxMatrix = curAux ?? identity;
      const curAuxInverse = invertRotoTrackingMatrix4(curAuxMatrix);
      if (curAuxInverse) {
        const auxDiff = multiplyRotoTrackingMatrix4(refAuxMatrix, curAuxInverse);
        result = multiplyRotoTrackingMatrix4(auxDiff, result);
      }
    }

    return result;
  }, [
    isStabilized,
    stabilizationReference,
    stabilizationReferenceFrame,
    stabilizationConfig,
    selectedNode,
    visualFrame,
    selectedRotoLayerIds,
    selectedRotoPathIds,
  ]);

  const stabilizationInverseMatrix = useMemo(
    () => (stabilizationMatrix ? invertRotoTrackingMatrix4(stabilizationMatrix) : null),
    [stabilizationMatrix],
  );

  const stabilizationScale = useMemo(
    () =>
      stabilizationMatrix
        ? resolveRotoTrackingTransformDataFromMatrix(stabilizationMatrix).scale
        : 1,
    [stabilizationMatrix],
  );

  const stabilizationTransformStyle = useMemo<CSSProperties>(
    () =>
      sceneNode
        ? {
            transformOrigin: `${sceneNode.width / 2}px ${sceneNode.height / 2}px`,
            transform: stabilizationMatrix
              ? formatRotoTrackingMatrix4AsCssMatrix3d(stabilizationMatrix)
              : undefined,
          }
        : {},
    [sceneNode, stabilizationMatrix],
  );

  const viewportTransformRef = useRef({
    pan,
    zoom,
    sceneNode,
    stabilizationInverseMatrix,
  });

  useLayoutEffect(() => {
    viewportTransformRef.current = {
      pan,
      zoom,
      sceneNode,
      stabilizationInverseMatrix,
    };
  }, [pan, zoom, sceneNode, stabilizationInverseMatrix]);

  const viewportToSceneCentered = useCallback(
    (viewportPos: { x: number; y: number }) => {
      const {
        pan: currentPan,
        zoom: currentZoom,
        sceneNode: currentSceneNode,
        stabilizationInverseMatrix: currentStabilizationInverseMatrix,
      } = viewportTransformRef.current;
      if (!viewportRef.current || !currentSceneNode) return { x: 0, y: 0 };
      const rect = viewportRef.current.getBoundingClientRect();

      const scenePoint = {
        x: (viewportPos.x - (rect.width / 2 + currentPan.x)) / currentZoom,
        y: (viewportPos.y - (rect.height / 2 - currentPan.y)) / currentZoom,
      };

      return currentStabilizationInverseMatrix
        ? applyRotoTrackingMatrix4ToPoint(currentStabilizationInverseMatrix, scenePoint)
        : scenePoint;
    },
    [viewportRef],
  );

  return {
    stabilizationMatrix,
    stabilizationScale,
    stabilizationInverseMatrix,
    stabilizationTransformStyle,
    viewportToSceneCentered,
  };
};
