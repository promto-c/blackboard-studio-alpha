import { AnyNode, NodeType } from '@blackboard/types';
import { OUTPUT_NODE_ID } from '@/state/editor/flowModel';
import { buildMergeModel, getMergeSourceNodeId, isMergeNodeId } from '@/utils/mergeNodes';

export const NODE_WIDTH = 192;
export const VERTICAL_GAP = 60;
export const HORIZONTAL_GAP = 60;

/** Approximate fixed-height cards (output, merge; scene uses the fallback only). */
const SCENE_NODE_HEIGHT = 76;
const OUTPUT_NODE_HEIGHT = 64;
const MERGE_NODE_HEIGHT = 76;

/** Per-node row inside a StackNodeCard: icon row + padding. */
const STACK_ROW_HEIGHT = 44;
/** Extra height added when a node row shows a media thumbnail (h-20 = 80px). */
const THUMBNAIL_EXTRA_HEIGHT = 88;
/** Outer padding of a StackNodeCard (p-2 top + bottom + gap). */
const STACK_CARD_PADDING = 20;

/** Returns true if the node type displays a media thumbnail in the graph view. */
function hasMediaThumbnail(node: AnyNode): boolean {
  return (
    node.type === NodeType.IMAGE ||
    node.type === NodeType.VIDEO ||
    node.type === NodeType.IMAGE_SEQUENCE
  );
}

/** Estimate the rendered pixel height of a stack card. */
export function estimateStackHeight(stack: AnyNode[]): number {
  let h = STACK_CARD_PADDING;
  for (const node of stack) {
    h += STACK_ROW_HEIGHT;
    if (hasMediaThumbnail(node)) {
      h += THUMBNAIL_EXTRA_HEIGHT;
    }
  }
  return h;
}

/** Estimate the rendered pixel height for any positioned node ID. */
export function estimateNodeHeight(nodeId: string, stackMap: Map<string, AnyNode[]>): number {
  if (nodeId === OUTPUT_NODE_ID) return OUTPUT_NODE_HEIGHT;
  if (isMergeNodeId(nodeId)) return MERGE_NODE_HEIGHT;
  const stack = stackMap.get(nodeId);
  if (stack) return estimateStackHeight(stack);
  // Scene or unknown — use scene height as fallback
  return SCENE_NODE_HEIGHT;
}

/** Build a lookup from base-node-id -> stack. */
export function buildStackMap(layerStacks: AnyNode[][]): Map<string, AnyNode[]> {
  const map = new Map<string, AnyNode[]>();
  for (const stack of layerStacks) {
    map.set(stack[0].id, stack);
  }
  return map;
}

const DEFAULT_MERGE_SOURCE_OFFSET = {
  x: -(NODE_WIDTH + HORIZONTAL_GAP),
  y: 0,
};

/**
 * Compute auto-layout positions for all nodes in the node graph.
 *
 * Creates a single vertical column pipeline matching the node view order:
 *   Stack1 -> Stack2 -> ... -> StackN -> Output
 *
 * Scene is intentionally omitted from the graph pipeline. It behaves like a
 * global rule/control and is rendered as a pinned overlay in the graph view.
 *
 * Every source after the first source in the flow gets its own virtual merge
 * node. The source stack is placed on a side branch and the merge node stays
 * in the main column.
 */
