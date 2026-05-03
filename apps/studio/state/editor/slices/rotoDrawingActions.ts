import {
  HistoryEntry,
  NodeType,
  RotoNode,
  RotoPath,
  RotoShapeType,
  RotoDrawMode,
  RotoPathBlend,
  RotoRefinement,
  Keyframe,
} from '@blackboard/types';
import {
  resolveAnimatablePoints,
  toFrameAnchoredPoints,
  toAnimatablePointFromKeyframes,
} from '@/state/editor/utils';
import { getLinearValueAtFrame, setKeyframeOnValue } from '@blackboard/renderer';
import { findContours } from '@/utils/contour';
import { simplifyPath, mapPointsToContour } from '@/utils/bspline';
import { insertRotoPointType, removeRotoPointTypes } from '@/utils/rotoPointTypes';
import {
  insertRotoPointWeight,
  insertRotoPointWeightMode,
  removeRotoPointWeightModes,
  removeRotoPointWeights,
} from '@/utils/rotoPointWeights';
import { getRotoCreationParentLayerId, prependRotoPath } from '@/utils/rotoHierarchy';
import {
  projectScenePointToRotoLayerLocal,
  projectScenePointToRotoPathBasePoint,
  resolveRotoPathPointsAtFrame,
} from '@/utils/rotoTracking';
import { getMediaSourceLabel } from '@/utils/mediaSourceSelection';
import {
  getSourcePixelDataForFrame,
  resolveSourcePixelSource,
} from '@/state/editor/services/sourcePixelData';
import type { SetState, GetState } from '@/state/editor/slices/types';

