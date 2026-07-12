import { useSyncExternalStore } from 'react';
import type { ViewportOverlayProps } from '@/nodes/NodeDefinition';
import { getKeyerSampleDrag, subscribeKeyerSampleDrag } from './keyerSampleDragStore';
import { KEYER_SAMPLE_TOOL_ID } from './keyerModel';

export function KeyerSampleOverlay({ node, activeTool, zoom }: ViewportOverlayProps) {
  const drag = useSyncExternalStore(
    subscribeKeyerSampleDrag,
    getKeyerSampleDrag,
    getKeyerSampleDrag,
  );
  if (!drag || drag.nodeId !== node.id || activeTool !== KEYER_SAMPLE_TOOL_ID) return null;

  const x = Math.min(drag.start.x, drag.current.x);
  const y = Math.min(drag.start.y, drag.current.y);
  const width = Math.abs(drag.current.x - drag.start.x);
  const height = Math.abs(drag.current.y - drag.start.y);

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={2 / zoom}
        fill="rgb(45 212 191 / 0.12)"
        stroke="rgb(94 234 212 / 0.95)"
        strokeWidth={1.5 / zoom}
        strokeDasharray={`${5 / zoom} ${3 / zoom}`}
      />
      <circle
        cx={drag.start.x}
        cy={drag.start.y}
        r={3 / zoom}
        fill="rgb(153 246 228)"
        stroke="rgb(15 23 42)"
        strokeWidth={1 / zoom}
      />
    </g>
  );
}
