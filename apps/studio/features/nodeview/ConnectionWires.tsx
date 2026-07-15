import React from 'react';
import type { FlowEdge } from '@blackboard/types';
import { getInputPortKey, getOutputPortKey } from './nodePortKeys';

interface DragPreview {
  sourceNodeId: string;
  sourcePortName?: string;
  cursorX: number;
  cursorY: number;
}

interface ConnectionWiresProps {
  connections: readonly FlowEdge[];
  portPositions: Map<string, { x: number; y: number }>;
  selectedConnection: FlowEdge | null;
  onSelectConnection: (connection: FlowEdge | null) => void;
  onCutConnection?: (connection: FlowEdge) => boolean;
  dragPreview: DragPreview | null;
  portColors: ReadonlyMap<string, string>;
  highlightedConnectionKeys?: ReadonlySet<string>;
  flowingConnectionKeys?: ReadonlySet<string>;
}

const DEFAULT_WIRE_COLOR = '#555';

const getUpstreamWireColor = (normalWireColor: string): string =>
  `color-mix(in oklch, rgb(var(--color-primary-400)) 42%, ${normalWireColor})`;

function makeBezierPath(src: { x: number; y: number }, tgt: { x: number; y: number }): string {
  const dy = Math.abs(tgt.y - src.y);
  const cpOffset = Math.max(40, dy * 0.4);

  return `M ${src.x} ${src.y} C ${src.x} ${src.y + cpOffset}, ${tgt.x} ${tgt.y - cpOffset}, ${tgt.x} ${tgt.y}`;
}

const isConnectionEqual = (a: FlowEdge, b: FlowEdge): boolean => a.id === b.id;

function ConnectionWires({
  connections,
  portPositions,
  selectedConnection,
  onSelectConnection,
  onCutConnection,
  dragPreview,
  portColors,
  highlightedConnectionKeys,
  flowingConnectionKeys,
}: ConnectionWiresProps) {
  const [hoveredConnection, setHoveredConnection] = React.useState<FlowEdge | null>(null);
  const [isCutModifierPressed, setIsCutModifierPressed] = React.useState(false);
  const gradientNamespace = React.useId().replaceAll(':', '');

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
      {connections.map((conn, connectionIndex) => {
        const srcKey = getOutputPortKey(conn.sourceNodeId, conn.sourcePort);
        const tgtKey = getInputPortKey(conn.targetNodeId, conn.targetPort);
        const src = portPositions.get(srcKey);
        const tgt = portPositions.get(tgtKey);

        if (!src || !tgt) return null;

        const isSelected =
          selectedConnection !== null && isConnectionEqual(conn, selectedConnection);
        const isHovered = hoveredConnection !== null && isConnectionEqual(conn, hoveredConnection);
        const isCuttable = !!onCutConnection;
        const isCutHover = isCuttable && isHovered && isCutModifierPressed;
        const d = makeBezierPath(src, tgt);
        const isUpstreamHighlighted = highlightedConnectionKeys?.has(conn.id) ?? false;
        const isViewFlowing = flowingConnectionKeys?.has(conn.id) ?? false;
        const sourceColor = portColors.get(srcKey);
        const targetColor = portColors.get(tgtKey);
        const hasGradient =
          !!sourceColor && !!targetColor && sourceColor.toLowerCase() !== targetColor.toLowerCase();
        const gradientId = `${gradientNamespace}-connection-${connectionIndex}`;
        const channelStroke = hasGradient ? `url(#${gradientId})` : (sourceColor ?? targetColor);

        return (
          <g key={conn.id}>
            {hasGradient ? (
              <defs>
                <linearGradient
                  id={gradientId}
                  gradientUnits="userSpaceOnUse"
                  x1={src.x}
                  y1={src.y}
                  x2={tgt.x}
                  y2={tgt.y}
                >
                  <stop offset="0%" stopColor={sourceColor} />
                  <stop offset="100%" stopColor={targetColor} />
                </linearGradient>
              </defs>
            ) : null}
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
                  onCutConnection?.(conn);
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
              data-wire-role="visible"
              data-upstream-highlighted={isUpstreamHighlighted ? 'true' : undefined}
              data-view-flowing={isViewFlowing ? 'true' : undefined}
              d={d}
              fill="none"
              stroke={
                isCutHover
                  ? '#f87171'
                  : (channelStroke ??
                    (!isViewFlowing && isSelected
                      ? 'rgb(var(--color-primary-400))'
                      : !isViewFlowing && isUpstreamHighlighted
                        ? getUpstreamWireColor(DEFAULT_WIRE_COLOR)
                        : DEFAULT_WIRE_COLOR))
              }
              strokeWidth={
                isCutHover || isSelected || isUpstreamHighlighted || isViewFlowing ? 2.25 : 1.5
              }
              strokeDasharray={isCutHover ? '5 3' : undefined}
              style={{ pointerEvents: 'none' }}
            />
            {(isSelected || isCutHover || isUpstreamHighlighted) && (
              <path
                d={d}
                fill="none"
                stroke={isCutHover ? '#f87171' : (channelStroke ?? 'rgb(var(--color-primary-400))')}
                strokeWidth={6}
                opacity={isCutHover ? 0.2 : isSelected ? 0.15 : 0.1}
                style={{ pointerEvents: 'none' }}
              />
            )}
            {isViewFlowing && !isCutHover ? (
              <path
                data-view-flow-path="true"
                className="node-view-flow-wire"
                d={d}
                fill="none"
                stroke="rgb(var(--color-primary-300))"
                strokeWidth={2.25}
                strokeDasharray="6 9"
                strokeLinecap="round"
                style={{ pointerEvents: 'none' }}
              />
            ) : null}
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
              stroke={portColors.get(srcKey) ?? '#6366f1'}
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
