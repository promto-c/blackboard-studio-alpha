/**
 * WarpOverlay — Renders warp pin overlays in the viewport SVG.
 *
 * Extracted from Viewport.tsx to keep per-effect overlay rendering
 * in its own file, registered via `ViewportOverlayComponent`.
 */

import React from 'react';
import type { WarpNode } from '@blackboard/types';
import { getValueAtFrame } from '@blackboard/renderer';
import { stabilizePoint } from '@/utils/rotoTracking';

export interface WarpOverlayProps {
  node: WarpNode;
  sceneWidth: number;
  sceneHeight: number;
  frame: number;
  zoom: number;
  hoveredPinId: string | null;
  dragPinId: string | null;
  onPinHover: (id: string | null) => void;
  stabilizationMatrix: number[][] | null;
}

const WarpOverlay: React.FC<WarpOverlayProps> = ({
  node,
  sceneWidth,
  sceneHeight,
  frame,
  zoom,
  hoveredPinId,
  dragPinId,
  onPinHover,
  stabilizationMatrix,
}) => {
  const sp = (p: { x: number; y: number }) => stabilizePoint(p, stabilizationMatrix);
  return (
    <>
      {node.pins.map((pin) => {
        const x = pin.position.x * sceneWidth - sceneWidth / 2,
          y = sceneHeight / 2 - pin.position.y * sceneHeight;
        const dx = getValueAtFrame(pin.translation.x, frame) * sceneWidth,
          dy = getValueAtFrame(pin.translation.y, frame) * sceneHeight;
        const base = sp({ x, y });
        const cur = sp({ x: x + dx, y: y - dy });
        const iH = hoveredPinId === pin.id,
          iDP = dragPinId === pin.id;
        return (
          <g
            key={pin.id}
            className="pointer-events-auto cursor-grab active:cursor-grabbing"
            onMouseEnter={() => onPinHover(pin.id)}
            onMouseLeave={() => onPinHover(null)}
          >
            {(Math.abs(dx) > 1 || Math.abs(dy) > 1) && (
              <>
                {' '}
                <line
                  x1={base.x}
                  y1={base.y}
                  x2={cur.x}
                  y2={cur.y}
                  stroke="rgba(255,255,255,0.3)"
                  strokeDasharray="4 2"
                />{' '}
                <circle cx={base.x} cy={base.y} r={3 / zoom} fill="rgba(255,255,255,0.2)" />{' '}
              </>
            )}
            <circle
              cx={cur.x}
              cy={cur.y}
              r={6 / zoom}
              fill={iDP ? '#fbbf24' : iH ? '#fbbf24' : '#38bdf8'}
              stroke="white"
              strokeWidth={2 / zoom}
            />
          </g>
        );
      })}
    </>
  );
};

export default WarpOverlay;
