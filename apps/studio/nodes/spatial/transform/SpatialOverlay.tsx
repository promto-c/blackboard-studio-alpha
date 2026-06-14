import React, { useMemo } from 'react';
import type { TransformNode } from '@blackboard/types';
import { getValueAtFrame } from '@blackboard/renderer';
import { stabilizePoint } from '@/utils/rotoTracking';
import type { SpatialDragHandle } from './useSpatialInteraction';
import { ecc } from '@/features/viewport/overlays';
import type { ViewportOverlayProps } from '@/nodes/NodeDefinition';

const ROTATE_OFFSET = 28;
const PIVOT_SIZE = 7;

interface Vec2 {
  x: number;
  y: number;
}

interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
}

type SpatialControls = {
  hoveredHandle: SpatialDragHandle | null;
  dragState: { handle: SpatialDragHandle } | null;
  handleSvgMouseDown: (e: React.MouseEvent, handle: SpatialDragHandle) => void;
  setHoveredHandle: (h: SpatialDragHandle | null) => void;
};

const rotatePoint = (x: number, y: number, cos: number, sin: number): Vec2 => ({
  x: cos * x - sin * y,
  y: sin * x + cos * y,
});

const getTransformedCorners = (
  sceneW: number,
  sceneH: number,
  sourceRect: { x: number; y: number; width: number; height: number } | null | undefined,
  v: {
    translateX: number;
    translateY: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
    pivotX: number;
    pivotY: number;
  },
): Vec2[] => {
  const hw = sceneW / 2;
  const hh = sceneH / 2;
  const rad = (v.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const left = (sourceRect?.x ?? 0) - hw;
  const right = (sourceRect ? sourceRect.x + sourceRect.width : sceneW) - hw;
  const top = (sourceRect?.y ?? 0) - hh;
  const bottom = (sourceRect ? sourceRect.y + sourceRect.height : sceneH) - hh;
  const src: Vec2[] = [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
  return src.map((c) => {
    const sx = (c.x - v.pivotX) * v.scaleX;
    const sy = (c.y + v.pivotY) * v.scaleY;
    const r = rotatePoint(sx, sy, cos, sin);
    return {
      x: r.x + v.translateX + v.pivotX,
      y: r.y - v.translateY - v.pivotY,
    };
  });
};

const getAABB = (pts: Vec2[]): AABB => {
  let minX = Infinity,
    minY = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    w: maxX - minX,
    h: maxY - minY,
  };
};

function HandleHitArea({
  cx,
  cy,
  r,
  handle,
  hoveredHandle,
  dragState,
  onMouseDown,
  onHover,
  fill,
  activeFill,
  hoverFill,
  stroke,
  activeStroke,
}: {
  cx: number;
  cy: number;
  r: number;
  handle: SpatialDragHandle;
  hoveredHandle: SpatialDragHandle | null;
  dragState: { handle: SpatialDragHandle } | null;
  onMouseDown: (e: React.MouseEvent, handle: SpatialDragHandle) => void;
  onHover: (handle: SpatialDragHandle | null) => void;
  fill: string;
  activeFill: string;
  hoverFill: string;
  stroke: string;
  activeStroke: string;
}) {
  const isHovered = hoveredHandle === handle;
  const isActive = dragState?.handle === handle;
  return (
    <g
      className="pointer-events-auto cursor-grab active:cursor-grabbing"
      onMouseDown={(e) => onMouseDown(e, handle)}
      onMouseEnter={() => onHover(handle)}
      onMouseLeave={() => onHover(null)}
    >
      <circle cx={cx} cy={cy} r={r * 2.5} fill="transparent" />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill={isActive ? activeFill : isHovered ? hoverFill : fill}
        stroke={isActive || isHovered ? activeStroke : stroke}
        strokeWidth={1.5}
      />
    </g>
  );
}

function SpatialOverlay(props: ViewportOverlayProps) {
  const ctx = ecc(props);
  const viewport = ctx.viewport;
  const node = (ctx.selectedViewportNode ?? props.node) as TransformNode;
  const sceneWidth = props.scene.width;
  const sceneHeight = props.scene.height;
  const sourceRect = viewport.transformInputDataWindowRect as
    | { x: number; y: number; width: number; height: number }
    | null
    | undefined;
  const frame = props.frame;
  const stabilizationMatrix = viewport.stabilizationMatrix;

  const { aabb, pivotPos, sc } = useMemo(() => {
    const sp = (p: Vec2) => stabilizePoint(p, stabilizationMatrix);
    const transform = node.transform;
    const v = {
      translateX: getValueAtFrame(transform.translateX, frame),
      translateY: getValueAtFrame(transform.translateY, frame),
      scaleX: getValueAtFrame(transform.scaleX, frame),
      scaleY: getValueAtFrame(transform.scaleY, frame),
      rotation: getValueAtFrame(transform.rotation, frame),
      pivotX: getValueAtFrame(transform.pivotX, frame),
      pivotY: getValueAtFrame(transform.pivotY, frame),
    };
    const rawCorners = getTransformedCorners(sceneWidth, sceneHeight, sourceRect, v);
    const stabilizedCorners = rawCorners.map(sp);
    const stabilizedAABB = getAABB(stabilizedCorners);
    const p: Vec2 = { x: v.pivotX, y: -v.pivotY };
    return {
      aabb: stabilizedAABB,
      pivotPos: sp(p),
      sc: stabilizedCorners,
    };
  }, [node, sceneWidth, sceneHeight, sourceRect, frame, stabilizationMatrix]);
  if (!viewport.showOverlays) return null;
  const spatial = ctx.spatial as SpatialControls;
  const zoom = props.zoom;
  const hoveredHandle = spatial.hoveredHandle as SpatialDragHandle | null;
  const dragState = spatial.dragState as { handle: SpatialDragHandle } | null;
  const onHandleMouseDown = spatial.handleSvgMouseDown as (
    e: React.MouseEvent,
    handle: SpatialDragHandle,
  ) => void;
  const onHandleHover = spatial.setHoveredHandle as (handle: SpatialDragHandle | null) => void;

  const polyPoints = sc.map((p) => `${p.x},${p.y}`).join(' ');
  const aabbPoly = [
    { x: aabb.minX, y: aabb.minY },
    { x: aabb.maxX, y: aabb.minY },
    { x: aabb.maxX, y: aabb.maxY },
    { x: aabb.minX, y: aabb.maxY },
  ];
  const aabbPoints = aabbPoly.map((p) => `${p.x},${p.y}`).join(' ');
  const r = 6 / zoom;
  const cr = 5 / zoom;
  const er = 4 / zoom;
  const rotOff = ROTATE_OFFSET / zoom;
  const ps = PIVOT_SIZE / zoom;

  return (
    <>
      <polygon
        points={polyPoints}
        fill="rgba(56,189,248,0.06)"
        stroke="rgba(56,189,248,0.35)"
        strokeWidth={1 / zoom}
        strokeDasharray={`${4 / zoom} ${3 / zoom}`}
        pointerEvents="none"
      />

      <polygon
        points={aabbPoints}
        fill="none"
        stroke="rgba(251,191,36,0.5)"
        strokeWidth={1 / zoom}
        strokeDasharray={`${5 / zoom} ${3 / zoom}`}
        pointerEvents="none"
      />

      <HandleHitArea
        cx={aabb.minX}
        cy={aabb.minY}
        r={cr}
        handle="nw"
        hoveredHandle={hoveredHandle}
        dragState={dragState}
        onMouseDown={onHandleMouseDown}
        onHover={onHandleHover}
        fill="rgba(56,189,248,0.85)"
        activeFill="#fbbf24"
        hoverFill="#38bdf8"
        stroke="rgba(255,255,255,0.7)"
        activeStroke="white"
      />
      <HandleHitArea
        cx={aabb.maxX}
        cy={aabb.minY}
        r={cr}
        handle="ne"
        hoveredHandle={hoveredHandle}
        dragState={dragState}
        onMouseDown={onHandleMouseDown}
        onHover={onHandleHover}
        fill="rgba(56,189,248,0.85)"
        activeFill="#fbbf24"
        hoverFill="#38bdf8"
        stroke="rgba(255,255,255,0.7)"
        activeStroke="white"
      />
      <HandleHitArea
        cx={aabb.maxX}
        cy={aabb.maxY}
        r={cr}
        handle="se"
        hoveredHandle={hoveredHandle}
        dragState={dragState}
        onMouseDown={onHandleMouseDown}
        onHover={onHandleHover}
        fill="rgba(56,189,248,0.85)"
        activeFill="#fbbf24"
        hoverFill="#38bdf8"
        stroke="rgba(255,255,255,0.7)"
        activeStroke="white"
      />
      <HandleHitArea
        cx={aabb.minX}
        cy={aabb.maxY}
        r={cr}
        handle="sw"
        hoveredHandle={hoveredHandle}
        dragState={dragState}
        onMouseDown={onHandleMouseDown}
        onHover={onHandleHover}
        fill="rgba(56,189,248,0.85)"
        activeFill="#fbbf24"
        hoverFill="#38bdf8"
        stroke="rgba(255,255,255,0.7)"
        activeStroke="white"
      />

      <HandleHitArea
        cx={aabb.cx}
        cy={aabb.minY}
        r={er}
        handle="n"
        hoveredHandle={hoveredHandle}
        dragState={dragState}
        onMouseDown={onHandleMouseDown}
        onHover={onHandleHover}
        fill="rgba(56,189,248,0.85)"
        activeFill="#fbbf24"
        hoverFill="#38bdf8"
        stroke="rgba(255,255,255,0.7)"
        activeStroke="white"
      />
      <HandleHitArea
        cx={aabb.maxX}
        cy={aabb.cy}
        r={er}
        handle="e"
        hoveredHandle={hoveredHandle}
        dragState={dragState}
        onMouseDown={onHandleMouseDown}
        onHover={onHandleHover}
        fill="rgba(56,189,248,0.85)"
        activeFill="#fbbf24"
        hoverFill="#38bdf8"
        stroke="rgba(255,255,255,0.7)"
        activeStroke="white"
      />
      <HandleHitArea
        cx={aabb.cx}
        cy={aabb.maxY}
        r={er}
        handle="s"
        hoveredHandle={hoveredHandle}
        dragState={dragState}
        onMouseDown={onHandleMouseDown}
        onHover={onHandleHover}
        fill="rgba(56,189,248,0.85)"
        activeFill="#fbbf24"
        hoverFill="#38bdf8"
        stroke="rgba(255,255,255,0.7)"
        activeStroke="white"
      />
      <HandleHitArea
        cx={aabb.minX}
        cy={aabb.cy}
        r={er}
        handle="w"
        hoveredHandle={hoveredHandle}
        dragState={dragState}
        onMouseDown={onHandleMouseDown}
        onHover={onHandleHover}
        fill="rgba(56,189,248,0.85)"
        activeFill="#fbbf24"
        hoverFill="#38bdf8"
        stroke="rgba(255,255,255,0.7)"
        activeStroke="white"
      />

      <g
        className="pointer-events-auto cursor-grab active:cursor-grabbing"
        onMouseDown={(e) => onHandleMouseDown(e, 'rotate')}
        onMouseEnter={() => onHandleHover('rotate')}
        onMouseLeave={() => onHandleHover(null)}
      >
        <line
          x1={aabb.cx}
          y1={aabb.minY}
          x2={aabb.cx}
          y2={aabb.minY - rotOff}
          stroke="rgba(56,189,248,0.5)"
          strokeWidth={1.5 / zoom}
          pointerEvents="none"
        />
        <circle
          cx={aabb.cx}
          cy={aabb.minY - rotOff}
          r={r}
          fill={
            dragState?.handle === 'rotate'
              ? '#fbbf24'
              : hoveredHandle === 'rotate'
                ? '#38bdf8'
                : 'rgba(56,189,248,0.85)'
          }
          stroke={
            dragState?.handle === 'rotate' || hoveredHandle === 'rotate'
              ? 'white'
              : 'rgba(255,255,255,0.7)'
          }
          strokeWidth={1.5 / zoom}
        />
      </g>

      <g
        className="pointer-events-auto cursor-grab active:cursor-grabbing"
        onMouseDown={(e) => onHandleMouseDown(e, 'move')}
        onMouseEnter={() => onHandleHover('move')}
        onMouseLeave={() => onHandleHover(null)}
      >
        <circle cx={aabb.cx} cy={aabb.cy} r={r * 1.6} fill="transparent" />
        <circle
          cx={aabb.cx}
          cy={aabb.cy}
          r={r * 1.4}
          fill={
            dragState?.handle === 'move'
              ? 'rgba(251,191,36,0.3)'
              : hoveredHandle === 'move'
                ? 'rgba(56,189,248,0.3)'
                : 'rgba(56,189,248,0.15)'
          }
          stroke={
            dragState?.handle === 'move' || hoveredHandle === 'move'
              ? 'rgba(255,255,255,0.8)'
              : 'rgba(56,189,248,0.6)'
          }
          strokeWidth={1.5 / zoom}
        />
        <g pointerEvents="none" opacity={0.7}>
          <line
            x1={aabb.cx - r * 2}
            y1={aabb.cy}
            x2={aabb.cx + r * 2}
            y2={aabb.cy}
            stroke="white"
            strokeWidth={1 / zoom}
          />
          <line
            x1={aabb.cx}
            y1={aabb.cy - r * 2}
            x2={aabb.cx}
            y2={aabb.cy + r * 2}
            stroke="white"
            strokeWidth={1 / zoom}
          />
        </g>
      </g>

      <g
        className="pointer-events-auto cursor-grab active:cursor-grabbing"
        onMouseDown={(e) => onHandleMouseDown(e, 'pivot')}
        onMouseEnter={() => onHandleHover('pivot')}
        onMouseLeave={() => onHandleHover(null)}
      >
        <circle cx={pivotPos.x} cy={pivotPos.y} r={ps * 2.5} fill="transparent" />
        <circle
          cx={pivotPos.x}
          cy={pivotPos.y}
          r={ps * 1.2}
          fill={
            dragState?.handle === 'pivot'
              ? '#fbbf24'
              : hoveredHandle === 'pivot'
                ? '#38bdf8'
                : 'rgba(255,255,255,0.9)'
          }
          stroke={
            dragState?.handle === 'pivot' || hoveredHandle === 'pivot' ? 'white' : 'rgba(0,0,0,0.5)'
          }
          strokeWidth={1.5 / zoom}
        />
        <g pointerEvents="none" opacity={0.6}>
          <line
            x1={pivotPos.x - ps * 2.5}
            y1={pivotPos.y}
            x2={pivotPos.x + ps * 2.5}
            y2={pivotPos.y}
            stroke="rgba(255,255,255,0.7)"
            strokeWidth={1 / zoom}
          />
          <line
            x1={pivotPos.x}
            y1={pivotPos.y - ps * 2.5}
            x2={pivotPos.x}
            y2={pivotPos.y + ps * 2.5}
            stroke="rgba(255,255,255,0.7)"
            strokeWidth={1 / zoom}
          />
        </g>
      </g>
    </>
  );
}

export default SpatialOverlay;
