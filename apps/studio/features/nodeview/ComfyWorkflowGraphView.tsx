import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@blackboard/ui';
import { ComfyWorkflow } from '@blackboard/types';
import { CanvasViewportControls } from '@/components/CanvasViewportControls';
import { CANVAS_MAX_ZOOM, CANVAS_MIN_ZOOM, useCanvasViewport } from '@/hooks/useCanvasViewport';
import { isJsonObject, getNonEmptyString } from '@/utils/guards';
import CanvasGrid from './CanvasGrid';

type JsonObject = Record<string, unknown>;

interface ComfyGraphNode {
  id: string | number;
  type: string;
  pos?: [number, number] | number[];
  size?: [number, number] | number[];
  title?: string;
  inputs?: ComfyGraphNodeInput[];
  outputs?: ComfyGraphNodeOutput[];
}

interface ComfyGraphNodeInput {
  name?: string;
  label?: string;
  localized_name?: string;
  type?: string;
  link?: number | string | null;
}

interface ComfyGraphNodeOutput {
  name?: string;
  label?: string;
  localized_name?: string;
  type?: string;
  links?: Array<number | string> | null;
}

interface ComfyGraphLink {
  id: string;
  originId: string;
  originSlot: number;
  targetId: string;
  targetSlot: number;
}

export interface ComfyGraphPortSummary {
  name?: string;
  label?: string;
  localizedName?: string;
  type?: string;
  connected?: boolean;
}

export interface ComfyGraphPathItem {
  id: string;
  name: string;
  inputs?: ComfyGraphPortSummary[];
  outputs?: ComfyGraphPortSummary[];
}

interface ComfyGraphLevel extends ComfyGraphPathItem {
  graph: JsonObject;
}

