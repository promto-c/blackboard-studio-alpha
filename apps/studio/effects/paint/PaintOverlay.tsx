import React, { useMemo, useState } from 'react';
import type { PaintNode, PaintStrokePathsMode, Point } from '@blackboard/types';
import { generateBSplinePath } from '@/utils/bspline';
import {
  isPaintStrokeVisible,
  isPaintStrokeActiveAtFrame,
  getPaintStrokeParentLayerId,
} from './paintLayers';
import type { PaintNudgeDragState, PaintNudgePreviewPoint } from './usePaintInteraction';
import { stabilizePoint, stabilizePoints } from '@/utils/rotoTracking';

interface PaintOverlayProps {
  node: PaintNode;
  brushSize: number;
  zoom: number;
  activeTool: string | null;
  cursorScenePos: Point | null;
  strokePoints: Point[] | null;
  cloneSourcePreviewPos?: Point | null;
  isSettingCloneSource?: boolean;
  isAdjustingBrushSize?: boolean;
  brushAdjustCenter?: Point | null;
  brushAdjustInitialSize?: number | null;
  cursorOnly?: boolean;
  showStrokePaths?: boolean;
  strokePathsMode?: PaintStrokePathsMode;
  selectedPaintLayerIds?: string[];
  selectedPaintStrokeIds?: string[];
  onStrokeSelect?: (strokeId: string, shiftKey: boolean) => void;
  frame?: number;
  // Nudge overlay props
  nudgeRadius?: number;
  nudgeDragState?: PaintNudgeDragState | null;
  nudgePreviewPoints?: PaintNudgePreviewPoint[];
  isAdjustingNudgeRadius?: boolean;
  nudgeRadiusAdjustCenter?: Point | null;
  nudgeRadiusAdjustInitialRadius?: number | null;
  mouseScenePos?: Point | null;
  stabilizationMatrix?: number[][] | null;
}

const STROKE_PATH_COLORS: Record<string, string> = {
  brush: 'rgba(255, 255, 255, 0.6)',
  erase: 'rgba(248, 113, 113, 0.6)',
  clone: 'rgba(56, 189, 248, 0.6)',
};

const buildSvgPathData = (
  path: { mode: string; points: Point[] } | null | undefined,
): string | null => {
  if (!path || path.points.length === 0) return null;

  if (path.mode === 'bspline' && path.points.length >= 3) {
    return generateBSplinePath(path.points, false);
  }

  const [first, ...rest] = path.points;
  return `M ${first.x},${first.y}${rest.map((p) => ` L ${p.x},${p.y}`).join('')}`;
};

