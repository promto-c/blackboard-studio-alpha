import React from 'react';

interface Connection {
  sourceNodeId: string;
  targetNodeId: string;
  targetPortName: string;
  isPipe?: boolean;
}

interface DragPreview {
  sourceNodeId: string;
  cursorX: number;
  cursorY: number;
}

interface ConnectionWiresProps {
  connections: Connection[];
  portPositions: Map<string, { x: number; y: number }>;
  selectedConnection: Connection | null;
  onSelectConnection: (conn: Connection | null) => void;
  onCutConnection?: (conn: Connection) => void;
  dragPreview: DragPreview | null;
}

function makeBezierPath(src: { x: number; y: number }, tgt: { x: number; y: number }): string {
  const dy = Math.abs(tgt.y - src.y);
  const cpOffset = Math.max(40, dy * 0.4);

  return `M ${src.x} ${src.y} C ${src.x} ${src.y + cpOffset}, ${tgt.x} ${tgt.y - cpOffset}, ${tgt.x} ${tgt.y}`;
}

function isConnectionEqual(a: Connection, b: Connection): boolean {
  return (
    a.sourceNodeId === b.sourceNodeId &&
    a.targetNodeId === b.targetNodeId &&
    a.targetPortName === b.targetPortName
  );
}

const ConnectionWires: React.FC<ConnectionWiresProps> = ({
  connections,
  portPositions,
  selectedConnection,
  onSelectConnection,
  onCutConnection,
  dragPreview,
}) => {
  const [cutDragConnection, setCutDragConnection] = React.useState<Connection | null>(null);

  return (
    <svg
      className="absolute top-0 left-0 pointer-events-none"
      style={{ overflow: 'visible', width: 1, height: 1, zIndex: 5 }}
    >
      {/* Existing connections */}
      {connections.map((conn) => {
        const srcKey = `${conn.sourceNodeId}:output`;
        const tgtKey = `${conn.targetNodeId}:input:${conn.targetPortName}`;
        const src = portPositions.get(srcKey);
        const tgt = portPositions.get(tgtKey);

        if (!src || !tgt) return null;

        const isPipe = !!conn.isPipe;
        const isSelected =
          selectedConnection !== null && isConnectionEqual(conn, selectedConnection);
        const isCutting = cutDragConnection !== null && isConnectionEqual(conn, cutDragConnection);
        const d = makeBezierPath(src, tgt);
        const key = `${conn.sourceNodeId}-${conn.targetNodeId}-${conn.targetPortName}`;

        return (
          <g key={key}>
            {/* Invisible wider path for selection and ctrl/meta-drag cutting. */}
            <path
              d={d}
              fill="none"
              stroke="transparent"
              strokeWidth={12}
              style={{ pointerEvents: 'stroke', cursor: isPipe ? 'crosshair' : 'pointer' }}
              onClick={(e) => {
                e.stopPropagation();
                if (isPipe && (e.ctrlKey || e.metaKey)) return;
                onSelectConnection(isSelected ? null : conn);
              }}
              onPointerDown={(e) => {
                if (!isPipe || (!e.ctrlKey && !e.metaKey) || !onCutConnection) return;
                e.stopPropagation();
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                setCutDragConnection(conn);
              }}
              onPointerUp={(e) => {
                if (!isPipe || !isCutting || !onCutConnection) return;
                e.stopPropagation();
                onCutConnection(conn);
                setCutDragConnection(null);
              }}
              onPointerCancel={() => {
                if (isCutting) setCutDragConnection(null);
              }}
            />
            {/* Visible wire */}
            <path
              d={d}
              fill="none"
              stroke={
                isCutting
                  ? '#f87171'
                  : isSelected
                    ? 'rgb(var(--color-primary-500))'
                    : isPipe
                      ? '#4b5563'
                      : '#6b7280'
              }
              strokeWidth={isCutting || isSelected ? 2 : 1.5}
              strokeDasharray={isCutting ? '5 3' : undefined}
              style={{ pointerEvents: 'none' }}
            />
            {isSelected && (
              <path
                d={d}
                fill="none"
                stroke="rgb(var(--color-primary-500))"
                strokeWidth={6}
                opacity={0.15}
                style={{ pointerEvents: 'none' }}
              />
            )}
          </g>
        );
      })}

      {/* Drag preview wire */}
      {dragPreview &&
        (() => {
          const srcKey = `${dragPreview.sourceNodeId}:output`;
          const src = portPositions.get(srcKey);
          if (!src) return null;

          const tgt = { x: dragPreview.cursorX, y: dragPreview.cursorY };
          const d = makeBezierPath(src, tgt);

          return (
            <path
              d={d}
              fill="none"
              stroke="#6366f1"
              strokeWidth={1.5}
              strokeDasharray="6 3"
              style={{ pointerEvents: 'none' }}
            />
          );
        })()}
    </svg>
  );
};

export default ConnectionWires;
