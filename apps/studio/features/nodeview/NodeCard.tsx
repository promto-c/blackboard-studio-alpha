import React from 'react';
import {
  AnyNode,
  BlendMode,
  type ColorProcessingDomain,
  NodeType,
  type NoteColor,
  type NoteNode,
  type OutputTechnicalChannel,
  SceneNode,
  ViewerSlotAssignments,
} from '@blackboard/types';
import { nodeRegistry } from '@/nodes/registry';
import NodeIcon from '@/features/nodes/NodeIcon';
import { getBlendModeLabel } from '@/features/nodes/nodeVisualHelpers';
import { getInputPorts, nodeFlags } from '@/nodes/helpers';
import { NodeActionMenu } from '@/features/nodes/NodeActionMenu';
import { createExecutionAction, createStackingAction } from '@/features/nodes/nodeActionFactories';
import { OUTPUT_NODE_ID } from '@/state/editor/flowModel';
import { usesImplicitPipelineInput } from '@/utils/nodePredicates';
import * as Icons from '@blackboard/icons';
import { LiveThumbnail, MarkdownNote, ViewerSlotBadges } from '@/components';
import type { ThumbnailMode } from '@/state/preferences';
import { NodeProgressBackground } from '@/features/nodes/NodeProgressBackground';
import type { BackgroundJob } from '@/state/editor/services/backgroundJobs';
import { getOutputTechnicalChannelPort } from '@/color-management';
import {
  getNodeInputProcessingDomain,
  getNodeOutputProcessingDomain,
  getProcessingDomainLabel,
} from '@/utils/nodeProcessingDomains';
import { getDataSemanticProcessingDomain } from '@blackboard/renderer';

// --- Port Components ---

export function InputPortDot({
  nodeId,
  portName,
  label,
  isConnected,
  isDragTarget,
  isReserved = false,
  processingDomain,
  portRef,
}: {
  nodeId: string;
  portName: string;
  label: string;
  isConnected: boolean;
  isDragTarget: boolean;
  isReserved?: boolean;
  processingDomain?: ColorProcessingDomain | null;
  portRef: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={portRef}
      data-port-input="true"
      data-node-id={nodeId}
      data-port-name={portName}
      className={`flex flex-col items-center ${isDragTarget ? 'z-20' : ''}`}
      title={processingDomain ? `${label} · ${getProcessingDomainLabel(processingDomain)}` : label}
      data-processing-domain={processingDomain ?? undefined}
    >
      <div
        className={`w-3 h-3 rounded-full border-2 transition-all flex-shrink-0 ${
          isConnected
            ? isReserved
              ? 'border-transparent bg-transparent ring-2 ring-primary-400/35'
              : 'bg-primary-500 border-primary-400'
            : isDragTarget
              ? 'border-primary-400 bg-primary-900/50 scale-125'
              : 'border-gray-600 bg-gray-800 hover:border-gray-400'
        }`}
      />
    </div>
  );
}

export function OutputPortDot({
  portRef,
  onMouseDown,
  label,
  processingDomain,
}: {
  portRef: (el: HTMLDivElement | null) => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  label: string;
  processingDomain: ColorProcessingDomain;
}) {
  return (
    <div ref={portRef} className="flex flex-col items-center">
      <div
        className={`w-3 h-3 rounded-full border-2 border-gray-600 bg-gray-800 transition-colors flex-shrink-0 ${
          onMouseDown ? 'hover:border-primary-400 hover:bg-primary-900/50 cursor-crosshair' : ''
        }`}
        onMouseDown={onMouseDown}
        title={`${label} · ${getProcessingDomainLabel(processingDomain)}`}
        data-processing-domain={processingDomain}
      />
    </div>
  );
}

// --- Helpers ---

function nodeHasBlendInfo(node: AnyNode): boolean {
  return node.type === NodeType.MERGE;
}

