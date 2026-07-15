import { AnyNode, NodeType } from '@blackboard/types';
import { nodeRegistry } from '@/nodes/registry';
import { isSourceNodeType } from '@/utils/nodePredicates';
import { estimateNodeHeight } from '@/utils/autoLayoutGraph';

/** Result of computing a preview placeholder entry. */
export interface PreviewEntry {
  nodeType: NodeType;
  name: string;
  isMerge: boolean;
}

/**
 * Build a preview entry for a hovered node type, determining whether a
 * merge node would also be created based on connected source stacks.
 *
 * Returns null when no preview is relevant (previewNodeType is null).
 */
export function computePreviewEntry(
  previewNodeType: NodeType | null,
  stacks: AnyNode[][],
  connectedNodeIds: ReadonlySet<string>,
): PreviewEntry | null {
  if (!previewNodeType) return null;

  const definition = nodeRegistry.get(previewNodeType);
  const name = definition?.name ?? previewNodeType;

  const isMerge =
    isSourceNodeType(previewNodeType) &&
    stacks.some((stack) => isSourceNodeType(stack[0].type) && connectedNodeIds.has(stack[0].id));

  return { nodeType: previewNodeType, name, isMerge };
}

/**
 * Find the insertion index in a flat array of stacks (with hidden merges
 * filtered out) for placing a preview after the selected node.
 * Fallback to end of array when there is no selection or the selected
 * node is not found.
 */
export function findPreviewInsertIndex(
  filteredStacks: AnyNode[][],
  selectedNodeId: string | null,
): number {
  if (!selectedNodeId) return filteredStacks.length;
  const idx = filteredStacks.findIndex((s) => s[0]?.id === selectedNodeId);
  return idx >= 0 ? idx + 1 : filteredStacks.length;
}

/**
 * Compute a position for a preview card in graph space, placed after
 * the selected node's stack (or below the lowest stack as fallback).
 */
export function computeGraphPreviewPosition(
  nodeStacks: AnyNode[][],
  nodePositions: Record<string, { x: number; y: number }>,
  stackMap: Map<string, AnyNode[]>,
  selectedNodeId: string | null,
): { x: number; y: number } {
  // Try after selected node first
  if (selectedNodeId) {
    const selectedStack = nodeStacks.find((s) => s[0]?.id === selectedNodeId);
    if (selectedStack) {
      const p = nodePositions[selectedStack[0].id];
      if (p) {
        return {
          x: p.x,
          y: p.y + estimateNodeHeight(selectedStack[0].id, stackMap) + 24,
        };
      }
    }
  }

  // Fallback: below the lowest stack node
  let posX = 0;
  let posY = 0;
  for (const stack of nodeStacks) {
    const baseNode = stack[0];
    const p = nodePositions[baseNode.id];
    if (p) {
      const h = estimateNodeHeight(baseNode.id, stackMap);
      if (p.y + h > posY) {
        posX = p.x;
        posY = p.y + h;
      }
    }
  }
  return { x: posX, y: posY + 24 };
}
