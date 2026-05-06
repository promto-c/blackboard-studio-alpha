import React from 'react';
import { AnyNode, SceneNode, ViewerSlotAssignments } from '@blackboard/types';
import { effectRegistry } from '@/effects/effectRegistry';
import NodeIcon from '@/features/nodes/NodeIcon';
import { getStaticThumbnailAssetId, hasMediaThumbnail } from '@/features/nodes/nodeVisualHelpers';
import { NodeActionMenu } from '@/features/nodes/NodeActionMenu';
import { createExecutionAction, createStackingAction } from '@/features/nodes/nodeActionFactories';
import { OUTPUT_NODE_ID } from '@/state/editor/flowModel';
import * as Icons from '@blackboard/icons';
import { ImageThumbnail, LiveThumbnail, ViewerSlotBadges } from '@/components';
import type { ThumbnailMode } from '@/state/preferencesContext';
import { NodeProgressBackground } from '@/features/nodes/NodeProgressBackground';
import type { BackgroundJob } from '@/state/editor/services/backgroundJobs';

// --- Port Components ---

export const InputPortDot: React.FC<{
  nodeId: string;
  portName: string;
  label: string;
  isConnected: boolean;
  isDragTarget: boolean;
  portRef: (el: HTMLDivElement | null) => void;
}> = ({ nodeId, portName, label, isConnected, isDragTarget, portRef }) => (
  <div
    ref={portRef}
    data-port-input="true"
    data-node-id={nodeId}
    data-port-name={portName}
    className={`flex flex-col items-center ${isDragTarget ? 'z-20' : ''}`}
    title={label}
  >
    <div
      className={`w-3 h-3 rounded-full border-2 transition-all flex-shrink-0 ${
        isConnected
          ? 'bg-primary-500 border-primary-400'
          : isDragTarget
            ? 'border-primary-400 bg-primary-900/50 scale-125'
            : 'border-gray-600 bg-gray-800 hover:border-gray-400'
      }`}
    />
  </div>
);

export const OutputPortDot: React.FC<{
  portRef: (el: HTMLDivElement | null) => void;
  onMouseDown?: (e: React.MouseEvent) => void;
}> = ({ portRef, onMouseDown }) => (
  <div ref={portRef} className="flex flex-col items-center">
    <div
      className={`w-3 h-3 rounded-full border-2 border-gray-600 bg-gray-800 transition-colors flex-shrink-0 ${
        onMouseDown ? 'hover:border-primary-400 hover:bg-primary-900/50 cursor-crosshair' : ''
      }`}
      onMouseDown={onMouseDown}
      title={onMouseDown ? 'Drag to connect' : undefined}
    />
  </div>
);

// --- Helpers ---

function getInputPortsForNode(node: AnyNode) {
  const inputPorts = effectRegistry.get(node.type)?.inputPorts;
  if (!inputPorts) return [];
  return typeof inputPorts === 'function' ? inputPorts(node) : inputPorts;
}

type PortSpec = { nodeId: string; portName: string; label: string };

function buildStackInputPorts(stack: AnyNode[]) {
  const baseNode = stack[0];
  const ports: PortSpec[] = [{ nodeId: baseNode.id, portName: 'pipe', label: 'in' }];

  for (const node of stack) {
    for (const port of getInputPortsForNode(node)) {
      ports.push({ nodeId: node.id, portName: port.name, label: port.label });
    }
  }

  return ports;
}

// --- Shared Layout Pieces ---

type NodeCardShellProps = {
  isSelected: boolean;
  onSelect: () => void;
  onDragStart: (e: React.MouseEvent) => void;
  className?: string;
  children: React.ReactNode;
};

function NodeCardShell({
  isSelected,
  onSelect,
  onDragStart,
  className = '',
  children,
}: NodeCardShellProps) {
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onMouseDown={onDragStart}
      className={[
        'relative cursor-pointer transition-colors select-none',
        'rounded-lg bg-gray-800/50 border-2 w-48',
        isSelected ? 'border-primary-500' : 'border-gray-700/50 hover:border-gray-600',
        className,
      ].join(' ')}
    >
      {children}
    </div>
  );
}

type InputPortsProps = {
  ports: PortSpec[];
  isDragTarget: boolean;
  connectionMap: Map<
    string,
    { sourceNodeId: string; targetNodeId: string; targetPortName: string }
  >;
  registerPortRef: (key: string, el: HTMLDivElement | null) => void;
  className?: string;
};

function InputPorts({
  ports,
  isDragTarget,
  connectionMap,
  registerPortRef,
  className = '',
}: InputPortsProps) {
  return (
    <div
      className={[
        'absolute gap-3 left-0 right-0 flex justify-center pointer-events-auto',
        className,
      ].join(' ')}
      style={{
        top: 0,
        transform: 'translateY(-50%)',
        zIndex: 15,
      }}
    >
      {ports.map(({ nodeId, portName, label }) => {
        const connKey = `${nodeId}:${portName}`;
        const conn = connectionMap.get(connKey);

        return (
          <InputPortDot
            key={connKey}
            nodeId={nodeId}
            portName={portName}
            label={label}
            isConnected={!!conn}
            isDragTarget={isDragTarget}
            portRef={(el) => registerPortRef(`${nodeId}:input:${portName}`, el)}
          />
        );
      })}
    </div>
  );
}