function getOpacityDisplay(node: AnyNode): string {
  const opacity = (node as unknown as { opacity?: number | Array<{ value: number }> }).opacity;
  if (typeof opacity === 'number') return `${Math.round(opacity)}%`;
  if (Array.isArray(opacity) && opacity.length > 0) {
    return `${Math.round(opacity[0].value)}%`;
  }
  return '100%';
}

const NOTE_COLOR_STYLES: Record<
  NoteColor,
  {
    shell: string;
    content: string;
    fold: string;
  }
> = {
  theme: {
    shell:
      'border-primary-300/55 bg-primary-950/20 shadow-[0_0_26px_rgb(var(--color-primary-400)/0.08)] hover:border-primary-200/80',
    content: 'text-primary-50',
    fold: 'border-primary-200/70 bg-primary-300/55',
  },
  teal: {
    shell:
      'border-teal-300/55 bg-teal-950/20 shadow-[0_0_26px_rgba(45,212,191,0.08)] hover:border-teal-200/80',
    content: 'text-teal-50',
    fold: 'border-teal-200/70 bg-teal-300/55',
  },
  slate: {
    shell:
      'border-slate-300/45 bg-slate-950/30 shadow-[0_0_26px_rgba(148,163,184,0.07)] hover:border-slate-200/75',
    content: 'text-slate-100',
    fold: 'border-slate-200/60 bg-slate-300/45',
  },
  amber: {
    shell:
      'border-amber-300/55 bg-amber-950/20 shadow-[0_0_26px_rgba(252,211,77,0.08)] hover:border-amber-200/80',
    content: 'text-amber-50',
    fold: 'border-amber-200/70 bg-amber-300/55',
  },
  rose: {
    shell:
      'border-rose-300/55 bg-rose-950/20 shadow-[0_0_26px_rgba(253,164,175,0.08)] hover:border-rose-200/80',
    content: 'text-rose-50',
    fold: 'border-rose-200/70 bg-rose-300/55',
  },
  violet: {
    shell:
      'border-violet-300/55 bg-violet-950/20 shadow-[0_0_26px_rgba(196,181,253,0.08)] hover:border-violet-200/80',
    content: 'text-violet-50',
    fold: 'border-violet-200/70 bg-violet-300/55',
  },
};

type PortSpec = {
  nodeId: string;
  portName: string;
  label: string;
  processingDomain?: ColorProcessingDomain | null;
  isReserved?: boolean;
};
type OutputPortSpec = {
  portName: string;
  label: string;
  processingDomain: ColorProcessingDomain;
};

const getReservedPortLabel = (portName: string): string => `${portName} (reserved)`;

function buildStackInputPorts(stack: AnyNode[]) {
  const baseNode = stack[0];
  const pipePorts: PortSpec[] = usesImplicitPipelineInput(baseNode.type)
    ? [
        {
          nodeId: baseNode.id,
          portName: 'pipe',
          label: 'in',
          processingDomain: getNodeInputProcessingDomain(baseNode, 'pipe'),
        },
      ]
    : [];
  const inputPorts: PortSpec[] = [];

  for (const node of stack) {
    const declaredPortNames = new Set<string>();
    for (const port of getInputPorts(node)) {
      declaredPortNames.add(port.name);
      inputPorts.push({
        nodeId: node.id,
        portName: port.name,
        label: port.label,
        processingDomain: getNodeInputProcessingDomain(node, port.name),
      });
    }
    for (const portName of Object.keys(node.inputs ?? {})) {
      if (portName === 'pipe' || declaredPortNames.has(portName)) continue;
      inputPorts.push({
        nodeId: node.id,
        portName,
        label: getReservedPortLabel(portName),
        isReserved: true,
      });
    }
  }

  if (baseNode.type === NodeType.MERGE) {
    return [...inputPorts, ...pipePorts];
  }

  return [...pipePorts, ...inputPorts];
}

