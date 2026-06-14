import React from 'react';

interface Connection {
  sourceNodeId: string;
  sourcePortName?: string;
  targetNodeId: string;
  targetPortName: string;
  isPipe?: boolean;
}

interface DragPreview {
  sourceNodeId: string;
  sourcePortName?: string;
  cursorX: number;
  cursorY: number;
}

interface ConnectionWiresProps {
  connections: Connection[];
  portPositions: Map<string, { x: number; y: number }>;
  selectedConnection: Connection | null;
  onSelectConnection: (conn: Connection | null) => void;
  canCutConnection?: (conn: Connection) => boolean;
  onCutConnection?: (conn: Connection) => boolean;
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
    (a.sourcePortName ?? 'output') === (b.sourcePortName ?? 'output') &&
    a.targetNodeId === b.targetNodeId &&
    a.targetPortName === b.targetPortName
  );
}

const getOutputPortKey = (nodeId: string, portName?: string): string =>
  !portName || portName === 'output' ? `${nodeId}:output` : `${nodeId}:output:${portName}`;

function ConnectionWires({
  connections,
  portPositions,
  selectedConnection,
  onSelectConnection,
  canCutConnection,
  onCutConnection,
  dragPreview,
}: ConnectionWiresProps) {
  const [hoveredConnection, setHoveredConnection] = React.useState<Connection | null>(null);
  const [isCutModifierPressed, setIsCutModifierPressed] = React.useState(false);

  React.useEffect(() => {
    const updateCutModifier = (event: KeyboardEvent) => {
      setIsCutModifierPressed(event.ctrlKey || event.metaKey);
    };
    const resetCutModifier = () => setIsCutModifierPressed(false);

    window.addEventListener('keydown', updateCutModifier);
    window.addEventListener('keyup', updateCutModifier);
    window.addEventListener('blur', resetCutModifier);
    return () => {
      window.removeEventListener('keydown', updateCutModifier);
      window.removeEventListener('keyup', updateCutModifier);
      window.removeEventListener('blur', resetCutModifier);
    };
  }, []);

  return (
    <svg
      className="absolute top-0 left-0 pointer-events-none"
      style={{ overflow: 'visible', width: 1, height: 1, zIndex: 0 }}
    >
      {/* Existing connections */}
      {connections.map((conn) => {
        const srcKey = getOutputPortKey(conn.sourceNodeId, conn.sourcePortName);
        const tgtKey = `${conn.targetNodeId}:input:${conn.targetPortName}`;
        const src = portPositions.get(srcKey);
        const tgt = portPositions.get(tgtKey);

        if (!src || !tgt) return null;

        const isPipe = !!conn.isPipe;
        const isSelected =
          selectedConnection !== null && isConnectionEqual(conn, selectedConnection);
        const isHovered = hoveredConnection !== null && isConnectionEqual(conn, hoveredConnection);
        const isCuttable = !!onCutConnection && (canCutConnection?.(conn) ?? true);
        const isCutHover = isCuttable && isHovered && isCutModifierPressed;
        const d = makeBezierPath(src, tgt);
        const key = `${conn.sourceNodeId}-${conn.sourcePortName ?? 'output'}-${conn.targetNodeId}-${conn.targetPortName}`;

        return (
          <g key={key}>
            {/* Invisible wider path for selection and ctrl/meta-drag cutting. */}
            <path
              data-connection-wire="true"
              d={d}
              fill="none"
              stroke="transparent"
              strokeWidth={12}
              style={{ pointerEvents: 'stroke', cursor: isCutHover ? 'crosshair' : 'pointer' }}
              onClick={(e) => {
                e.stopPropagation();
                if ((e.ctrlKey || e.metaKey) && isCuttable) {
                  onCutConnection(conn);
                  return;
                }
                onSelectConnection(isSelected ? null : conn);
              }}
              onPointerEnter={(e) => {
                setHoveredConnection(conn);
                setIsCutModifierPressed(e.ctrlKey || e.metaKey);
              }}
              onPointerMove={(e) => setIsCutModifierPressed(e.ctrlKey || e.metaKey)}
              onPointerLeave={() => setHoveredConnection(null)}
            />
            {/* Visible wire */}
            <path
              d={d}
              fill="none"
              stroke={
                isCutHover
                  ? '#f87171'
                  : isSelected
                    ? 'rgb(var(--color-primary-500))'
                    : isPipe
                      ? '#4b5563'
                      : '#6b7280'
              }
              strokeWidth={isCutHover || isSelected ? 2.25 : 1.5}
              strokeDasharray={isCutHover ? '5 3' : undefined}
              style={{ pointerEvents: 'none' }}
            />
            {(isSelected || isCutHover) && (
              <path
                d={d}
                fill="none"
                stroke={isCutHover ? '#f87171' : 'rgb(var(--color-primary-500))'}
                strokeWidth={6}
                opacity={isCutHover ? 0.2 : 0.15}
                style={{ pointerEvents: 'none' }}
              />
            )}
          </g>
        );
      })}

      {/* Drag preview wire */}
      {dragPreview &&
        (() => {
          const srcKey = getOutputPortKey(dragPreview.sourceNodeId, dragPreview.sourcePortName);
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
}

export default ConnectionWires;