interface ComfyGraphBoundaryPort {
  id: string;
  kind: 'input' | 'output';
  slot: number;
  label: string;
  type?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ComfyWorkflowGraphViewProps {
  workflow: ComfyWorkflow;
  subgraphPath?: ComfyGraphPathItem[];
  onSubgraphPathChange?: (path: ComfyGraphPathItem[]) => void;
}

const NODE_WIDTH = 220;
const NODE_MIN_HEIGHT = 74;
const BOUNDARY_PORT_WIDTH = 178;
const BOUNDARY_PORT_HEIGHT = 34;
const BOUNDARY_PORT_GAP = 58;

const getGraphNodes = (graph: JsonObject): ComfyGraphNode[] =>
  Array.isArray(graph.nodes)
    ? graph.nodes.filter((node): node is ComfyGraphNode => {
        return isJsonObject(node) && typeof node.type === 'string';
      })
    : [];

const getGraphLinks = (graph: JsonObject): ComfyGraphLink[] => {
  const extra = isJsonObject(graph.extra) ? graph.extra : null;
  const links = Array.isArray(graph.links)
    ? graph.links
    : extra && Array.isArray(extra.links)
      ? extra.links
      : [];
  return links
    .map((link): ComfyGraphLink | null => {
      if (Array.isArray(link)) {
        const [id, originId, originSlot, targetId, targetSlot] = link;
        if (
          (typeof id !== 'string' && typeof id !== 'number') ||
          (typeof originId !== 'string' && typeof originId !== 'number') ||
          (typeof targetId !== 'string' && typeof targetId !== 'number') ||
          typeof originSlot !== 'number' ||
          typeof targetSlot !== 'number'
        ) {
          return null;
        }
        return {
          id: String(id),
          originId: String(originId),
          originSlot,
          targetId: String(targetId),
          targetSlot,
        };
      }

      if (!isJsonObject(link)) return null;
      const id = link.id;
      const originId = link.origin_id;
      const targetId = link.target_id;
      const originSlot = link.origin_slot;
      const targetSlot = link.target_slot;
      if (
        (typeof id !== 'string' && typeof id !== 'number') ||
        (typeof originId !== 'string' && typeof originId !== 'number') ||
        (typeof targetId !== 'string' && typeof targetId !== 'number') ||
        typeof originSlot !== 'number' ||
        typeof targetSlot !== 'number'
      ) {
        return null;
      }
      return {
        id: String(id),
        originId: String(originId),
        originSlot,
        targetId: String(targetId),
        targetSlot,
      };
    })
    .filter((link): link is ComfyGraphLink => link !== null);
};

const getGraphPortDefinitions = (
  graph: JsonObject,
  key: 'inputs' | 'outputs',
): ComfyGraphPortSummary[] =>
  Array.isArray(graph[key])
    ? graph[key].map((port): ComfyGraphPortSummary => {
        if (!isJsonObject(port)) return {};
        return {
          name: getNonEmptyString(port.name),
          label: getNonEmptyString(port.label),
          localizedName:
            getNonEmptyString(port.localized_name) ?? getNonEmptyString(port.localizedName),
          type: getNonEmptyString(port.type),
        };
      })
    : [];

const getNodeInputPortSummaries = (
  ports: ComfyGraphNodeInput[] | undefined,
): ComfyGraphPortSummary[] =>
  (ports ?? []).map((port) => ({
    name: port.name,
    label: port.label,
    localizedName: port.localized_name,
    type: port.type,
    connected: port.link !== undefined && port.link !== null,
  }));

const getNodeOutputPortSummaries = (
  ports: Array<ComfyGraphNodeInput | ComfyGraphNodeOutput> | undefined,
): ComfyGraphPortSummary[] =>
  (ports ?? []).map((port) => ({
    name: port.name,
    label: port.label,
    localizedName: port.localized_name,
    type: port.type,
  }));

const getSubgraphsById = (workflow: ComfyWorkflow): Map<string, JsonObject> => {
  const sourceGraph = workflow.sourceGraph;
  if (!sourceGraph) return new Map();
  const definitions = isJsonObject(sourceGraph.definitions) ? sourceGraph.definitions : null;
  const subgraphs =
    definitions && Array.isArray(definitions.subgraphs) ? definitions.subgraphs : [];
  return new Map(
    subgraphs
      .filter(
        (subgraph): subgraph is JsonObject =>
          isJsonObject(subgraph) && typeof subgraph.id === 'string',
      )
      .map((subgraph) => [String(subgraph.id), subgraph]),
  );
};

const getGraphName = (graph: JsonObject, fallback: string): string =>
  getNonEmptyString(graph.name) ?? fallback;

const getNodePosition = (node: ComfyGraphNode): { x: number; y: number } => {
  const pos = Array.isArray(node.pos) ? node.pos : [];
  return {
    x: typeof pos[0] === 'number' ? pos[0] : 0,
    y: typeof pos[1] === 'number' ? pos[1] : 0,
  };
};

const getNodeSize = (node: ComfyGraphNode): { width: number; height: number } => {
  const size = Array.isArray(node.size) ? node.size : [];
  return {
    width: typeof size[0] === 'number' ? Math.max(size[0], NODE_WIDTH) : NODE_WIDTH,
    height: typeof size[1] === 'number' ? Math.max(size[1], NODE_MIN_HEIGHT) : NODE_MIN_HEIGHT,
  };
};

const getPortY = (node: ComfyGraphNode, slot: number, side: 'input' | 'output'): number => {
  const ports = side === 'input' ? node.inputs : node.outputs;
  const count = Math.max(ports?.length ?? 1, 1);
  const size = getNodeSize(node);
  return getNodePosition(node).y + ((slot + 1) * size.height) / (count + 1);
};

const getBoundaryPortDisplayName = (
  definition: ComfyGraphPortSummary | undefined,
  fallback: string,
): string => {
  const label = definition?.localizedName ?? definition?.label ?? definition?.name;
  return label?.trim() || fallback;
};

const getBounds = (nodes: ComfyGraphNode[]) => {
  if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 640, maxY: 360 };
  return nodes.reduce(
    (bounds, node) => {
      const pos = getNodePosition(node);
      const size = getNodeSize(node);
      return {
        minX: Math.min(bounds.minX, pos.x),
        minY: Math.min(bounds.minY, pos.y),
        maxX: Math.max(bounds.maxX, pos.x + size.width),
        maxY: Math.max(bounds.maxY, pos.y + size.height),
      };
    },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
};

const includeBoundaryPortsInBounds = (
  bounds: ReturnType<typeof getBounds>,
  ports: ComfyGraphBoundaryPort[],
) =>
  ports.reduce(
    (nextBounds, port) => ({
      minX: Math.min(nextBounds.minX, port.x),
      minY: Math.min(nextBounds.minY, port.y),
      maxX: Math.max(nextBounds.maxX, port.x + port.width),
      maxY: Math.max(nextBounds.maxY, port.y + port.height),
    }),
    bounds,
  );

const getAverage = (values: number[]): number | null => {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
};

const getBoundaryPorts = ({
  graph,
  links,
  nodesById,
  bounds,
  pathItem,
}: {
  graph: JsonObject;
  links: ComfyGraphLink[];
  nodesById: Map<string, ComfyGraphNode>;
  bounds: ReturnType<typeof getBounds>;
  pathItem?: ComfyGraphPathItem;
}): ComfyGraphBoundaryPort[] => {
  if (!pathItem) return [];

  const inputDefinitions = getGraphPortDefinitions(graph, 'inputs');
  const outputDefinitions = getGraphPortDefinitions(graph, 'outputs');
  const isWrapperInputConnected = (slot: number): boolean =>
    pathItem.inputs?.[slot]?.connected === true;

  const inputSlots = new Set(
    inputDefinitions
      .map((_definition, slot) => slot)
      .filter((slot) => !isWrapperInputConnected(slot)),
  );
  const outputSlots = new Set(outputDefinitions.map((_definition, slot) => slot));

  for (const link of links) {
    if (link.originId === '-10' && !isWrapperInputConnected(link.originSlot)) {
      inputSlots.add(link.originSlot);
    }
    if (link.targetId === '-20') outputSlots.add(link.targetSlot);
  }

  const makeFallbackY = (slot: number) => bounds.minY + 42 + slot * BOUNDARY_PORT_GAP;
  const inputX = bounds.minX - BOUNDARY_PORT_WIDTH - 72;
  const outputX = bounds.maxX + 72;

  const inputs = [...inputSlots]
    .sort((a, b) => a - b)
    .map((slot): ComfyGraphBoundaryPort => {
      const linkedYs = links
        .filter((link) => link.originId === '-10' && link.originSlot === slot)
        .map((link) => {
          const target = nodesById.get(link.targetId);
          return target ? getPortY(target, link.targetSlot, 'input') : null;
        })
        .filter((value): value is number => value !== null);
      const definition = inputDefinitions[slot] ?? pathItem.inputs?.[slot];
      const y = getAverage(linkedYs) ?? makeFallbackY(slot);
      return {
        id: `external-input-${slot}`,
        kind: 'input',
        slot,
        label: getBoundaryPortDisplayName(definition, `Input ${slot + 1}`),
        type: definition?.type,
        x: inputX,
        y: y - BOUNDARY_PORT_HEIGHT / 2,
        width: BOUNDARY_PORT_WIDTH,
        height: BOUNDARY_PORT_HEIGHT,
      };
    });

  const outputs = [...outputSlots]
    .sort((a, b) => a - b)
    .map((slot): ComfyGraphBoundaryPort => {
      const linkedYs = links
        .filter((link) => link.targetId === '-20' && link.targetSlot === slot)
        .map((link) => {
          const source = nodesById.get(link.originId);
          return source ? getPortY(source, link.originSlot, 'output') : null;
        })
        .filter((value): value is number => value !== null);
      const definition = outputDefinitions[slot] ?? pathItem.outputs?.[slot];
      const y = getAverage(linkedYs) ?? makeFallbackY(slot);
      return {
        id: `external-output-${slot}`,
        kind: 'output',
        slot,
        label: getBoundaryPortDisplayName(definition, `Output ${slot + 1}`),
        type: definition?.type,
        x: outputX,
        y: y - BOUNDARY_PORT_HEIGHT / 2,
        width: BOUNDARY_PORT_WIDTH,
        height: BOUNDARY_PORT_HEIGHT,
      };
    });

  return [...inputs, ...outputs];
};

function ComfyWorkflowGraphView({
  workflow,
  subgraphPath,
  onSubgraphPathChange,
}: ComfyWorkflowGraphViewProps) {
  const sourceGraph = workflow.sourceGraph;
  const subgraphsById = useMemo(() => getSubgraphsById(workflow), [workflow]);
  const [localSubgraphPath, setLocalSubgraphPath] = useState<ComfyGraphPathItem[]>([]);
  const currentSubgraphPath = subgraphPath ?? localSubgraphPath;
  const setCurrentSubgraphPath = onSubgraphPathChange ?? setLocalSubgraphPath;
  const {
    viewport,
    containerRef,
    getTransformStyle,
    fitAll,
    handleMouseDown,
    zoomIn,
    zoomOut,
    getCursorStyle,
  } = useCanvasViewport();

  useEffect(() => {
    if (subgraphPath === undefined) {
      setLocalSubgraphPath([]);
    }
  }, [sourceGraph, subgraphPath, workflow.name]);

  const pathLevels = useMemo((): ComfyGraphLevel[] => {
    if (!sourceGraph) return [];
    const levels: ComfyGraphLevel[] = [{ id: 'root', name: workflow.name, graph: sourceGraph }];

    for (const item of currentSubgraphPath) {
      const graph = subgraphsById.get(item.id);
      if (!graph) break;
      levels.push({
        id: item.id,
        name: item.name || getGraphName(graph, item.id),
        graph,
      });
    }

    return levels;
  }, [currentSubgraphPath, sourceGraph, subgraphsById, workflow.name]);

  const currentLevel = pathLevels[pathLevels.length - 1];
  const nodes = useMemo(
    () => (currentLevel ? getGraphNodes(currentLevel.graph) : []),
    [currentLevel],
  );
  const links = useMemo(
    () => (currentLevel ? getGraphLinks(currentLevel.graph) : []),
    [currentLevel],
  );
  const nodesById = useMemo(() => new Map(nodes.map((node) => [String(node.id), node])), [nodes]);
  const nodeBounds = useMemo(() => getBounds(nodes), [nodes]);
  const currentPathItem = currentSubgraphPath[currentSubgraphPath.length - 1];
  const boundaryPorts = useMemo(
    () =>
      currentLevel
        ? getBoundaryPorts({
            graph: currentLevel.graph,
            links,
            nodesById,
            bounds: nodeBounds,
            pathItem: currentPathItem,
          })
        : [],
    [currentLevel, currentPathItem, links, nodeBounds, nodesById],
  );
  const boundaryPortsById = useMemo(
    () => new Map(boundaryPorts.map((port) => [`${port.kind}:${port.slot}`, port])),
    [boundaryPorts],
  );
  const bounds = useMemo(
    () => includeBoundaryPortsInBounds(nodeBounds, boundaryPorts),
    [boundaryPorts, nodeBounds],
  );
  const svgPadding = 300;
  const fitWorkflow = useCallback(
    (animate: boolean) => fitAll(bounds, { top: 52, left: 20, right: 20, bottom: 64, animate }),
    [bounds, fitAll],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => fitWorkflow(false), 0);
    return () => window.clearTimeout(timer);
  }, [currentLevel?.id, fitWorkflow]);

  if (!sourceGraph || !currentLevel) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-xs text-gray-500">
        This Comfy workflow does not include a full graph source.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary-300/50"
      style={{ cursor: getCursorStyle() === 'default' ? 'grab' : getCursorStyle() }}
      tabIndex={0}
      role="region"
      aria-label={`${currentLevel.name} Comfy workflow graph`}
      onMouseDown={(event) => {
        event.stopPropagation();
        event.currentTarget.focus({ preventScroll: true });
        handleMouseDown(event, { allowPrimaryButton: event.target === event.currentTarget });
      }}
      onDoubleClick={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        fitWorkflow(true);
      }}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === '+' || event.key === '=') {
          event.preventDefault();
          zoomIn();
        } else if (event.key === '-') {
          event.preventDefault();
          zoomOut();
        } else if (event.key.toLowerCase() === 'f' || event.key === '0') {
          event.preventDefault();
          fitWorkflow(true);
        }
      }}
    >
      <CanvasGrid zoom={viewport.zoom} panX={viewport.panX} panY={viewport.panY} />

      <div className="pointer-events-none absolute right-3 top-3 z-20 rounded-full border border-white/10 bg-gray-950/65 px-2.5 py-1 text-[10px] text-gray-400 shadow-lg backdrop-blur-md">
        Drag to pan · Scroll to zoom · Double-click to fit
      </div>

      <div style={getTransformStyle()}>
        <svg
          className="pointer-events-none absolute overflow-visible"
          style={{
            left: bounds.minX - svgPadding,
            top: bounds.minY - svgPadding,
            width: bounds.maxX - bounds.minX + svgPadding * 2,
            height: bounds.maxY - bounds.minY + svgPadding * 2,
          }}
        >
          {links.map((link) => {
            const source = nodesById.get(link.originId);
            const target = nodesById.get(link.targetId);
            const inputBoundaryPort = boundaryPortsById.get(`input:${link.originSlot}`);
            const outputBoundaryPort = boundaryPortsById.get(`output:${link.targetSlot}`);
            const sourcePoint =
              link.originId === '-10' && inputBoundaryPort
                ? {
                    x: inputBoundaryPort.x + inputBoundaryPort.width,
                    y: inputBoundaryPort.y + inputBoundaryPort.height / 2,
                  }
                : source
                  ? {
                      x: getNodePosition(source).x + getNodeSize(source).width,
                      y: getPortY(source, link.originSlot, 'output'),
                    }
                  : null;
            const targetPoint =
              link.targetId === '-20' && outputBoundaryPort
                ? {
                    x: outputBoundaryPort.x,
                    y: outputBoundaryPort.y + outputBoundaryPort.height / 2,
                  }
                : target
                  ? {
                      x: getNodePosition(target).x,
                      y: getPortY(target, link.targetSlot, 'input'),
                    }
                  : null;
            if (!sourcePoint || !targetPoint) return null;
            const x1 = sourcePoint.x - bounds.minX + svgPadding;
            const y1 = sourcePoint.y - bounds.minY + svgPadding;
            const x2 = targetPoint.x - bounds.minX + svgPadding;
            const y2 = targetPoint.y - bounds.minY + svgPadding;
            const handle = Math.max(80, Math.abs(x2 - x1) * 0.35);
            return (
              <path
                key={link.id}
                d={`M ${x1} ${y1} C ${x1 + handle} ${y1}, ${x2 - handle} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke="rgba(34,211,238,0.42)"
                strokeWidth={2}
              />
            );
          })}
        </svg>

        {boundaryPorts.map((port) => {
          const isInput = port.kind === 'input';
          return (
            <div
              key={port.id}
              className={`pointer-events-none absolute flex items-center gap-2 rounded-md border px-2 py-1.5 text-[10px] shadow-lg backdrop-blur-sm ${
                isInput
                  ? 'border-emerald-300/35 bg-emerald-950/55 text-emerald-50'
                  : 'border-amber-300/35 bg-amber-950/55 text-amber-50'
              }`}
              style={{
                left: port.x,
                top: port.y,
                width: port.width,
                height: port.height,
              }}
              title={`${isInput ? 'Input from outside' : 'Output to outside'}: ${port.label}`}
            >
              {isInput ? (
                <>
                  <span className="min-w-0 flex-1 truncate">
                    <span className="mr-1 text-[9px] font-semibold uppercase text-emerald-100/60">
                      In
                    </span>
                    {port.label}
                  </span>
                  <span className="h-2.5 w-2.5 rounded-full border border-emerald-100/70 bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.65)]" />
                </>
              ) : (
                <>
                  <span className="h-2.5 w-2.5 rounded-full border border-amber-100/70 bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.6)]" />
                  <span className="min-w-0 flex-1 truncate text-right">
                    {port.label}
                    <span className="ml-1 text-[9px] font-semibold uppercase text-amber-100/60">
                      Out
                    </span>
                  </span>
                </>
              )}
              {port.type ? (
                <Badge
                  size="sm"
                  shrink
                  className={`!px-1 font-mono ${
                    isInput
                      ? '!border-emerald-100/20 !bg-emerald-300/10 !text-emerald-100/70'
                      : '!border-amber-100/20 !bg-amber-300/10 !text-amber-100/70'
                  }`}
                >
                  {port.type}
                </Badge>
              ) : null}
            </div>
          );
        })}

        {nodes.map((node) => {
          const pos = getNodePosition(node);
          const size = getNodeSize(node);
          const subgraph = subgraphsById.get(node.type);
          const nodeTitle = node.title || node.type;
          return (
            <button
              key={String(node.id)}
              type="button"
              aria-disabled={!subgraph}
              tabIndex={subgraph ? 0 : -1}
              onClick={(event) => {
                event.stopPropagation();
                if (!subgraph) return;
                setCurrentSubgraphPath([
                  ...currentSubgraphPath,
                  {
                    id: String(subgraph.id ?? node.type),
                    name: getGraphName(subgraph, nodeTitle),
                    inputs: getNodeInputPortSummaries(node.inputs),
                    outputs: getNodeOutputPortSummaries(node.outputs),
                  },
                ]);
              }}
              className={`absolute rounded-lg border bg-gray-900/90 p-3 text-left shadow-lg backdrop-blur-sm transition ${
                subgraph
                  ? 'cursor-pointer border-primary-300/30 hover:border-primary-200/60 hover:bg-primary-950/80'
                  : 'cursor-default border-white/10'
              }`}
              style={{ left: pos.x, top: pos.y, width: size.width, minHeight: size.height }}
              title={subgraph ? `Open ${getGraphName(subgraph, nodeTitle)}` : nodeTitle}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-white">{nodeTitle}</p>
                  <p className="mt-1 truncate font-mono text-[10px] text-gray-500">
                    #{String(node.id)}
                  </p>
                </div>
                {subgraph ? (
                  <Badge size="sm" variant="accent">
                    Subgraph
                  </Badge>
                ) : null}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-gray-500">
                <span>{node.inputs?.length ?? 0} inputs</span>
                <span className="text-right">{node.outputs?.length ?? 0} outputs</span>
              </div>
            </button>
          );
        })}
      </div>

      <CanvasViewportControls
        zoom={viewport.zoom}
        minZoom={CANVAS_MIN_ZOOM}
        maxZoom={CANVAS_MAX_ZOOM}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onFit={() => fitWorkflow(true)}
        fitTooltip="Fit workflow to view"
      />
    </div>
  );
}

export default ComfyWorkflowGraphView;