type OutputPortProps = {
  portKey: string;
  registerPortRef: (key: string, el: HTMLDivElement | null) => void;
  onOutputPortMouseDown?: (e: React.MouseEvent) => void;
};

function OutputPort({ portKey, registerPortRef, onOutputPortMouseDown }: OutputPortProps) {
  return (
    <div
      className="absolute left-1/2 flex justify-center pointer-events-auto"
      style={{ bottom: 0, transform: 'translate(-50%, 50%)', zIndex: 15 }}
    >
      <OutputPortDot
        portRef={(el) => registerPortRef(portKey, el)}
        onMouseDown={onOutputPortMouseDown}
      />
    </div>
  );
}

// --- Scene Node ---

export const SceneNodeCard: React.FC<{
  sceneNode: SceneNode;
  isSelected: boolean;
  onSelect: () => void;
  onDragStart: (e: React.MouseEvent) => void;
  registerPortRef: (key: string, el: HTMLDivElement | null) => void;
  onOutputPortMouseDown: (e: React.MouseEvent) => void;
}> = ({ sceneNode, isSelected, onSelect, onDragStart, registerPortRef, onOutputPortMouseDown }) => {
  return (
    <NodeCardShell
      isSelected={isSelected}
      onSelect={onSelect}
      onDragStart={onDragStart}
      className="flex flex-col items-center justify-center p-3"
    >
      <NodeIcon node={sceneNode} />
      <span className="text-xs text-gray-300 font-medium mt-2">{sceneNode.name}</span>
      <span className="text-xs text-gray-500 font-mono mt-1">
        {sceneNode.width}x{sceneNode.height}
      </span>

      <OutputPort
        portKey={`${sceneNode.id}:output`}
        registerPortRef={registerPortRef}
        onOutputPortMouseDown={onOutputPortMouseDown}
      />
    </NodeCardShell>
  );
};

// --- Output Node ---

export const OutputNodeCard: React.FC<{
  isSelected: boolean;
  isDragTarget: boolean;
  viewerNodeId: string | null;
  viewerSlots: ViewerSlotAssignments;
  onSelect: () => void;
  onDragStart: (e: React.MouseEvent) => void;
  registerPortRef: (key: string, el: HTMLDivElement | null) => void;
}> = ({
  isSelected,
  isDragTarget,
  viewerNodeId,
  viewerSlots,
  onSelect,
  onDragStart,
  registerPortRef,
}) => {
  const ports: PortSpec[] = [{ nodeId: OUTPUT_NODE_ID, portName: 'pipe', label: 'in' }];

  const connectionMap = new Map<
    string,
    { sourceNodeId: string; targetNodeId: string; targetPortName: string }
  >();
  connectionMap.set(`${OUTPUT_NODE_ID}:pipe`, {
    sourceNodeId: '',
    targetNodeId: OUTPUT_NODE_ID,
    targetPortName: 'pipe',
  });

  return (
    <NodeCardShell
      isSelected={isSelected}
      onSelect={onSelect}
      onDragStart={onDragStart}
      className="flex flex-col items-center justify-center p-3"
    >
      <Icons.ArrowDownTray className="h-4 w-4 text-gray-400" />
      <div className="flex items-center mt-2">
        <span className="text-xs text-gray-300 font-medium">Output</span>
        <ViewerSlotBadges
          nodeId={OUTPUT_NODE_ID}
          viewerNodeId={viewerNodeId}
          viewerSlots={viewerSlots}
        />
      </div>

      <InputPorts
        ports={ports}
        isDragTarget={isDragTarget}
        connectionMap={connectionMap}
        registerPortRef={registerPortRef}
      />
    </NodeCardShell>
  );
};

// --- Stack Node ---

interface StackNodeCardProps {
  stack: AnyNode[];
  sceneNode: SceneNode | undefined;
  isSelected: boolean;
  selectedNodeId: string | null;
  thumbnailMode: ThumbnailMode;
  connectionMap: Map<
    string,
    { sourceNodeId: string; targetNodeId: string; targetPortName: string }
  >;
  viewerNodeId: string | null;
  viewerSlots: ViewerSlotAssignments;
  isDragTarget: boolean;
  isStackMagnetTarget?: boolean;
  isStackMagnetSource?: boolean;
  onSelect: () => void;
  onSelectNode: (nodeId: string) => void;
  onDragStart: (e: React.MouseEvent) => void;
  onToggleVisibility: (nodeId: string) => void;
  onToggleStacking: (nodeId: string) => void;
  canStackNode: (nodeId: string) => boolean;
  onDeleteNode: (nodeId: string) => void;
  onOutputPortMouseDown: (e: React.MouseEvent) => void;
  registerPortRef: (key: string, el: HTMLDivElement | null) => void;
  activeNodeJobMap: Map<string, BackgroundJob>;
  onExecuteNode?: (nodeId: string) => void;
}