export function computeAutoLayout(
  _nodes: AnyNode[],
  layerStacks: AnyNode[][],
): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};

  if (_nodes.length === 0) return positions;

  if (layerStacks.length === 0) {
    positions[OUTPUT_NODE_ID] = { x: -NODE_WIDTH / 2, y: 0 };
    return positions;
  }

  const mergeModel = buildMergeModel(layerStacks);

  // Single vertical column, all centered at x=0
  const centerX = -NODE_WIDTH / 2;
  let currentY = 0;

  // Track the Y of the last node placed in the main column so merge
  // sources can be aligned beside it.
  let lastMainY = 0;
  let lastMainHeight = 0;

  // Place stacks, handling per-source merge nodes
  for (const stack of layerStacks) {
    const baseNode = stack[0];
    const mergeInfo = mergeModel.info.get(baseNode.id);
    const stackHeight = estimateStackHeight(stack);

    if (mergeInfo?.isMergeSource && mergeInfo.mergeId) {
      // Source node to the left, at the same Y as the previous main-pipe node.
      positions[baseNode.id] = {
        x: centerX + DEFAULT_MERGE_SOURCE_OFFSET.x,
        y: lastMainY,
      };
      // Merge node below both, in the main column.
      const rowBottom = lastMainY + Math.max(lastMainHeight, stackHeight);
      const mergeY = rowBottom + VERTICAL_GAP;
      positions[mergeInfo.mergeId] = { x: centerX, y: mergeY };
      lastMainY = mergeY;
      lastMainHeight = MERGE_NODE_HEIGHT;
      currentY = mergeY + MERGE_NODE_HEIGHT + VERTICAL_GAP;
      continue;
    }

    positions[baseNode.id] = { x: centerX, y: currentY };
    lastMainY = currentY;
    lastMainHeight = stackHeight;
    currentY += stackHeight + VERTICAL_GAP;
  }

  // Place Output
  positions[OUTPUT_NODE_ID] = { x: centerX, y: currentY };

  return positions;
}

/**
 * Build the ordered pipeline of node IDs matching the node graph order.
 * Stack1 -> Stack2 -> Merge2 -> Stack3 -> Merge3 -> ... -> Output
 */
export function buildPipelineOrder(_nodes: AnyNode[], layerStacks: AnyNode[][]): string[] {
  const ids: string[] = [];

  const mergeModel = buildMergeModel(layerStacks);
  for (const stack of layerStacks) {
    const baseNode = stack[0];
    ids.push(baseNode.id);

    const mergeInfo = mergeModel.info.get(baseNode.id);
    if (mergeInfo?.isMergeSource && mergeInfo.mergeId) {
      ids.push(mergeInfo.mergeId);
    }
  }

  ids.push(OUTPUT_NODE_ID);
  return ids;
}

/**
 * Place newly-added nodes into the existing layout, shifting downstream
 * neighbours so nothing overlaps.
 *
 * For each missing node we:
 *   1. Find its predecessor and successor in the pipeline.
 *   2. Place it between them (midpoint, or offset from predecessor).
 *   3. If it would overlap the successor (closer than VERTICAL_GAP),
 *      push all downstream nodes away by the required amount.
 *
 * Works for top-down (increasing Y) layouts.
 * Note that callers may omit the direction; top-down is the default and should be
 * used for the node graph view which no longer supports reversing the flow.
 */