export function createRotoDrawingActions(
  set: SetState,
  get: GetState,
  deps: {
    pushHistory: (entry: Omit<HistoryEntry, 'id'>) => void;
  },
) {
  const rotoActions = {
    startDrawingShape: (initialPath: RotoPath) => {
      set(() => ({
        isDrawing: true,
        drawingRotoPath: initialPath,
        drawingSubHistory: [initialPath],
        drawingSubHistoryIndex: 0,
      }));
    },

    cancelDrawingShape: () => {
      set(() => ({
        isDrawing: false,
        drawingRotoPath: null,
        drawingSubHistory: [],
        drawingSubHistoryIndex: -1,
      }));
    },

    commitDrawingShape: (finalUpdates?: Partial<RotoPath>) => {
      const { nodes, selectedNodeId, drawingRotoPath, currentFrame } = get();
      if (!drawingRotoPath || !selectedNodeId) return;

      const layerIndex = nodes.findIndex((l) => l.id === selectedNodeId);
      if (layerIndex === -1 || nodes[layerIndex].type !== NodeType.ROTO) return;

      const rawPoints = resolveAnimatablePoints(drawingRotoPath.points, currentFrame);
      const keyframedPoints = toFrameAnchoredPoints(rawPoints, currentFrame);

      const finalPath = { ...drawingRotoPath, ...finalUpdates, points: keyframedPoints };
      if (finalPath.id.startsWith('path_drawing_')) {
        finalPath.id = `path_${Date.now()}`;
      }

      const newNode = {
        ...nodes[layerIndex],
        ...prependRotoPath(nodes[layerIndex] as RotoNode, finalPath),
      } as RotoNode;

      const newNodes = [...nodes];
      newNodes[layerIndex] = newNode;

      set(() => ({
        nodes: newNodes,
        selectedRotoLayerIds: [],
        isDrawing: false,
        drawingRotoPath: null,
        drawingSubHistory: [],
        drawingSubHistoryIndex: -1,
        selectedRotoPathIds: [finalPath.id],
        activeViewportTool: 'select',
      }));

      deps.pushHistory({
        label: `Draw Shape`,
        state: { nodes: newNodes, selectedNodeId },
      });
    },

    addPointToDrawingShape: (point: { x: number; y: number }) => {
      const { drawingRotoPath, drawingSubHistory, drawingSubHistoryIndex, currentFrame } = get();
      if (!drawingRotoPath) return;

      const currentPoints = resolveAnimatablePoints(drawingRotoPath.points, currentFrame);
      const newPoints = [...currentPoints, point];
      const newPath: RotoPath = {
        ...drawingRotoPath,
        points: toFrameAnchoredPoints(newPoints, 0),
      };

      const newHistory = drawingSubHistory.slice(0, drawingSubHistoryIndex + 1);
      newHistory.push(newPath);

      set(() => ({
        drawingRotoPath: newPath,
        drawingSubHistory: newHistory,
        drawingSubHistoryIndex: newHistory.length - 1,
      }));
    },

    updateDrawingPoint: (index: number, point: { x: number; y: number }) => {
      const { drawingRotoPath, drawingSubHistory, drawingSubHistoryIndex, currentFrame } = get();
      if (!drawingRotoPath) return;

      const currentPoints = resolveAnimatablePoints(drawingRotoPath.points, currentFrame);
      if (index < 0 || index >= currentPoints.length) return;

      const newPoints = [...currentPoints];
      newPoints[index] = point;

      const newPath: RotoPath = {
        ...drawingRotoPath,
        points: toFrameAnchoredPoints(newPoints, 0),
      };

      const newHistory = [...drawingSubHistory];
      newHistory[drawingSubHistoryIndex] = newPath;

      set(() => ({
        drawingRotoPath: newPath,
        drawingSubHistory: newHistory,
      }));
    },

    undoDrawingPoint: () => {
      const { drawingSubHistory, drawingSubHistoryIndex } = get();
      if (drawingSubHistoryIndex > 0) {
        const newIndex = drawingSubHistoryIndex - 1;
        set(() => ({
          drawingRotoPath: drawingSubHistory[newIndex],
          drawingSubHistoryIndex: newIndex,
        }));
      }
    },

    redoDrawingPoint: () => {
      const { drawingSubHistory, drawingSubHistoryIndex } = get();
      if (drawingSubHistoryIndex < drawingSubHistory.length - 1) {
        const newIndex = drawingSubHistoryIndex + 1;
        set(() => ({
          drawingRotoPath: drawingSubHistory[newIndex],
          drawingSubHistoryIndex: newIndex,
        }));
      }
    },

    traceNodeContour: async (
      rotoNodeId: string,
      sourceId: string,
      channel: 'luma' | 'alpha',
      threshold: number,
      targetPathId?: string,
    ) => {
      const { nodes, currentFrame, fps } = get();
      const rotoNode = nodes.find((l) => l.id === rotoNodeId) as RotoNode | undefined;
      if (!rotoNode) return;

      const source = resolveSourcePixelSource(nodes, rotoNodeId, sourceId);
      if (!source) return;

      const pixelData = await getSourcePixelDataForFrame(source, currentFrame, fps || 30);
      if (!pixelData) return;

      const channelOffset = channel === 'alpha' ? 3 : 0;
      const rawContours = findContours(
        new Uint8Array(pixelData.data.buffer),
        pixelData.width,
        pixelData.height,
        threshold,
        channelOffset,
      );

      if (rawContours.length === 0) return;

      const largestContour = rawContours.sort((a, b) => b.length - a.length)[0];
      const halfW = pixelData.width / 2;
      const halfH = pixelData.height / 2;
      const scenePoints = largestContour.map((p) => ({ x: p.x - halfW, y: p.y - halfH }));
      const sourceLabel =
        getMediaSourceLabel(nodes, rotoNodeId, sourceId) ??
        (source.kind === 'media-node' ? source.node.name : 'Upstream Result');

      rotoActions.startRotoRefinement({
        name: `Trace ${sourceLabel}`,
        originalPoints: scenePoints,
        epsilon: 2.0,
        closed: true,
        targetPathId: targetPathId,
      });
    },

    startRotoRefinement: (refinement: RotoRefinement) =>
      set(() => ({ rotoRefinement: refinement })),
    updateRotoRefinement: (updates: Partial<RotoRefinement>) =>
      set((s) => ({
        rotoRefinement: s.rotoRefinement ? { ...s.rotoRefinement, ...updates } : null,
      })),
    cancelRotoRefinement: () => set(() => ({ rotoRefinement: null })),

    commitRotoRefinement: () => {
      const {
        rotoRefinement,
        nodes,
        selectedNodeId,
        currentFrame,
        selectedRotoLayerIds,
        selectedRotoPathIds,
      } = get();
      if (!rotoRefinement || !selectedNodeId) return;

      const rotoIndex = nodes.findIndex((l) => l.id === selectedNodeId);
      if (rotoIndex === -1) return;
      const rotoNode = nodes[rotoIndex] as RotoNode;

      if (rotoRefinement.targetPathId) {
        const pathIndex = rotoNode.paths.findIndex((p) => p.id === rotoRefinement.targetPathId);
        if (pathIndex !== -1) {
          const existingPath = rotoNode.paths[pathIndex];
          const existingResolved = resolveRotoPathPointsAtFrame(
            rotoNode,
            existingPath,
            currentFrame,
          );

          const mappedPoints = mapPointsToContour(
            existingResolved,
            rotoRefinement.originalPoints,
            rotoRefinement.closed,
          );

          const updatedPoints = existingPath.points.map((pt, i) => {
            const newPos = mappedPoints[i] || existingResolved[i];
            const projectedPoint = projectScenePointToRotoPathBasePoint(
              rotoNode,
              existingPath,
              currentFrame,
              i,
              newPos,
            );

            return {
              x: setKeyframeOnValue(pt.x, currentFrame, projectedPoint.x),
              y: setKeyframeOnValue(pt.y, currentFrame, projectedPoint.y),
            };
          });

          const updatedPath = { ...existingPath, points: updatedPoints };
          const newPaths = [...rotoNode.paths];
          newPaths[pathIndex] = updatedPath;

          const newNodes = [...nodes];
          newNodes[rotoIndex] = { ...rotoNode, paths: newPaths };

          set(() => ({ nodes: newNodes, rotoRefinement: null }));
          deps.pushHistory({
            label: `Keyframe Shape via Trace: ${existingPath.name}`,
            state: { nodes: newNodes, selectedNodeId },
          });
        }
      } else {
        const simplified = simplifyPath(rotoRefinement.originalPoints, rotoRefinement.epsilon);
        const parentLayerId = getRotoCreationParentLayerId(
          rotoNode,
          selectedRotoLayerIds,
          selectedRotoPathIds,
        );
        const localPoints = simplified.map((point) =>
          projectScenePointToRotoLayerLocal(rotoNode, parentLayerId, currentFrame, point),
        );
        const keyframedPoints = toFrameAnchoredPoints(localPoints, currentFrame);

        const newPath: RotoPath = {
          id: `path_${Date.now()}`,
          name: rotoRefinement.name,
          parentLayerId,
          shapeType: RotoShapeType.BSPLINE,
          points: keyframedPoints,
          trackPoints: undefined,
          closed: rotoRefinement.closed,
          feather: 0,
          opacity: 100,
          blend: RotoPathBlend.ADD,
          style: { mode: RotoDrawMode.FILL, strokeWidth: 2 },
          originalPoints: rotoRefinement.originalPoints,
          epsilon: rotoRefinement.epsilon,
        };

        const updatedRoto = {
          ...rotoNode,
          ...prependRotoPath(rotoNode, newPath),
        } as RotoNode;
        const newNodes = [...nodes];
        newNodes[rotoIndex] = updatedRoto;
        set(() => ({
          nodes: newNodes,
          selectedRotoLayerIds: [],
          selectedRotoPathIds: [newPath.id],
          rotoRefinement: null,
        }));
        deps.pushHistory({
          label: `Commit Shape: ${rotoRefinement.name}`,
          state: { nodes: newNodes, selectedNodeId },
        });
      }
    },

    deleteSelectedRotoPoints: () => {
      const { nodes, selectedNodeId, selectedRotoPointRefs } = get();
      if (!selectedNodeId || selectedRotoPointRefs.length === 0) return;

      const rotoIndex = nodes.findIndex((l) => l.id === selectedNodeId);
      if (rotoIndex === -1 || nodes[rotoIndex].type !== NodeType.ROTO) return;

      const node = nodes[rotoIndex] as RotoNode;
      const selectedPointIndicesByPath = selectedRotoPointRefs.reduce((acc, pointRef) => {
        const indices = acc.get(pointRef.pathId) ?? [];
        if (!indices.includes(pointRef.pointIndex)) {
          indices.push(pointRef.pointIndex);
        }
        acc.set(pointRef.pathId, indices);
        return acc;
      }, new Map<string, number[]>());

      const shouldAbort = Array.from(selectedPointIndicesByPath.entries()).some(
        ([pathId, pointIndices]) => {
          const path = node.paths.find((candidate) => candidate.id === pathId);
          if (!path) return true;
          const minPoints = path.closed ? 3 : 2;
          return path.points.length - pointIndices.length < minPoints;
        },
      );
      if (shouldAbort) return;

      const newPaths = node.paths.map((path) => {
        const pointIndices = selectedPointIndicesByPath.get(path.id);
        if (!pointIndices || pointIndices.length === 0) return path;

        const newPoints = path.points.filter((_, i) => !pointIndices.includes(i));
        let newTrackPoints = path.trackPoints;
        if (newTrackPoints) {
          newTrackPoints = newTrackPoints.filter((_, i) => !pointIndices.includes(i));
        }

        return {
          ...path,
          points: newPoints,
          pointWeightModes: removeRotoPointWeightModes(
            path.pointWeightModes,
            path.points.length,
            pointIndices,
          ),
          pointTypes: removeRotoPointTypes(path.pointTypes, path.points.length, pointIndices),
          pointWeights: removeRotoPointWeights(path.pointWeights, path.points.length, pointIndices),
          trackPoints: newTrackPoints,
        };
      });

      const newNodes = [...nodes];
      newNodes[rotoIndex] = { ...node, paths: newPaths };

      set(() => ({
        nodes: newNodes,
        selectedRotoPointRefs: [],
      }));
      deps.pushHistory({
        label:
          selectedPointIndicesByPath.size === 1
            ? `Delete Points from ${
                node.paths.find((path) => selectedPointIndicesByPath.has(path.id))?.name ?? 'Shape'
              }`
            : `Delete Points from ${selectedPointIndicesByPath.size} Shapes`,
        state: { nodes: newNodes, selectedNodeId },
      });
    },

    deleteSelectedRotoShapes: () => {
      const { nodes, selectedNodeId, selectedRotoPathIds } = get();
      if (!selectedNodeId || selectedRotoPathIds.length === 0) return;

      const rotoIndex = nodes.findIndex((l) => l.id === selectedNodeId);
      if (rotoIndex === -1 || nodes[rotoIndex].type !== NodeType.ROTO) return;

      const node = nodes[rotoIndex] as RotoNode;
      const selectedPathIdSet = new Set(selectedRotoPathIds);
      const deletedPaths = node.paths.filter((path) => selectedPathIdSet.has(path.id));
      if (deletedPaths.length === 0) return;

      const newPaths = node.paths.filter((path) => !selectedPathIdSet.has(path.id));
      const newNodes = [...nodes];
      newNodes[rotoIndex] = { ...node, paths: newPaths };

      const label =
        deletedPaths.length === 1
          ? `Delete Shape: ${deletedPaths[0].name}`
          : `Delete ${deletedPaths.length} Shapes`;

      set(() => ({
        nodes: newNodes,
        selectedRotoPathIds: [],
        selectedRotoPointRefs: [],
      }));
      deps.pushHistory({
        label,
        state: { nodes: newNodes, selectedNodeId },
      });
    },

    addRotoPointToPath: (pathId: string, insertIndex: number, point: { x: number; y: number }) => {
      const { nodes, selectedNodeId, currentFrame } = get();
      if (!selectedNodeId) return;

      const rotoIndex = nodes.findIndex((l) => l.id === selectedNodeId);
      if (rotoIndex === -1 || nodes[rotoIndex].type !== NodeType.ROTO) return;

      const node = nodes[rotoIndex] as RotoNode;
      const pathIndex = node.paths.findIndex((p) => p.id === pathId);
      if (pathIndex === -1) return;

      const path = node.paths[pathIndex];
      const oldPoints = path.points;
      const len = oldPoints.length;

      let t = 0.5;
      const prevIdx = (insertIndex - 1 + len) % len;
      const nextIdx = insertIndex % len;

      const resolvedOld = resolveRotoPathPointsAtFrame(node, path, currentFrame);
      const prevPos = resolvedOld[prevIdx];
      const nextPos = resolvedOld[nextIdx];

      const segX = nextPos.x - prevPos.x;
      const segY = nextPos.y - prevPos.y;
      const segLenSq = segX * segX + segY * segY;

      if (segLenSq > 0.001) {
        t = ((point.x - prevPos.x) * segX + (point.y - prevPos.y) * segY) / segLenSq;
        t = Math.max(0, Math.min(1, t));
      }

      const newTrackPoints = path.trackPoints ? [...path.trackPoints] : undefined;
      if (newTrackPoints) {
        const keyframeSet = new Set<number>();
        newTrackPoints.forEach((p) => {
          if (Array.isArray(p.x)) p.x.forEach((k) => keyframeSet.add(k.frame));
          if (Array.isArray(p.y)) p.y.forEach((k) => keyframeSet.add(k.frame));
        });
        keyframeSet.add(currentFrame);
        const uniqueFrames = Array.from(keyframeSet).sort((a, b) => a - b);

        const newTrackXKeys: Keyframe[] = [];
        const newTrackYKeys: Keyframe[] = [];

        uniqueFrames.forEach((f) => {
          const tpPrev = {
            x: getLinearValueAtFrame(newTrackPoints![prevIdx].x, f),
            y: getLinearValueAtFrame(newTrackPoints![prevIdx].y, f),
          };
          const tpNext = {
            x: getLinearValueAtFrame(newTrackPoints![nextIdx].x, f),
            y: getLinearValueAtFrame(newTrackPoints![nextIdx].y, f),
          };
          newTrackXKeys.push({
            frame: f,
            value: tpPrev.x + (tpNext.x - tpPrev.x) * t,
          });
          newTrackYKeys.push({
            frame: f,
            value: tpPrev.y + (tpNext.y - tpPrev.y) * t,
          });
        });

        const newTrackPointObj = toAnimatablePointFromKeyframes(newTrackXKeys, newTrackYKeys);

        newTrackPoints.splice(insertIndex, 0, newTrackPointObj);
      }

      const keyframeSet = new Set<number>();
      oldPoints.forEach((p) => {
        if (Array.isArray(p.x)) p.x.forEach((k) => keyframeSet.add(k.frame));
        if (Array.isArray(p.y)) p.y.forEach((k) => keyframeSet.add(k.frame));
      });
      keyframeSet.add(currentFrame);
      const uniqueFrames = Array.from(keyframeSet).sort((a, b) => a - b);

      const newPointXKeyframes: Keyframe[] = [];
      const newPointYKeyframes: Keyframe[] = [];

      uniqueFrames.forEach((f) => {
        const fPrevPos = {
          x: getLinearValueAtFrame(oldPoints[prevIdx].x, f),
          y: getLinearValueAtFrame(oldPoints[prevIdx].y, f),
        };
        const fNextPos = {
          x: getLinearValueAtFrame(oldPoints[nextIdx].x, f),
          y: getLinearValueAtFrame(oldPoints[nextIdx].y, f),
        };

        if (f === currentFrame) {
          const trackX = newTrackPoints
            ? getLinearValueAtFrame(newTrackPoints[insertIndex].x, f)
            : 0;
          const trackY = newTrackPoints
            ? getLinearValueAtFrame(newTrackPoints[insertIndex].y, f)
            : 0;
          const projectedPoint = projectScenePointToRotoPathBasePoint(
            node,
            path,
            f,
            insertIndex,
            point,
            { x: trackX, y: trackY },
          );
          newPointXKeyframes.push({ frame: f, value: projectedPoint.x });
          newPointYKeyframes.push({ frame: f, value: projectedPoint.y });
        } else {
          newPointXKeyframes.push({
            frame: f,
            value: fPrevPos.x + (fNextPos.x - fPrevPos.x) * t,
          });
          newPointYKeyframes.push({
            frame: f,
            value: fPrevPos.y + (fNextPos.y - fPrevPos.y) * t,
          });
        }
      });

      const newPoints = [...oldPoints];
      const newPointObj = toAnimatablePointFromKeyframes(newPointXKeyframes, newPointYKeyframes);

      newPoints.splice(insertIndex, 0, newPointObj);
      const newPointWeights = insertRotoPointWeight(
        path.pointWeights,
        path.points.length,
        insertIndex,
        prevIdx,
        nextIdx,
      );
      const newPointWeightModes = insertRotoPointWeightMode(
        path.pointWeightModes,
        path.points.length,
        insertIndex,
        prevIdx,
        nextIdx,
      );
      const newPointTypes = insertRotoPointType(
        path.pointTypes,
        path.points.length,
        insertIndex,
        prevIdx,
        nextIdx,
      );

      const newPaths = [...node.paths];
      newPaths[pathIndex] = {
        ...path,
        points: newPoints,
        pointWeightModes: newPointWeightModes,
        pointTypes: newPointTypes,
        pointWeights: newPointWeights,
        trackPoints: newTrackPoints,
      };

      const newNodes = [...nodes];
      newNodes[rotoIndex] = { ...node, paths: newPaths };

      set(() => ({
        nodes: newNodes,
        selectedRotoPointRefs: [{ pathId: path.id, pointIndex: insertIndex }],
      }));
      deps.pushHistory({
        label: `Add Point to ${path.name}`,
        state: { nodes: newNodes, selectedNodeId },
      });
    },
  };

  return rotoActions;
}