export const StackNodeCard: React.FC<StackNodeCardProps> = ({
  stack,
  sceneNode,
  isSelected,
  selectedNodeId,
  thumbnailMode,
  connectionMap,
  viewerNodeId,
  viewerSlots,
  isDragTarget,
  isStackMagnetTarget = false,
  isStackMagnetSource = false,
  onSelect,
  onSelectNode,
  onDragStart,
  onToggleVisibility,
  onToggleStacking,
  canStackNode,
  onDeleteNode,
  onOutputPortMouseDown,
  registerPortRef,
  activeNodeJobMap,
  onExecuteNode,
}) => {
  const baseNode = stack[0];
  const stackInputPorts = buildStackInputPorts(stack);

  return (
    <NodeCardShell
      isSelected={isSelected}
      onSelect={onSelect}
      onDragStart={onDragStart}
      className={[
        'flex flex-col justify-start gap-0.5 p-2 transition-all duration-150',
        isStackMagnetTarget
          ? 'border-primary-400 bg-primary-950/25 ring-2 ring-primary-400/70 shadow-[0_0_34px_rgba(56,189,248,0.25)]'
          : '',
        isStackMagnetSource ? 'border-primary-300/80 shadow-[0_0_22px_rgba(56,189,248,0.18)]' : '',
      ].join(' ')}
    >
      <InputPorts
        ports={stackInputPorts}
        isDragTarget={isDragTarget}
        connectionMap={connectionMap}
        registerPortRef={registerPortRef}
      />

      <OutputPort
        portKey={`${baseNode.id}:output`}
        registerPortRef={registerPortRef}
        onOutputPortMouseDown={onOutputPortMouseDown}
      />

      {/* Node content */}
      {stack.map((node) => {
        const stackingAction = createStackingAction(node, canStackNode(node.id), onToggleStacking);
        const executionAction = onExecuteNode ? createExecutionAction(node, onExecuteNode) : null;

        return (
          <div
            key={node.id}
            onClick={(e) => {
              e.stopPropagation();
              onSelectNode(node.id);
            }}
            className={`relative flex w-full flex-col items-start gap-2 overflow-hidden rounded-md p-2 transition-colors ${
              node.id === selectedNodeId
                ? 'bg-primary-900/40 ring-1 ring-inset ring-primary-500/50'
                : 'bg-gray-900/70'
            }`}
            title={node.name}
          >
            <NodeProgressBackground job={activeNodeJobMap.get(node.id)} />
            <div className="relative flex items-center gap-2 w-full">
              <div className="flex-shrink-0 text-gray-400">
                <NodeIcon node={node} />
              </div>
              <span className="text-xs text-gray-300 font-medium truncate flex-1">{node.name}</span>
              <ViewerSlotBadges
                nodeId={node.id}
                viewerNodeId={viewerNodeId}
                viewerSlots={viewerSlots}
              />
              <NodeActionMenu
                actions={[
                  ...(stackingAction ? [stackingAction] : []),
                  ...(executionAction ? [executionAction] : []),
                  {
                    id: 'delete',
                    label: 'Delete',
                    icon: <Icons.Trash className="h-4 w-4" />,
                    iconClassName:
                      'w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:text-red-400 hover:bg-gray-600/50 transition-colors',
                    onClick: (e) => {
                      e.stopPropagation();
                      onDeleteNode(node.id);
                    },
                  },
                  {
                    id: 'visibility',
                    label: node.visible ? 'Hide' : 'Show',
                    icon: node.visible ? (
                      <Icons.Eye className="h-4 w-4" />
                    ) : (
                      <Icons.EyeSlash className="h-4 w-4" />
                    ),
                    iconClassName:
                      'w-6 h-6 flex items-center justify-center text-gray-400 hover:text-white rounded',
                    onClick: (e) => {
                      e.stopPropagation();
                      onToggleVisibility(node.id);
                    },
                  },
                ]}
              />
            </div>
            {hasMediaThumbnail(node) && (
              <div className="relative w-full h-20 rounded overflow-hidden bg-gray-900 text-gray-500 flex items-center justify-center">
                {thumbnailMode === 'live' && sceneNode ? (
                  <LiveThumbnail stack={stack} sceneNode={sceneNode} />
                ) : thumbnailMode === 'static' && sceneNode ? (
                  <LiveThumbnail stack={stack} sceneNode={sceneNode} staticFrame={0} />
                ) : (
                  <ImageThumbnail
                    assetId={getStaticThumbnailAssetId(node)}
                    className="w-full h-full object-contain"
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
    </NodeCardShell>
  );
};
