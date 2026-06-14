import type { WarpNode } from '@blackboard/types';
import { getValueAtFrame } from '@blackboard/renderer';
import { stabilizePoint } from '@/utils/rotoTracking';
import { ecc } from '@/features/viewport/overlays';
import type { ViewportOverlayProps } from '@/nodes/NodeDefinition';

function WarpOverlay(props: ViewportOverlayProps) {
  const ctx = ecc(props);
  const viewport = ctx.viewport;
  if (!viewport.showOverlays) return null;
  const warp = ctx.warp;
  const node = props.node as WarpNode;
  const sceneWidth = props.scene.width;
  const sceneHeight = props.scene.height;
  const sp = (p: { x: number; y: number }) => stabilizePoint(p, viewport.stabilizationMatrix);
  return (
    <>
      {node.pins.map((pin) => {
        const x = pin.position.x * sceneWidth - sceneWidth / 2,
          y = sceneHeight / 2 - pin.position.y * sceneHeight;
        const dx = getValueAtFrame(pin.translation.x, props.frame) * sceneWidth,
          dy = getValueAtFrame(pin.translation.y, props.frame) * sceneHeight;
        const base = sp({ x, y });
        const cur = sp({ x: x + dx, y: y - dy });
        const iH = warp.hoveredPinId === pin.id,
          iDP = warp.dragPinState?.pinId === pin.id;
        return (
          <g
            key={pin.id}
            className="pointer-events-auto cursor-grab active:cursor-grabbing"
            onMouseEnter={() => warp.setHoveredPinId(pin.id)}
            onMouseLeave={() => warp.setHoveredPinId(null)}
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
                <circle
                  cx={base.x}
                  cy={base.y}
                  r={3 / props.zoom}
                  fill="rgba(255,255,255,0.2)"
                />{' '}
              </>
            )}
            <circle
              cx={cur.x}
              cy={cur.y}
              r={6 / props.zoom}
              fill={iDP ? '#fbbf24' : iH ? '#fbbf24' : '#38bdf8'}
              stroke="white"
              strokeWidth={2 / props.zoom}
            />
          </g>
        );
      })}
    </>
  );
}

export default WarpOverlay;