const PaintOverlay: React.FC<PaintOverlayProps> = ({
  node,
  brushSize,
  zoom,
  activeTool,
  cursorScenePos,
  strokePoints: _strokePoints,
  cloneSourcePreviewPos = null,
  isSettingCloneSource = false,
  isAdjustingBrushSize = false,
  brushAdjustCenter = null,
  brushAdjustInitialSize = null,
  cursorOnly = false,
  showStrokePaths = false,
  strokePathsMode = 'all',
  selectedPaintLayerIds = [],
  selectedPaintStrokeIds = [],
  onStrokeSelect,
  frame = 0,
  nudgeRadius = 50,
  nudgeDragState = null,
  nudgePreviewPoints = [],
  isAdjustingNudgeRadius = false,
  nudgeRadiusAdjustCenter = null,
  nudgeRadiusAdjustInitialRadius = null,
  mouseScenePos = null,
  stabilizationMatrix = null,
}) => {
  const sp = (p: { x: number; y: number }) => stabilizePoint(p, stabilizationMatrix);
  const brushRadius = Math.max(0.5, brushSize / 2);
  const displayCenter = isAdjustingBrushSize ? brushAdjustCenter : cursorScenePos;
  const sDisplayCenter = displayCenter ? sp(displayCenter) : null;
  const cloneSourceStroke = isSettingCloneSource
    ? 'rgba(56, 189, 248, 0.95)'
    : 'rgba(56, 189, 248, 0.85)';
  const cloneSourceCrosshairRadius = Math.max(4 / zoom, Math.min(brushRadius * 0.33, 12 / zoom));
  const isPaintSelectActive = activeTool === 'select';
  const isNudgeActive = activeTool === 'nudge';

  const [hoveredStrokeId, setHoveredStrokeId] = useState<string | null>(null);

  const selectedStrokeIdSet = useMemo(
    () => new Set(selectedPaintStrokeIds),
    [selectedPaintStrokeIds],
  );

  const visibleStrokePaths = useMemo(() => {
    const shouldShowPaths = showStrokePaths || isPaintSelectActive || isNudgeActive;
    if (!shouldShowPaths || cursorOnly) return [];

    const selectedLayerIdSet =
      strokePathsMode === 'selected_layer' && !isPaintSelectActive && !isNudgeActive
        ? new Set(selectedPaintLayerIds)
        : null;

    return node.strokes
      .filter((stroke) => {
        if (!stroke.path || stroke.path.points.length === 0) return false;
        if (!isPaintStrokeVisible(node, stroke)) return false;
        if (!isPaintStrokeActiveAtFrame(node, stroke, frame)) return false;

        if (selectedLayerIdSet) {
          const parentLayerId = getPaintStrokeParentLayerId(node, stroke);
          if (!parentLayerId || !selectedLayerIdSet.has(parentLayerId)) return false;
        }

        return true;
      })
      .map((stroke) => ({
        id: stroke.id,
        d: buildSvgPathData(
          stroke.path
            ? {
                mode: stroke.path.mode,
                points: stabilizePoints(stroke.path.points, stabilizationMatrix),
              }
            : null,
        ),
        color: STROKE_PATH_COLORS[stroke.tool] ?? STROKE_PATH_COLORS.brush,
        size: stroke.size,
      }))
      .filter(
        (entry): entry is { id: string; d: string; color: string; size: number } =>
          entry.d !== null,
      );
  }, [
    showStrokePaths,
    isPaintSelectActive,
    isNudgeActive,
    cursorOnly,
    node,
    frame,
    strokePathsMode,
    selectedPaintLayerIds,
    stabilizationMatrix,
  ]);

  // Nudge overlay position
  const nudgeDisplayCenter = isAdjustingNudgeRadius ? nudgeRadiusAdjustCenter : mouseScenePos;
  const sNudgeDisplayCenter = nudgeDisplayCenter ? sp(nudgeDisplayCenter) : null;
  const sCloneSourcePreviewPos = cloneSourcePreviewPos ? sp(cloneSourcePreviewPos) : null;

  return (
    <>
      {/* Stroke paths */}
      {visibleStrokePaths.length > 0 && (
        <g pointerEvents={isPaintSelectActive ? 'stroke' : 'none'}>
          {visibleStrokePaths.map((entry) => {
            const isSelected = selectedStrokeIdSet.has(entry.id);
            const isHovered = hoveredStrokeId === entry.id;
            return (
              <g key={entry.id}>
                {/* Fat invisible hit-test stroke for select tool */}
                {isPaintSelectActive && (
                  <path
                    d={entry.d}
                    stroke="transparent"
                    strokeWidth={Math.max(10, entry.size) / zoom}
                    fill="none"
                    style={{ cursor: 'pointer' }}
                    pointerEvents="stroke"
                    onMouseDown={(e) => {
                      if (e.button !== 0) return;
                      e.stopPropagation();
                      onStrokeSelect?.(entry.id, e.shiftKey);
                    }}
                    onMouseEnter={() => setHoveredStrokeId(entry.id)}
                    onMouseLeave={() => setHoveredStrokeId(null)}
                  />
                )}
                {/* Visible stroke */}
                <path
                  d={entry.d}
                  stroke={
                    isSelected
                      ? 'rgba(250, 204, 21, 0.95)'
                      : isHovered
                        ? 'rgba(255, 255, 255, 0.9)'
                        : entry.color
                  }
                  strokeWidth={(isSelected || isHovered ? 2 : 1.25) / zoom}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                  pointerEvents="none"
                />
              </g>
            );
          })}
        </g>
      )}

      {/* Nudge overlay */}
      {isNudgeActive && sNudgeDisplayCenter && (
        <g pointerEvents="none">
          {/* Nudge radius circle */}
          <circle
            cx={sNudgeDisplayCenter.x}
            cy={sNudgeDisplayCenter.y}
            r={nudgeRadius / zoom}
            fill="none"
            stroke={
              isAdjustingNudgeRadius
                ? 'rgba(250, 204, 21, 0.8)'
                : nudgeDragState
                  ? 'rgba(255, 255, 255, 0.5)'
                  : 'rgba(255, 255, 255, 0.35)'
            }
            strokeWidth={(isAdjustingNudgeRadius ? 1.5 : 1) / zoom}
          />
          {/* Ghost radius during adjustment */}
          {isAdjustingNudgeRadius && nudgeRadiusAdjustInitialRadius != null && (
            <circle
              cx={sNudgeDisplayCenter.x}
              cy={sNudgeDisplayCenter.y}
              r={nudgeRadiusAdjustInitialRadius / zoom}
              fill="none"
              stroke="rgba(255, 255, 255, 0.25)"
              strokeWidth={1 / zoom}
              strokeDasharray={`${4 / zoom} ${4 / zoom}`}
            />
          )}
          {/* Center dot */}
          <circle
            cx={sNudgeDisplayCenter.x}
            cy={sNudgeDisplayCenter.y}
            r={2 / zoom}
            fill={isAdjustingNudgeRadius ? 'rgba(250, 204, 21, 0.9)' : 'rgba(255, 255, 255, 0.6)'}
          />
          {/* Preview points */}
          {!nudgeDragState &&
            nudgePreviewPoints.map((pp, i) => {
              const sPp = sp(pp.point);
              return (
                <circle
                  key={i}
                  cx={sPp.x}
                  cy={sPp.y}
                  r={Math.max(2, 4 * pp.weight) / zoom}
                  fill={`rgba(250, 204, 21, ${(0.3 + 0.7 * pp.weight).toFixed(2)})`}
                  stroke="rgba(250, 204, 21, 0.5)"
                  strokeWidth={0.5 / zoom}
                />
              );
            })}
        </g>
      )}

      {/* Clone placement line */}
      {activeTool === 'clone' &&
      isSettingCloneSource &&
      sCloneSourcePreviewPos &&
      sDisplayCenter ? (
        <line
          x1={sCloneSourcePreviewPos.x}
          y1={sCloneSourcePreviewPos.y}
          x2={sDisplayCenter.x}
          y2={sDisplayCenter.y}
          stroke="rgba(56, 189, 248, 0.65)"
          strokeWidth={1 / zoom}
          strokeDasharray={`${6 / zoom} ${4 / zoom}`}
        />
      ) : null}

      {/* Clone source crosshair */}
      {activeTool === 'clone' && sCloneSourcePreviewPos ? (
        <g transform={`translate(${sCloneSourcePreviewPos.x}, ${sCloneSourcePreviewPos.y})`}>
          <circle
            r={brushRadius}
            fill="none"
            stroke={cloneSourceStroke}
            strokeWidth={1.25 / zoom}
            strokeDasharray={`${6 / zoom} ${4 / zoom}`}
          />
          <line
            x1={-cloneSourceCrosshairRadius}
            y1={0}
            x2={cloneSourceCrosshairRadius}
            y2={0}
            stroke={cloneSourceStroke}
            strokeWidth={1 / zoom}
          />
          <line
            x1={0}
            y1={-cloneSourceCrosshairRadius}
            x2={0}
            y2={cloneSourceCrosshairRadius}
            stroke={cloneSourceStroke}
            strokeWidth={1 / zoom}
          />
          <circle r={2 / zoom} fill={cloneSourceStroke} />
        </g>
      ) : null}

      {/* Brush cursor (only for paint tools, not select/nudge) */}
      {activeTool !== 'select' && activeTool !== 'nudge' && sDisplayCenter ? (
        <g transform={`translate(${sDisplayCenter.x}, ${sDisplayCenter.y})`}>
          <circle
            r={brushRadius}
            fill="none"
            stroke={
              isAdjustingBrushSize
                ? 'rgba(250, 204, 21, 0.9)'
                : activeTool === 'erase'
                  ? 'rgba(248, 113, 113, 0.95)'
                  : 'rgba(255,255,255,0.95)'
            }
            strokeWidth={isAdjustingBrushSize ? 1.5 / zoom : 1.25 / zoom}
            strokeDasharray={activeTool === 'clone' ? `${6 / zoom} ${4 / zoom}` : undefined}
          />
          {isAdjustingBrushSize && brushAdjustInitialSize != null ? (
            <>
              <circle
                r={Math.max(0.5, brushAdjustInitialSize / 2)}
                fill="none"
                stroke="rgba(255, 255, 255, 0.35)"
                strokeWidth={1 / zoom}
                strokeDasharray={`${4 / zoom} ${4 / zoom}`}
              />
              <circle r={2 / zoom} fill="rgba(250, 204, 21, 0.9)" />
            </>
          ) : null}
        </g>
      ) : null}
    </>
  );
};

export default PaintOverlay;
