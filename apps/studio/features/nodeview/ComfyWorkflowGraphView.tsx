import React, { useEffect, useMemo, useState } from 'react';
import { ComfyWorkflow } from '@blackboard/types';
import { useCanvasViewport } from '@/hooks/useCanvasViewport';
import CanvasGrid from './CanvasGrid';

type JsonObject = Record<string, unknown>;

interface ComfyGraphNode {
  id: string | number;
  type: string;
  pos?: [number, number] | number[];
  size?: [number, number] | number[];
  title?: string;
  inputs?: Array<{ name?: string; link?: number | string | null }>;
  outputs?: Array<{ name?: string; links?: Array<number | string> | null }>;
}

interface ComfyGraphLink {
  id: string;
  originId: string;
  originSlot: number;
  targetId: string;
  targetSlot: number;
}

export interface ComfyGraphPathItem {
  id: string;
  name: string;
}

interface ComfyGraphLevel extends ComfyGraphPathItem {
  graph: JsonObject;
}

interface ComfyWorkflowGraphViewProps {
  workflow: ComfyWorkflow;
  subgraphPath?: ComfyGraphPathItem[];
  onSubgraphPathChange?: (path: ComfyGraphPathItem[]) => void;
}

const NODE_WIDTH = 220;
const NODE_MIN_HEIGHT = 74;

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getGraphNodes = (graph: JsonObject): ComfyGraphNode[] =>
  Array.isArray(graph.nodes)
    ? graph.nodes.filter((node): node is ComfyGraphNode => {
        return isJsonObject(node) && typeof node.type === 'string';
      })
    : [];

const getGraphLinks = (graph: JsonObject): ComfyGraphLink[] => {
  const links = Array.isArray(graph.links) ? graph.links : [];
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
  typeof graph.name === 'string' && graph.name.trim() ? graph.name : fallback;

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

const ComfyWorkflowGraphView: React.FC<ComfyWorkflowGraphViewProps> = ({
  workflow,
  subgraphPath,
  onSubgraphPathChange,
}) => {
  const sourceGraph = workflow.sourceGraph;
  const subgraphsById = useMemo(() => getSubgraphsById(workflow), [workflow]);
  const [localSubgraphPath, setLocalSubgraphPath] = useState<ComfyGraphPathItem[]>([]);
  const currentSubgraphPath = subgraphPath ?? localSubgraphPath;
  const setCurrentSubgraphPath = onSubgraphPathChange ?? setLocalSubgraphPath;
  const { viewport, containerRef, getTransformStyle, fitAll, handleMouseDown, getCursorStyle } =
    useCanvasViewport();

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
  const bounds = useMemo(() => getBounds(nodes), [nodes]);
  const svgPadding = 300;

  useEffect(() => {
    const timer = window.setTimeout(
      () => fitAll(bounds, { top: 16, left: 16, right: 16, bottom: 16 }),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [bounds, fitAll, currentLevel?.id]);

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
      className="relative h-full w-full overflow-hidden"
      style={{ cursor: getCursorStyle() }}
      onMouseDown={handleMouseDown}
    >
      <CanvasGrid zoom={viewport.zoom} />

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
            if (!source || !target) return null;
            const sourcePos = getNodePosition(source);
            const sourceSize = getNodeSize(source);
            const targetPos = getNodePosition(target);
            const x1 = sourcePos.x + sourceSize.width - bounds.minX + svgPadding;
            const y1 = getPortY(source, link.originSlot, 'output') - bounds.minY + svgPadding;
            const x2 = targetPos.x - bounds.minX + svgPadding;
            const y2 = getPortY(target, link.targetSlot, 'input') - bounds.minY + svgPadding;
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

        {nodes.map((node) => {
          const pos = getNodePosition(node);
          const size = getNodeSize(node);
          const subgraph = subgraphsById.get(node.type);
          const nodeTitle = node.title || node.type;
          return (
            <button
              key={String(node.id)}
              type="button"
              disabled={!subgraph}
              onClick={(event) => {
                event.stopPropagation();
                if (!subgraph) return;
                setCurrentSubgraphPath([
                  ...currentSubgraphPath,
                  {
                    id: String(subgraph.id ?? node.type),
                    name: getGraphName(subgraph, nodeTitle),
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
                  <span className="rounded-md border border-primary-300/20 bg-primary-300/10 px-1.5 py-0.5 text-[10px] font-medium text-primary-100">
                    Subgraph
                  </span>
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
    </div>
  );
};

export default ComfyWorkflowGraphView;
