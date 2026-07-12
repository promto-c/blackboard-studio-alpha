/**
 * ViewportSvgOverlays — renders the SVG overlay layer on top of the viewport
 * canvas, including display/data window borders and per-node SVG overlays
 * (roto paths, warp pins, bokeh focus, etc.).
 *
 * Extracted from Viewport.tsx to reduce the monolith's size.
 */
import { useCallback, useMemo } from 'react';
import type { AnyNode, SceneNode, ViewerSettings } from '@blackboard/types';
import { stabilizePoint } from '@/utils/rotoTracking';
import { ViewportOverlayRenderer } from './overlays';
import type { DataWindowRect } from './dataWindow';

// Props
// -----

export interface ViewportSvgOverlaysProps {
  sceneNode: SceneNode;
  viewerSettings: ViewerSettings;
  zoom: number;
  pan: { x: number; y: number };
  visualFrame: number;
  activeViewportTool: string | null;
  overlayContext: unknown;

  /** Display window bounding rect (null when not available). */
  displayWindowRect: { x: number; y: number; width: number; height: number } | null;
  /** Data window rect for the selected node (null when not available). */
  dataWindowRect: DataWindowRect | null;
  /** Selected node (undefined when nothing selected). */
  selectedNode: AnyNode | undefined;

  /** Stabilization matrix for the current frame. */
  stabilizationMatrix: number[][] | null;
}

// Component
// ---------

export function ViewportSvgOverlays({
  sceneNode,
  selectedNode,
  viewerSettings,
  activeViewportTool,
  overlayContext,
  zoom,
  pan,
  visualFrame,
  displayWindowRect,
  dataWindowRect,
  stabilizationMatrix,
}: ViewportSvgOverlaysProps) {
  /** Transform absolute scene corners through the stabilization matrix. */
  const stabilizeBboxCorners = useCallback(
    (x: number, y: number, w: number, h: number) => {
      const cx = sceneNode.width / 2;
      const cy = sceneNode.height / 2;
      const tl = stabilizePoint({ x: x - cx, y: y - cy }, stabilizationMatrix);
      const tr = stabilizePoint({ x: x + w - cx, y: y - cy }, stabilizationMatrix);
      const br = stabilizePoint({ x: x + w - cx, y: y + h - cy }, stabilizationMatrix);
      const bl = stabilizePoint({ x: x - cx, y: y + h - cy }, stabilizationMatrix);
      return [
        { x: tl.x + cx, y: tl.y + cy },
        { x: tr.x + cx, y: tr.y + cy },
        { x: br.x + cx, y: br.y + cy },
        { x: bl.x + cx, y: bl.y + cy },
      ];
    },
    [sceneNode, stabilizationMatrix],
  );

  const overlayProps = useMemo(
    () => ({
      node: selectedNode!,
      frame: visualFrame,
      zoom,
      pan,
      scene: { width: sceneNode.width, height: sceneNode.height },
      activeTool: activeViewportTool,
      context: overlayContext,
    }),
    [selectedNode, visualFrame, zoom, pan, sceneNode, activeViewportTool, overlayContext],
  );

  return (
    <svg
      className="absolute top-0 left-0 w-full h-full pointer-events-none"
      viewBox={`0 0 ${sceneNode.width} ${sceneNode.height}`}
      style={{ overflow: 'visible' }}
    >
      {/* Display Window border (cyan) */}
      {viewerSettings.showOverlays && displayWindowRect && displayWindowRect.width > 150 && (
        <DisplayWindowBorderPolygon
          rect={displayWindowRect}
          stabilizeBboxCorners={stabilizeBboxCorners}
          zoom={zoom}
        />
      )}

      {/* Data Window border (amber/dashed) */}
      {viewerSettings.showOverlays && dataWindowRect && dataWindowRect.width > 150 && (
        <DataWindowBorderPolygon
          rect={dataWindowRect}
          stabilizeBboxCorners={stabilizeBboxCorners}
          zoom={zoom}
        />
      )}

      {/* Direct SVG overlays (absolute scene coordinates, outside <g>) */}
      {selectedNode && (
        <ViewportOverlayRenderer
          node={selectedNode}
          mode="svg-direct"
          overlayProps={overlayProps}
        />
      )}

      {/* Scene-centered SVG overlays */}
      {overlayProps && (
        <g transform={`translate(${sceneNode.width / 2}, ${sceneNode.height / 2})`}>
          {selectedNode && (
            <ViewportOverlayRenderer node={selectedNode} mode="svg" overlayProps={overlayProps} />
          )}
        </g>
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Inner helper components
// ---------------------------------------------------------------------------

/** Cyan display-window border polygon. */
function DisplayWindowBorderPolygon({
  rect,
  stabilizeBboxCorners,
  zoom,
}: {
  rect: { x: number; y: number; width: number; height: number };
  stabilizeBboxCorners: (
    x: number,
    y: number,
    w: number,
    h: number,
  ) => { x: number; y: number }[] | null;
  zoom: number;
}) {
  const pts = stabilizeBboxCorners(rect.x, rect.y, rect.width, rect.height)
    ?.map((p) => `${p.x},${p.y}`)
    .join(' ');
  if (!pts) return null;
  return <polygon points={pts} fill="none" stroke="rgb(34 211 238 / 0.5)" strokeWidth={1 / zoom} />;
}

/** Amber dashed data-window border polygon. */
function DataWindowBorderPolygon({
  rect,
  stabilizeBboxCorners,
  zoom,
}: {
  rect: DataWindowRect;
  stabilizeBboxCorners: (
    x: number,
    y: number,
    w: number,
    h: number,
  ) => { x: number; y: number }[] | null;
  zoom: number;
}) {
  const pts = stabilizeBboxCorners(rect.x, rect.y, rect.width, rect.height)
    ?.map((p) => `${p.x},${p.y}`)
    .join(' ');
  if (!pts) return null;
  return (
    <polygon
      points={pts}
      fill="none"
      stroke="rgb(251 191 36 / 0.8)"
      strokeWidth={2 / zoom}
      strokeDasharray={`${6 / zoom} ${4 / zoom}`}
    />
  );
}