function getOutputPortsForNode(node: AnyNode): OutputPortSpec[] {
  const outputPorts = nodeRegistry.get(node.type)?.outputPorts;
  if (!outputPorts) {
    return [
      {
        portName: 'output',
        label: 'out',
        processingDomain: getNodeOutputProcessingDomain(node),
      },
    ];
  }
  const resolved = typeof outputPorts === 'function' ? outputPorts(node) : outputPorts;
  return resolved.map((port) => ({
    portName: port.name,
    label: port.label,
    processingDomain: getNodeOutputProcessingDomain(node, port.name),
  }));
}

// --- Shared Layout Pieces ---

type NodeCardShellProps = {
  isSelected: boolean;
  disabled?: boolean;
  onSelect: (event: React.MouseEvent) => void;
  onDragStart: (e: React.MouseEvent) => void;
  className?: string;
  children: React.ReactNode;
};

function NodeCardShell({
  isSelected,
  disabled = false,
  onSelect,
  onDragStart,
  className = '',
  children,
}: NodeCardShellProps) {
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onSelect(e);
      }}
      onMouseDown={onDragStart}
      className={[
        'relative cursor-pointer transition-colors select-none',
        'rounded-lg bg-gray-800/50 border-2 w-48 backdrop-blur-md',
        isSelected ? 'border-primary-500' : 'border-gray-700/50 hover:border-gray-600',
        disabled ? 'opacity-40' : '',
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
      {ports.map(({ nodeId, portName, label, processingDomain, isReserved }) => {
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
            isReserved={isReserved}
            processingDomain={processingDomain}
            portRef={(el) => registerPortRef(`${nodeId}:input:${portName}`, el)}
          />
        );
      })}
    </div>
  );
}

type OutputPortProps = {
  ports: OutputPortSpec[];
  nodeId: string;
  registerPortRef: (key: string, el: HTMLDivElement | null) => void;
  onOutputPortMouseDown?: (e: React.MouseEvent, sourcePortName: string) => void;
};

const getOutputPortKey = (nodeId: string, portName: string) =>
  portName === 'output' ? `${nodeId}:output` : `${nodeId}:output:${portName}`;

function OutputPort({ ports, nodeId, registerPortRef, onOutputPortMouseDown }: OutputPortProps) {
  return (
    <div
      className="absolute left-0 right-0 flex justify-center gap-3 pointer-events-auto"
      style={{ bottom: 0, transform: 'translateY(50%)', zIndex: 15 }}
    >
      {ports.map((port) => (
        <OutputPortDot
          key={port.portName}
          portRef={(el) => registerPortRef(getOutputPortKey(nodeId, port.portName), el)}
          onMouseDown={
            onOutputPortMouseDown
              ? (event) => onOutputPortMouseDown(event, port.portName)
              : undefined
          }
          label={port.label}
          processingDomain={port.processingDomain}
        />
      ))}
    </div>
  );
}

type StackMagnetPlaceholderProps = {
  isActive: boolean;
  instantClose: boolean;
  height: number;
};

function StackMagnetPlaceholder({ isActive, instantClose, height }: StackMagnetPlaceholderProps) {
  const [isRendered, setIsRendered] = React.useState(isActive);
  const [isExpanded, setIsExpanded] = React.useState(false);
  const targetHeight = Math.max(44, height);

  React.useEffect(() => {
    let frame = 0;
    let timer = 0;

    if (isActive) {
      setIsRendered(true);
      frame = window.requestAnimationFrame(() => setIsExpanded(true));
    } else {
      if (instantClose) {
        setIsExpanded(false);
        setIsRendered(false);
        return undefined;
      }

      setIsExpanded(false);
      timer = window.setTimeout(() => setIsRendered(false), 160);
    }

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (timer) window.clearTimeout(timer);
    };
  }, [instantClose, isActive]);

  if (!isRendered) return null;

  return (
    <div
      data-stack-magnet-placeholder="true"
      className="pointer-events-none w-full overflow-hidden transition-[height,opacity] duration-150 ease-out"
      style={{ height: isExpanded ? targetHeight : 0, opacity: isExpanded ? 1 : 0 }}
      aria-hidden="true"
    >
      <div className="relative h-full w-full overflow-hidden rounded-md border border-dashed border-primary-400/70 bg-primary-950/20">
        <div className="absolute left-1/2 top-0 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary-300 bg-gray-900" />
        <div className="absolute inset-2 rounded bg-primary-500/5" />
      </div>
    </div>
  );
}