export function placeNewNodes(
  existingPositions: Record<string, { x: number; y: number }>,
  missingIds: string[],
  pipelineOrder: string[],
  layerStacks: AnyNode[][],
): Record<string, { x: number; y: number }> {
  const positions = { ...existingPositions };
  const mergeModel = buildMergeModel(layerStacks);
  const stackMap = buildStackMap(layerStacks);

  // Process missing IDs in pipeline order so earlier placements are seen by later ones
  const orderedMissing = pipelineOrder.filter((id) => missingIds.includes(id));

  for (const missingId of orderedMissing) {
    if (positions[missingId]) {
      continue;
    }

    const idx = pipelineOrder.indexOf(missingId);

    // Find nearest predecessor & successor that already have positions
    let predId: string | null = null;
    let predPos: { x: number; y: number } | null = null;
    for (let i = idx - 1; i >= 0; i--) {
      if (positions[pipelineOrder[i]]) {
        predId = pipelineOrder[i];
        predPos = positions[pipelineOrder[i]];
        break;
      }
    }
    let succId: string | null = null;
    let succPos: { x: number; y: number } | null = null;
    for (let i = idx + 1; i < pipelineOrder.length; i++) {
      if (positions[pipelineOrder[i]]) {
        succId = pipelineOrder[i];
        succPos = positions[pipelineOrder[i]];
        break;
      }
    }

    // Determine X (use predecessor's X, or successor's, or default center)
    const x = predPos?.x ?? succPos?.x ?? -NODE_WIDTH / 2;

    // Height of predecessor for spacing
    const predHeight = predId ? estimateNodeHeight(predId, stackMap) : 0;
    const missingHeight = estimateNodeHeight(missingId, stackMap);
    const spacing = VERTICAL_GAP;

    // Newly-added merge sources sit to the left at the predecessor's Y,
    // with the merge node below both in the main column.
    const mergeInfo = mergeModel.info.get(missingId);
    if (mergeInfo?.isMergeSource && mergeInfo.mergeId) {
      const mergeId = mergeInfo.mergeId;

      // Source at same Y as predecessor, offset left
      const sourceX = (predPos?.x ?? succPos?.x ?? -NODE_WIDTH / 2) + DEFAULT_MERGE_SOURCE_OFFSET.x;
      let sourceY: number;
      if (predPos) {
        sourceY = predPos.y;
      } else if (succPos) {
        sourceY = succPos.y - missingHeight - MERGE_NODE_HEIGHT - spacing * 2;
      } else {
        sourceY = 0;
      }

      positions[missingId] = { x: sourceX, y: sourceY };

      // Merge below both predecessor and source
      const mainX = predPos?.x ?? succPos?.x ?? -NODE_WIDTH / 2;
      const rowBottom = sourceY + Math.max(predHeight, missingHeight);
      const mergeY = rowBottom + spacing;
      positions[mergeId] = { x: mainX, y: mergeY };

      if (succPos && succId) {
        const gap = succPos.y - (mergeY + MERGE_NODE_HEIGHT);
        if (gap < spacing) {
          const shift = spacing - gap;
          for (let i = pipelineOrder.indexOf(succId); i < pipelineOrder.length; i++) {
            const nodeId = pipelineOrder[i];
            if (positions[nodeId]) {
              positions[nodeId] = {
                x: positions[nodeId].x,
                y: positions[nodeId].y + shift,
              };
            }
          }
        }
      }

      continue;
    }

    if (isMergeNodeId(missingId)) {
      const sourceNodeId = getMergeSourceNodeId(missingId);
      const sourcePos = positions[sourceNodeId];

      if (sourcePos) {
        // Merge below the source in the main column
        const sourceHeight = estimateNodeHeight(sourceNodeId, stackMap);
        const mergeX = sourcePos.x - DEFAULT_MERGE_SOURCE_OFFSET.x;
        const mergeY = sourcePos.y + sourceHeight + spacing;
        positions[missingId] = { x: mergeX, y: mergeY };

        if (succPos && succId) {
          const gap = succPos.y - (mergeY + MERGE_NODE_HEIGHT);
          if (gap < spacing) {
            const shift = spacing - gap;
            for (let i = pipelineOrder.indexOf(succId); i < pipelineOrder.length; i++) {
              const nodeId = pipelineOrder[i];
              if (positions[nodeId]) {
                positions[nodeId] = {
                  x: positions[nodeId].x,
                  y: positions[nodeId].y + shift,
                };
              }
            }
          }
        }

        continue;
      }
    }

    // Determine Y: place after predecessor accounting for its height
    let y: number;
    if (predPos) {
      y = predPos.y + predHeight + spacing;
    } else if (succPos) {
      y = succPos.y - missingHeight - spacing;
    } else {
      y = 0;
    }

    positions[missingId] = { x, y };

    // Now check overlap with the successor and shift downstream if needed
    if (succPos && succId) {
      const gap = succPos.y - (y + missingHeight);
      if (gap < spacing) {
        const shift = spacing - gap;
        // Shift all nodes from successor onward in the pipeline
        for (let i = pipelineOrder.indexOf(succId); i < pipelineOrder.length; i++) {
          const nodeId = pipelineOrder[i];
          if (positions[nodeId]) {
            positions[nodeId] = {
              x: positions[nodeId].x,
              y: positions[nodeId].y + shift,
            };
          }
        }
      }
    }
  }

  return positions;
}
