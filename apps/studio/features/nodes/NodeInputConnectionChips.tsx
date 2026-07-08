import type { AnyNode } from '@blackboard/types';
import * as Icons from '@blackboard/icons';
import { getInputConnections } from '@/utils/connectionGraph';
import { getInputPorts } from '@/nodes/helpers';

interface PendingConnection {
  nodeId: string;
  portName: string;
}

const getPortLabel = (node: AnyNode, portName: string): string =>
  getInputPorts(node).find((port) => port.name === portName)?.label ?? portName;

const isReservedInputPort = (node: AnyNode, portName: string): boolean =>
  portName !== 'pipe' && !getInputPorts(node).some((port) => port.name === portName);

export function NodeInputConnectionChips({
  node,
  allNodes,
  isSelected,
  onDisconnect,
  onConnectPort,
  onSelectNode,
  onHoverNodeIds,
  onCancelConnection,
  pendingConnection,
}: {
  node: AnyNode;
  allNodes: AnyNode[];
  isSelected: boolean;
  onDisconnect: (nodeId: string, portName: string) => void;
  onConnectPort?: (nodeId: string, portName: string) => void;
  onSelectNode: (nodeId: string) => void;
  onHoverNodeIds: (nodeIds: string[]) => void;
  onCancelConnection?: () => void;
  pendingConnection?: PendingConnection | null;
}) {
  const connectedInputs = getInputConnections(node).filter((input) => input.portName !== 'pipe');
  const inputPorts = getInputPorts(node);
  const connectedPortNames = new Set(connectedInputs.map((input) => input.portName));
  const unconnectedPorts = isSelected
    ? inputPorts.filter((port) => !connectedPortNames.has(port.name))
    : [];

  if (connectedInputs.length === 0 && unconnectedPorts.length === 0) return null;

  return (
    <div className="ml-7 mt-1 flex flex-wrap gap-1">
      {connectedInputs.map(({ portName, sourceNodeId }) => {
        const sourceNode = allNodes.find((candidate) => candidate.id === sourceNodeId);
        const portLabel = getPortLabel(node, portName);
        const isReserved = isReservedInputPort(node, portName);

        return (
          <span
            key={`${node.id}:${portName}`}
            className={`inline-flex min-w-0 max-w-full items-center overflow-hidden rounded border text-[10px] transition-colors ${
              isReserved
                ? 'border-dashed border-primary-300/30 bg-gray-950/45 text-primary-100 hover:border-primary-300/55 hover:bg-primary-500/10'
                : 'border-primary-300/20 bg-primary-500/10 text-primary-100 hover:border-primary-300/45 hover:bg-primary-500/15'
            }`}
            title={`${isReserved ? `${portLabel} reserved; ` : ''}connected to ${
              sourceNode?.name ?? 'Unknown'
            }`}
            onMouseEnter={() => onHoverNodeIds(sourceNode ? [sourceNode.id] : [])}
            onMouseLeave={() => onHoverNodeIds([])}
          >
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                if (sourceNode) {
                  onSelectNode(sourceNode.id);
                }
              }}
              className="inline-flex min-w-0 flex-1 items-center gap-1 px-1.5 py-0.5 text-left transition-colors hover:text-primary-50"
              aria-label={`Select ${sourceNode?.name ?? 'connected source'}`}
            >
              <Icons.Link className="h-3 w-3 shrink-0 text-primary-300" />
              <span className="max-w-[5.5rem] truncate text-primary-200/80">{portLabel}</span>
              {isReserved ? (
                <span className="rounded border border-primary-200/20 px-1 text-[9px] uppercase text-primary-100/50">
                  reserved
                </span>
              ) : null}
              <span className="text-primary-200/40">&larr;</span>
              <span className="max-w-[7rem] truncate">{sourceNode?.name ?? 'Unknown'}</span>
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onDisconnect(node.id, portName);
              }}
              className="mr-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-primary-200/60 hover:bg-primary-300/15 hover:text-primary-50"
              title={`Cut ${portLabel} input`}
              aria-label={`Cut ${portLabel} input`}
            >
              <Icons.XMark className="h-3 w-3" />
            </button>
          </span>
        );
      })}
      {unconnectedPorts.map((port) => {
        const isAwaitingConnection =
          pendingConnection?.nodeId === node.id && pendingConnection?.portName === port.name;

        return (
          <span
            key={`${node.id}:${port.name}:open`}
            className={`inline-flex min-w-0 max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] transition-all ${
              isAwaitingConnection
                ? 'cursor-default animate-pulse border-dashed border-primary-300/80 bg-primary-500/15 text-primary-200 ring-1 ring-primary-300/45 shadow-[0_0_14px_rgba(45,212,191,0.18)]'
                : 'border-gray-700/70 bg-gray-950/45 text-gray-500 hover:border-gray-600 hover:bg-gray-900/60 cursor-pointer'
            }`}
            title={
              isAwaitingConnection
                ? `Click a node to connect to ${port.label}`
                : `Click to connect ${port.label}`
            }
          >
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                if (isAwaitingConnection) return;
                onConnectPort?.(node.id, port.name);
              }}
              className="inline-flex min-w-0 flex-1 items-center gap-1 text-left"
            >
              <Icons.Minus className="h-3 w-3 shrink-0" />
              <span className="max-w-[8rem] truncate">{port.label}</span>
              <span className={isAwaitingConnection ? 'text-primary-400/60' : 'text-gray-600'}>
                {isAwaitingConnection ? 'select source' : 'open'}
              </span>
            </button>
            {isAwaitingConnection ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onCancelConnection?.();
                }}
                className="-mr-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-primary-200/70 hover:bg-primary-300/15 hover:text-primary-50"
                title="Cancel source selection"
                aria-label="Cancel source selection"
              >
                <Icons.XMark className="h-3 w-3" />
              </button>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