// --- Scene Node ---

export function SceneNodeCard({
  sceneNode,
  isSelected,
  onSelect,
  onDragStart,
}: {
  sceneNode: SceneNode;
  isSelected: boolean;
  onSelect: () => void;
  onDragStart: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onMouseDown={onDragStart}
      className={[
        'inline-flex w-max max-w-[min(18rem,calc(100vw-1.5rem))] items-center justify-between gap-5',
        'rounded-lg border px-2 py-2 text-xs cursor-pointer select-none shadow-lg backdrop-blur-md transition-colors',
        isSelected
          ? 'border-primary-500 supports-[backdrop-filter]:bg-primary-900/50'
          : 'border-gray-700/50 supports-[backdrop-filter]:bg-gray-800/45 hover:border-gray-600 hover:bg-gray-700/50',
      ].join(' ')}
    >
      <div className="flex min-w-0 items-center gap-2 font-medium text-gray-300">
        <NodeIcon node={sceneNode} />
        <span className="truncate">{sceneNode.name}</span>
      </div>
      <span className="shrink-0 font-mono text-gray-400">
        {sceneNode.width}x{sceneNode.height}
      </span>
    </div>
  );
}

// --- Preview Node Card (ghost placeholder for graph view) ---

export function PreviewNodeCard({
  nodeType,
  name,
  isMerge,
}: {
  nodeType: NodeType;
  name: string;
  isMerge?: boolean;
}) {
  const IconComponent =
    nodeType === NodeType.GROUP
      ? Icons.FolderOpen
      : (nodeRegistry.get(nodeType)?.IconComponent ?? Icons.Cog);

  return (
    <div
      className={[
        'relative cursor-default select-none pointer-events-none',
        'rounded-lg border-2 border-dashed border-primary-400/25 bg-primary-950/20 w-48',
        'animate-pulse opacity-60',
        'backdrop-blur-md',
      ].join(' ')}
    >
      <div className="flex items-center gap-2 p-2">
        <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center text-primary-300/50">
          <IconComponent className="h-4 w-4 text-primary-300/50" />
        </div>
        <span className="flex-1 truncate text-xs text-primary-200/70">{name}</span>
        {isMerge ? (
          <span className="text-[10px] text-primary-300/50 px-1 py-0.5 rounded border border-dashed border-primary-300/20">
            merge
          </span>
        ) : null}
      </div>
    </div>
  );
}

// --- Output Node ---

