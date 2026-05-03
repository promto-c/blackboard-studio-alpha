import { AnyNode, ViewerSlot, ViewerSlotAssignments, VIEWER_SLOTS } from '@blackboard/types';
import { OUTPUT_NODE_ID } from '@/state/editor/flowModel';
import { buildMergeModel, getMergeSourceNodeId, isMergeNodeId } from '@/utils/mergeNodes';
import { buildNodeStacks } from '@/utils/nodeStacks';

export const VIEWER_SLOT_ORDER: ViewerSlot[] = [...VIEWER_SLOTS];

const getValidNodeIds = (nodes: AnyNode[]) => new Set(nodes.map((node) => node.id));

const getValidMergeIds = (nodes: AnyNode[]) =>
  new Set(buildMergeModel(buildNodeStacks(nodes)).mergeNodes.map((mergeNode) => mergeNode.mergeId));

const getValidViewerTargetIds = (nodes: AnyNode[]) => {
  const validTargetIds = getValidNodeIds(nodes);
  validTargetIds.add(OUTPUT_NODE_ID);

  const validMergeIds = getValidMergeIds(nodes);
  for (const mergeId of validMergeIds) {
    validTargetIds.add(mergeId);
  }

  return validTargetIds;
};

const resolveViewerRenderTargetNodeId = (nodes: AnyNode[], viewerNodeId: string): string | null => {
  if (viewerNodeId === OUTPUT_NODE_ID) return null;

  if (isMergeNodeId(viewerNodeId)) {
    const mergeModel = buildMergeModel(buildNodeStacks(nodes));
    const mergeNode = mergeModel.mergeNodes.find((entry) => entry.mergeId === viewerNodeId);
    if (!mergeNode) {
      return null;
    }
    const sourceStackOutputNode = mergeNode.sourceStack[mergeNode.sourceStack.length - 1];
    return sourceStackOutputNode?.id ?? getMergeSourceNodeId(viewerNodeId);
  }

  return viewerNodeId;
};

export const getViewerRenderNodes = (
  nodes: AnyNode[],
  viewerNodeId: string | null | undefined,
): AnyNode[] => {
  if (!viewerNodeId) return nodes;

  const renderTargetNodeId = resolveViewerRenderTargetNodeId(nodes, viewerNodeId);
  if (!renderTargetNodeId) return nodes;

  const viewerIndex = nodes.findIndex((node) => node.id === renderTargetNodeId);
  if (viewerIndex < 0) return nodes;

  return nodes.slice(0, viewerIndex + 1);
};

export const getViewerTargetLabel = (
  viewerNodeId: string | null | undefined,
  nodes: AnyNode[],
): string => {
  if (!viewerNodeId || viewerNodeId === OUTPUT_NODE_ID) {
    return 'Output';
  }

  const node = nodes.find((entry) => entry.id === viewerNodeId);
  if (node) {
    return node.name;
  }

  if (isMergeNodeId(viewerNodeId)) {
    const sourceNodeId = getMergeSourceNodeId(viewerNodeId);
    const sourceNode = nodes.find((entry) => entry.id === sourceNodeId);
    if (sourceNode) {
      return `Merge (${sourceNode.name})`;
    }
    return 'Merge';
  }

  return 'Missing Node';
};

export const getViewerSlotsForNode = (
  viewerSlots: ViewerSlotAssignments | undefined,
  nodeId: string,
): ViewerSlot[] => {
  if (!viewerSlots) return [];
  return VIEWER_SLOT_ORDER.filter((slot) => viewerSlots[slot] === nodeId);
};

export const assignViewerSlotToNode = (
  viewerSlots: ViewerSlotAssignments | undefined,
  slot: ViewerSlot,
  nodeId: string,
): ViewerSlotAssignments => {
  const nextSlots: ViewerSlotAssignments = { ...viewerSlots };

  for (const existingSlot of VIEWER_SLOT_ORDER) {
    if (existingSlot !== slot && nextSlots[existingSlot] === nodeId) {
      delete nextSlots[existingSlot];
    }
  }

  nextSlots[slot] = nodeId;
  return nextSlots;
};

export const sanitizeViewerSlots = (
  viewerSlots: ViewerSlotAssignments | undefined,
  nodes: AnyNode[],
): ViewerSlotAssignments => {
  const validTargetIds = getValidViewerTargetIds(nodes);
  const nextSlots: ViewerSlotAssignments = {};
  const assignedNodeIds = new Set<string>();

  for (const slot of VIEWER_SLOT_ORDER) {
    const nodeId = viewerSlots?.[slot];
    if (!nodeId || !validTargetIds.has(nodeId) || assignedNodeIds.has(nodeId)) {
      continue;
    }

    nextSlots[slot] = nodeId;
    assignedNodeIds.add(nodeId);
  }

  return nextSlots;
};

export const sanitizeViewerNodeId = (
  viewerNodeId: string | null | undefined,
  nodes: AnyNode[],
): string | null => {
  if (!viewerNodeId) return null;
  const validTargetIds = getValidViewerTargetIds(nodes);
  return validTargetIds.has(viewerNodeId) ? viewerNodeId : null;
};

export const sanitizeActiveViewerSlot = (
  activeViewerSlot: ViewerSlot | null | undefined,
  viewerSlots: ViewerSlotAssignments,
  viewerNodeId: string | null,
): ViewerSlot | null => {
  if (!activeViewerSlot) return null;
  if (!viewerNodeId) return null;
  return viewerSlots[activeViewerSlot] === viewerNodeId ? activeViewerSlot : null;
};
