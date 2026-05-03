import { AnyNode, NodeType } from '@blackboard/types';
import { isSourceNodeType } from '@/utils/nodePredicates';

export const MERGE_NODE_PREFIX = '@merge-';

export interface MergeStackInfo {
  stackId: string;
  sourceOrder: number | null;
  isMergeSource: boolean;
  mergeId: string | null;
  anchorStackId: string | null;
  totalSourceCount: number;
}

export interface MergeNodeData {
  mergeId: string;
  sourceStack: AnyNode[];
  anchorStackId: string;
  sourceOrder: number;
}

export interface MergeChain {
  anchorStackId: string;
  sourceStackIds: string[];
}

export interface MergeModel {
  chain: MergeChain | null;
  info: Map<string, MergeStackInfo>;
  mergeNodes: MergeNodeData[];
}

function isSourceStack(stack: AnyNode[]): boolean {
  const baseNode = stack[0];
  return (
    baseNode.type !== NodeType.SCENE &&
    !baseNode.detachedFromPipe &&
    isSourceNodeType(baseNode.type)
  );
}

export function getMergeNodeId(sourceNodeId: string): string {
  return `${MERGE_NODE_PREFIX}${sourceNodeId}`;
}

export function isMergeNodeId(nodeId: string | null | undefined): boolean {
  return !!nodeId && nodeId.startsWith(MERGE_NODE_PREFIX);
}

export function getMergeSourceNodeId(mergeId: string): string {
  return mergeId.replace(new RegExp(`^${MERGE_NODE_PREFIX}`), '');
}

export function buildMergeModel(stacks: AnyNode[][]): MergeModel {
  const sourceStacks = stacks.filter(isSourceStack);
  const sourceStackIds = sourceStacks.map((stack) => stack[0].id);
  const anchorStackId = sourceStackIds[0] ?? null;
  const totalSourceCount = sourceStackIds.length;
  const chain =
    anchorStackId && totalSourceCount > 1
      ? {
          anchorStackId,
          sourceStackIds,
        }
      : null;

  const info = new Map<string, MergeStackInfo>();
  const mergeNodes: MergeNodeData[] = [];
  let sourceOrder = 0;

  for (const stack of stacks) {
    const baseNode = stack[0];

    if (!isSourceStack(stack)) {
      info.set(baseNode.id, {
        stackId: baseNode.id,
        sourceOrder: null,
        isMergeSource: false,
        mergeId: null,
        anchorStackId,
        totalSourceCount,
      });
      continue;
    }

    const isMergeSource = sourceOrder > 0;
    const mergeId = isMergeSource ? getMergeNodeId(baseNode.id) : null;

    info.set(baseNode.id, {
      stackId: baseNode.id,
      sourceOrder,
      isMergeSource,
      mergeId,
      anchorStackId,
      totalSourceCount,
    });

    if (isMergeSource && anchorStackId && mergeId) {
      mergeNodes.push({
        mergeId,
        sourceStack: stack,
        anchorStackId,
        sourceOrder,
      });
    }

    sourceOrder += 1;
  }

  return {
    chain,
    info,
    mergeNodes,
  };
}

export function resolveMergeSourceStack(mergeId: string, stacks: AnyNode[][]): AnyNode[] | null {
  const sourceNodeId = getMergeSourceNodeId(mergeId);
  const mergeModel = buildMergeModel(stacks);
  const mergeInfo = mergeModel.info.get(sourceNodeId);

  if (!mergeInfo?.isMergeSource) {
    return null;
  }

  return stacks.find((stack) => stack[0].id === sourceNodeId) ?? null;
}