export function OutputNodeCard({
  isSelected,
  isDragTarget,
  isConnected,
  technicalChannels,
  connectedTechnicalPorts,
  viewerNodeId,
  viewerSlots,
  onSelect,
  onDragStart,
  registerPortRef,
}: {
  isSelected: boolean;
  isDragTarget: boolean;
  isConnected: boolean;
  technicalChannels: readonly OutputTechnicalChannel[];
  connectedTechnicalPorts: ReadonlySet<string>;
  viewerNodeId: string | null;
  viewerSlots: ViewerSlotAssignments;
  onSelect: (event: React.MouseEvent) => void;
  onDragStart: (e: React.MouseEvent) => void;
  registerPortRef: (key: string, el: HTMLDivElement | null) => void;
}) {
  const ports: PortSpec[] = [
    {
      nodeId: OUTPUT_NODE_ID,
      portName: 'pipe',
      label: 'in',
      processingDomain: 'scene_linear',
    },
    ...technicalChannels.map((channel) => ({
      nodeId: OUTPUT_NODE_ID,
      portName: getOutputTechnicalChannelPort(channel.id),
      label: channel.name,
      processingDomain: getDataSemanticProcessingDomain(channel.semantic),
    })),
  ];

  const connectionMap = new Map<
    string,
    { sourceNodeId: string; targetNodeId: string; targetPortName: string }
  >();
  if (isConnected) {
    connectionMap.set(`${OUTPUT_NODE_ID}:pipe`, {
      sourceNodeId: '',
      targetNodeId: OUTPUT_NODE_ID,
      targetPortName: 'pipe',
    });
  }
  technicalChannels.forEach((channel) => {
    const portName = getOutputTechnicalChannelPort(channel.id);
    if (!connectedTechnicalPorts.has(portName)) return;
    connectionMap.set(`${OUTPUT_NODE_ID}:${portName}`, {
      sourceNodeId: '',
      targetNodeId: OUTPUT_NODE_ID,
      targetPortName: portName,
    });
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
}

function NoteGraphCard({
  node,
  isSelected,
  onSelect,
  onDragStart,
  onToggleEnabled,
  onDeleteNode,
}: {
  node: NoteNode;
  isSelected: boolean;
  onSelect: (event: React.MouseEvent) => void;
  onDragStart: (e: React.MouseEvent) => void;
  onToggleEnabled: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
}) {
  const color = NOTE_COLOR_STYLES[node.color];
  const content = node.content.trim() || '_Empty note_';

  return (
    <NodeCardShell
      isSelected={isSelected}
      disabled={!node.enabled}
      onSelect={onSelect}
      onDragStart={onDragStart}
      className={[
        'group/note min-h-36 w-56 overflow-hidden rounded-md p-4 pb-8 pr-5',
        'border backdrop-blur-md transition-[border-color,background-color,box-shadow,opacity]',
        color.shell,
        isSelected ? 'ring-2 ring-primary-300/45' : '',
      ].join(' ')}
    >
      <div className="pointer-events-none absolute right-0 top-0 h-0 w-0 border-l-[20px] border-t-[20px] border-l-transparent border-t-gray-950/80" />
      <div
        className={`pointer-events-none absolute right-0 top-0 h-5 w-5 rounded-bl border-b border-l ${color.fold}`}
      />

      <div className="absolute bottom-1.5 right-1.5 opacity-0 transition-opacity group-hover/note:opacity-100">
        <NodeActionMenu
          actions={[
            {
              id: 'delete',
              label: 'Delete',
              icon: <Icons.Trash className="h-4 w-4" />,
              iconClassName:
                'w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:text-red-400 hover:bg-gray-700/60 transition-colors',
              onClick: (e) => {
                e.stopPropagation();
                onDeleteNode(node.id);
              },
            },
            {
              id: 'enabled',
              label: node.enabled ? 'Disable' : 'Enable',
              icon: node.enabled ? (
                <Icons.Power className="h-4 w-4" />
              ) : (
                <Icons.PowerOff className="h-4 w-4" />
              ),
              iconClassName:
                'w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:bg-gray-700/60 hover:text-white',
              onClick: (e) => {
                e.stopPropagation();
                onToggleEnabled(node.id);
              },
            },
          ]}
        />
      </div>

      <MarkdownNote content={content} className={`text-sm leading-5 ${color.content}`} />
    </NodeCardShell>
  );
}

// --- Stack Node ---

interface StackNodeCardProps {
  stack: AnyNode[];
  sceneNode: SceneNode | undefined;
  isSelected: boolean;
  selectedNodeId: string | null;
  selectedNodeIds: string[];
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
  isStackMagnetDropCommit?: boolean;
  stackMagnetPlaceholderHeight?: number;
  onSelect: (event: React.MouseEvent) => void;
  onSelectNode: (event: React.MouseEvent, nodeId: string) => void;
  onOpenGroupNode: (nodeId: string) => void;
  onDragStart: (e: React.MouseEvent) => void;
  onToggleEnabled: (nodeId: string) => void;
  onToggleStacking: (nodeId: string) => void;
  canStackNode: (nodeId: string) => boolean;
  onDeleteNode: (nodeId: string) => void;
  onOutputPortMouseDown: (e: React.MouseEvent, sourcePortName: string) => void;
  registerPortRef: (key: string, el: HTMLDivElement | null) => void;
  activeNodeJobMap: Map<string, BackgroundJob>;
  onExecuteNode?: (nodeId: string) => void;
}

export function StackNodeCard({
  stack,
  sceneNode,
  isSelected,
  selectedNodeId,
  selectedNodeIds,
  thumbnailMode,
  connectionMap,
  viewerNodeId,
  viewerSlots,
  isDragTarget,
  isStackMagnetTarget = false,
  isStackMagnetSource = false,
  isStackMagnetDropCommit = false,
  stackMagnetPlaceholderHeight = 0,
  onSelect,
  onSelectNode,
  onOpenGroupNode,
  onDragStart,
  onToggleEnabled,
  onToggleStacking,
  canStackNode,
  onDeleteNode,
  onOutputPortMouseDown,
  registerPortRef,
  activeNodeJobMap,
  onExecuteNode,
}: StackNodeCardProps) {
  const baseNode = stack[0];
  const noteNode =
    stack.length === 1 && baseNode.type === NodeType.NOTE ? (baseNode as NoteNode) : null;
  const stackInputPorts = buildStackInputPorts(stack);
  const outputPorts = getOutputPortsForNode(baseNode);
  const selectedNodeIdSet = React.useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);

  if (noteNode) {
    return (
      <NoteGraphCard
        node={noteNode}
        isSelected={isSelected}
        onSelect={onSelect}
        onDragStart={onDragStart}
        onToggleEnabled={onToggleEnabled}
        onDeleteNode={onDeleteNode}
      />
    );
  }

  return (
    <NodeCardShell
      isSelected={isSelected}
      disabled={!baseNode.enabled}
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
        ports={outputPorts}
        nodeId={baseNode.id}
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
              onSelectNode(e, node.id);
            }}
            onDoubleClick={(e) => {
              if (node.type !== NodeType.GROUP) return;
              e.stopPropagation();
              onOpenGroupNode(node.id);
            }}
            className={`relative flex w-full flex-col items-start gap-2 overflow-hidden rounded-md p-2 transition-colors ${
              node.id === selectedNodeId || selectedNodeIdSet.has(node.id)
                ? 'bg-primary-900/40 ring-1 ring-inset ring-primary-500/50'
                : 'bg-gray-900/70'
            } ${!node.enabled ? 'opacity-40' : ''}`}
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
                    id: 'enabled',
                    label: node.enabled ? 'Disable' : 'Enable',
                    icon: node.enabled ? (
                      <Icons.Power className="h-4 w-4" />
                    ) : (
                      <Icons.PowerOff className="h-4 w-4" />
                    ),
                    iconClassName:
                      'w-6 h-6 flex items-center justify-center text-gray-400 hover:text-white rounded',
                    onClick: (e) => {
                      e.stopPropagation();
                      onToggleEnabled(node.id);
                    },
                  },
                ]}
              />
            </div>
            {nodeHasBlendInfo(node) && (
              <div className="flex items-center gap-3 w-full text-[10px] text-gray-500 font-mono">
                <span>{getBlendModeLabel((node as { operator?: BlendMode }).operator)}</span>
                <span className="text-gray-600">|</span>
                <span>Mix {getOpacityDisplay(node)}</span>
              </div>
            )}
            {thumbnailMode !== 'off' && !!nodeFlags(node.type).hasThumbnail && (
              <div className="relative w-full h-20 rounded overflow-hidden bg-gray-900 text-gray-500 flex items-center justify-center">
                {thumbnailMode === 'live' && sceneNode ? (
                  <LiveThumbnail stack={stack} sceneNode={sceneNode} />
                ) : thumbnailMode === 'static' && sceneNode ? (
                  <LiveThumbnail stack={stack} sceneNode={sceneNode} staticFrame={0} />
                ) : null}
              </div>
            )}
          </div>
        );
      })}

      <StackMagnetPlaceholder
        isActive={isStackMagnetTarget}
        instantClose={isStackMagnetDropCommit}
        height={stackMagnetPlaceholderHeight}
      />
    </NodeCardShell>
  );
}
