import {
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
import { collectAnimatablePointFrames } from '@/utils/animatablePointFrames';
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
import { getHierarchySelection } from '@/state/editor/slices/selectionActions';
import type { EditorState, GetState, SetState } from '@/state/editor/slices/types';
import type { CommitEditorMutation } from '@/state/editor/commitMutation';

// Helpers
// -------

function createRotoPathId(): string {
  return `path_${crypto.randomUUID()}`;
}

// Interface
// ---------

interface RotoDrawingActionDeps {
  commitMutation: CommitEditorMutation<EditorState>;
}

// Slice
// -----

export function createRotoDrawingActions(
  set: SetState,
  get: GetState,
  deps: RotoDrawingActionDeps,
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
      const { nodes, selectedNodeId, drawingRotoPath, currentFrame, hierarchySelections } = get();
      if (!drawingRotoPath || !selectedNodeId) return;

      const layerIndex = nodes.findIndex((node) => node.id === selectedNodeId);
      if (layerIndex === -1 || nodes[layerIndex].type !== NodeType.ROTO) return;

      const rawPoints = resolveAnimatablePoints(drawingRotoPath.points, currentFrame);
      const keyframedPoints = toFrameAnchoredPoints(rawPoints, currentFrame);

      const pathId = drawingRotoPath.id.startsWith('path_drawing_')
        ? createRotoPathId()
        : drawingRotoPath.id;
      const finalPath: RotoPath = {
        ...drawingRotoPath,
        ...finalUpdates,
        id: pathId,
        points: keyframedPoints,
      };

      const newNode = {
        ...nodes[layerIndex],
        ...prependRotoPath(nodes[layerIndex] as RotoNode, finalPath),
      } as RotoNode;

      const newNodes = [...nodes];
      newNodes[layerIndex] = newNode;

      const nextHierarchySelections = {
        ...hierarchySelections,
        [selectedNodeId]: { layerIds: [], itemIds: [finalPath.id] },
      };

      deps.commitMutation({
        patch: {
          nodes: newNodes,
          hierarchySelections: nextHierarchySelections,
          isDrawing: false,
          drawingRotoPath: null,
          drawingSubHistory: [],
          drawingSubHistoryIndex: -1,
          activeViewportTool: 'select',
        },
        history: {
          label: 'Draw Shape',
          state: { nodes: newNodes, selectedNodeId },
        },
        persist: 'debounced',
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
      const rotoNode = nodes.find((node) => node.id === rotoNodeId) as RotoNode | undefined;
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

      const largestContour = rawContours.reduce((largest, contour) =>
        contour.length > largest.length ? contour : largest,
      );
      const halfW = pixelData.width / 2;
      const halfH = pixelData.height / 2;
      const scenePoints = largestContour.map((point) => ({
        x: point.x - halfW,
        y: point.y - halfH,
      }));
      const sourceLabel =
        getMediaSourceLabel(nodes, rotoNodeId, sourceId) ??
        (source.kind === 'media-node' ? source.node.name : 'Upstream Result');

      rotoActions.startRotoRefinement({
        name: `Trace ${sourceLabel}`,
        originalPoints: scenePoints,
        epsilon: 2.0,
        closed: true,
        targetPathId,
      });
    },

    startRotoRefinement: (refinement: RotoRefinement) =>
      set(() => ({ rotoRefinement: refinement })),
    updateRotoRefinement: (updates: Partial<RotoRefinement>) =>
      set((state) => ({
        rotoRefinement: state.rotoRefinement ? { ...state.rotoRefinement, ...updates } : null,
      })),
    cancelRotoRefinement: () => set(() => ({ rotoRefinement: null })),

    commitRotoRefinement: () => {
      const { nodes, selectedNodeId, hierarchySelections, rotoRefinement, currentFrame } = get();
      const sel = getHierarchySelection(hierarchySelections, selectedNodeId);
      const selectedRotoLayerIds = sel.layerIds;
      const selectedRotoPathIds = sel.itemIds;
      if (!rotoRefinement || !selectedNodeId) return;

      const rotoIndex = nodes.findIndex((node) => node.id === selectedNodeId);
      if (rotoIndex === -1) return;
      const rotoNode = nodes[rotoIndex] as RotoNode;

      if (rotoRefinement.targetPathId) {
        const pathIndex = rotoNode.paths.findIndex(
          (path) => path.id === rotoRefinement.targetPathId,
        );
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

          const updatedPoints = existingPath.points.map((point, index) => {
            const newPos = mappedPoints[index] ?? existingResolved[index];
            const projectedPoint = projectScenePointToRotoPathBasePoint(
              rotoNode,
              existingPath,
              currentFrame,
              index,
              newPos,
            );

            return {
              x: setKeyframeOnValue(point.x, currentFrame, projectedPoint.x),
              y: setKeyframeOnValue(point.y, currentFrame, projectedPoint.y),
            };
          });
          const updatedPath = { ...existingPath, points: updatedPoints };
          const newPaths = [...rotoNode.paths];
          newPaths[pathIndex] = updatedPath;

          const newNodes = [...nodes];
          newNodes[rotoIndex] = { ...rotoNode, paths: newPaths };

          deps.commitMutation({
            patch: { nodes: newNodes, rotoRefinement: null },
            history: {
              label: `Keyframe Shape via Trace: ${existingPath.name}`,
              state: { nodes: newNodes, selectedNodeId },
            },
            persist: 'debounced',
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
          id: createRotoPathId(),
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

        const nextHierarchySelections = {
          ...hierarchySelections,
          [selectedNodeId]: { layerIds: [], itemIds: [newPath.id] },
        };

        deps.commitMutation({
          patch: {
            nodes: newNodes,
            rotoRefinement: null,
            hierarchySelections: nextHierarchySelections,
          },
          history: {
            label: `Commit Shape: ${rotoRefinement.name}`,
            state: { nodes: newNodes, selectedNodeId },
          },
          persist: 'debounced',
        });
      }
    },

    deleteSelectedRotoPoints: () => {
      const { nodes, selectedNodeId, selectedRotoPointRefs } = get();
      if (!selectedNodeId || selectedRotoPointRefs.length === 0) return;

      const rotoIndex = nodes.findIndex((node) => node.id === selectedNodeId);
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

      deps.commitMutation({
        patch: { nodes: newNodes, selectedRotoPointRefs: [] },
        history: {
          label:
            selectedPointIndicesByPath.size === 1
              ? `Delete Points from ${
                  node.paths.find((path) => selectedPointIndicesByPath.has(path.id))?.name ??
                  'Shape'
                }`
              : `Delete Points from ${selectedPointIndicesByPath.size} Shapes`,
          state: { nodes: newNodes, selectedNodeId },
        },
        persist: 'debounced',
      });
    },

    deleteSelectedRotoShapes: () => {
      const { nodes, selectedNodeId, hierarchySelections } = get();
      const selectedRotoPathIds = getHierarchySelection(
        hierarchySelections,
        selectedNodeId,
      ).itemIds;
      if (!selectedNodeId || selectedRotoPathIds.length === 0) return;

      const rotoIndex = nodes.findIndex((node) => node.id === selectedNodeId);
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

      const nextHierarchySelections = {
        ...hierarchySelections,
        [selectedNodeId]: { layerIds: [], itemIds: [] },
      };

      deps.commitMutation({
        patch: {
          nodes: newNodes,
          selectedRotoPointRefs: [],
          hierarchySelections: nextHierarchySelections,
        },
        history: { label, state: { nodes: newNodes, selectedNodeId } },
        persist: 'debounced',
      });
    },

    addRotoPointToPath: (
      pathId: string,
      insertIndex: number,
      scenePoint: { x: number; y: number },
    ) => {
      const { nodes, selectedNodeId, currentFrame } = get();
      if (!selectedNodeId) return;

      const rotoIndex = nodes.findIndex((node) => node.id === selectedNodeId);
      if (rotoIndex === -1 || nodes[rotoIndex].type !== NodeType.ROTO) return;

      const node = nodes[rotoIndex] as RotoNode;
      const pathIndex = node.paths.findIndex((path) => path.id === pathId);
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
        t = ((scenePoint.x - prevPos.x) * segX + (scenePoint.y - prevPos.y) * segY) / segLenSq;
        t = Math.max(0, Math.min(1, t));
      }

      const newTrackPoints = path.trackPoints ? [...path.trackPoints] : undefined;
      if (newTrackPoints) {
        const trackPoints = newTrackPoints;
        const frames = collectAnimatablePointFrames(trackPoints, [currentFrame]);

        const newTrackXKeys: Keyframe[] = [];
        const newTrackYKeys: Keyframe[] = [];

        frames.forEach((frame) => {
          const tpPrev = {
            x: getLinearValueAtFrame(trackPoints[prevIdx].x, frame),
            y: getLinearValueAtFrame(trackPoints[prevIdx].y, frame),
          };
          const tpNext = {
            x: getLinearValueAtFrame(trackPoints[nextIdx].x, frame),
            y: getLinearValueAtFrame(trackPoints[nextIdx].y, frame),
          };
          newTrackXKeys.push({
            frame,
            value: tpPrev.x + (tpNext.x - tpPrev.x) * t,
          });
          newTrackYKeys.push({
            frame,
            value: tpPrev.y + (tpNext.y - tpPrev.y) * t,
          });
        });

        const newTrackPointObj = toAnimatablePointFromKeyframes(newTrackXKeys, newTrackYKeys);

        newTrackPoints.splice(insertIndex, 0, newTrackPointObj);
      }

      const frames = collectAnimatablePointFrames(oldPoints, [currentFrame]);

      const newPointXKeyframes: Keyframe[] = [];
      const newPointYKeyframes: Keyframe[] = [];

      frames.forEach((frame) => {
        const fPrevPos = {
          x: getLinearValueAtFrame(oldPoints[prevIdx].x, frame),
          y: getLinearValueAtFrame(oldPoints[prevIdx].y, frame),
        };
        const fNextPos = {
          x: getLinearValueAtFrame(oldPoints[nextIdx].x, frame),
          y: getLinearValueAtFrame(oldPoints[nextIdx].y, frame),
        };

        if (frame === currentFrame) {
          const trackX = newTrackPoints
            ? getLinearValueAtFrame(newTrackPoints[insertIndex].x, frame)
            : 0;
          const trackY = newTrackPoints
            ? getLinearValueAtFrame(newTrackPoints[insertIndex].y, frame)
            : 0;
          const projectedPoint = projectScenePointToRotoPathBasePoint(
            node,
            path,
            frame,
            insertIndex,
            scenePoint,
            { x: trackX, y: trackY },
          );
          newPointXKeyframes.push({ frame, value: projectedPoint.x });
          newPointYKeyframes.push({ frame, value: projectedPoint.y });
        } else {
          newPointXKeyframes.push({
            frame,
            value: fPrevPos.x + (fNextPos.x - fPrevPos.x) * t,
          });
          newPointYKeyframes.push({
            frame,
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

      deps.commitMutation({
        patch: {
          nodes: newNodes,
          selectedRotoPointRefs: [{ pathId: path.id, pointIndex: insertIndex }],
        },
        history: {
          label: `Add Point to ${path.name}`,
          state: { nodes: newNodes, selectedNodeId },
        },
        persist: 'debounced',
      });
    },
  };

  return rotoActions;
}
