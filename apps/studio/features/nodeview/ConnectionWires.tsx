import React from 'react';
import type { FlowEdge } from '@blackboard/types';
import { getInputPortKey, getOutputPortKey } from './nodePortKeys';
import { makeWireBezierPath } from './wireGeometry';

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
  dragPreview: DragPreview | null;
  portColors: ReadonlyMap<string, string>;
  highlightedConnectionKeys?: ReadonlySet<string>;
  flowingConnectionKeys?: ReadonlySet<string>;
  cutPreviewConnectionIds?: ReadonlySet<string>;
  isCutGestureArmed?: boolean;
}

const DEFAULT_WIRE_COLOR = '#555';

const getUpstreamWireColor = (normalWireColor: string): string =>
  `color-mix(in oklch, rgb(var(--color-primary-400)) 42%, ${normalWireColor})`;

const isConnectionEqual = (a: FlowEdge, b: FlowEdge): boolean => a.id === b.id;

function ConnectionWires({
  connections,
  portPositions,
  selectedConnection,
  onSelectConnection,
  dragPreview,
  portColors,
  highlightedConnectionKeys,
  flowingConnectionKeys,
  cutPreviewConnectionIds,
  isCutGestureArmed = false,
}: ConnectionWiresProps) {
  const [hoveredConnectionId, setHoveredConnectionId] = React.useState<string | null>(null);
  const gradientNamespace = React.useId().replaceAll(':', '');

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
        const isPendingCut =
          (cutPreviewConnectionIds?.has(conn.id) ?? false) ||
          (isCutGestureArmed && hoveredConnectionId === conn.id);
        const d = makeWireBezierPath(src, tgt);
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
            {/* Invisible wider path for connection selection. */}
            <path
              data-connection-wire="true"
              data-connection-id={conn.id}
              d={d}
              fill="none"
              stroke="transparent"
              strokeWidth={12}
              style={{
                pointerEvents: 'stroke',
                cursor: isCutGestureArmed ? 'crosshair' : 'pointer',
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (e.ctrlKey || e.metaKey) return;
                onSelectConnection(isSelected ? null : conn);
              }}
              onPointerEnter={() => setHoveredConnectionId(conn.id)}
              onPointerLeave={() => setHoveredConnectionId(null)}
            />
            {/* Visible wire */}
            <path
              data-wire-role="visible"
              data-upstream-highlighted={isUpstreamHighlighted ? 'true' : undefined}
              data-view-flowing={isViewFlowing ? 'true' : undefined}
              d={d}
              fill="none"
              stroke={
                isPendingCut
                  ? '#f87171'
                  : (channelStroke ??
                    (!isViewFlowing && isSelected
                      ? 'rgb(var(--color-primary-400))'
                      : !isViewFlowing && isUpstreamHighlighted
                        ? getUpstreamWireColor(DEFAULT_WIRE_COLOR)
                        : DEFAULT_WIRE_COLOR))
              }
              strokeWidth={
                isPendingCut || isSelected || isUpstreamHighlighted || isViewFlowing ? 2.25 : 1.5
              }
              strokeDasharray={isPendingCut ? '5 3' : undefined}
              style={{ pointerEvents: 'none' }}
            />
            {(isSelected || isPendingCut || isUpstreamHighlighted) && (
              <path
                d={d}
                fill="none"
                stroke={
                  isPendingCut ? '#f87171' : (channelStroke ?? 'rgb(var(--color-primary-400))')
                }
                strokeWidth={6}
                opacity={isPendingCut ? 0.24 : isSelected ? 0.15 : 0.1}
                style={{ pointerEvents: 'none' }}
              />
            )}
            {isViewFlowing && !isPendingCut ? (
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
          const d = makeWireBezierPath(src, tgt);

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
