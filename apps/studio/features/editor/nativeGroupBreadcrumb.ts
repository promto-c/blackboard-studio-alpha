import { NodeType } from '@blackboard/types';

export type NativeGroupPathItem = { flowId: string; nodeId: string; name: string };

type FlowLookup = Record<
  string,
  { nodes: Array<{ id: string; type: string; childFlowId?: string | null }> }
>;

const isSameNativeGroupPathTarget = (
  a: NativeGroupPathItem | undefined,
  b: NativeGroupPathItem | undefined,
): boolean => !!a && !!b && a.flowId === b.flowId && a.nodeId === b.nodeId;

const isNativeGroupPathPrefix = (
  prefix: NativeGroupPathItem[],
  path: NativeGroupPathItem[],
): boolean =>
  prefix.length <= path.length &&
  prefix.every((item, index) => isSameNativeGroupPathTarget(item, path[index]));

export const areNativeGroupPathsEqual = (
  a: NativeGroupPathItem[],
  b: NativeGroupPathItem[],
): boolean =>
  a.length === b.length &&
  a.every(
    (item, index) =>
      item.flowId === b[index]?.flowId &&
      item.nodeId === b[index]?.nodeId &&
      item.name === b[index]?.name,
  );

export const validateNativeGroupPath = (
  path: NativeGroupPathItem[],
  flows: FlowLookup,
  rootFlowId: string | null,
): NativeGroupPathItem[] => {
  if (!rootFlowId || !flows[rootFlowId]) return [];

  let parentFlowId = rootFlowId;
  const validPath: NativeGroupPathItem[] = [];
  for (const item of path) {
    const parentFlow = flows[parentFlowId];
    const groupNode = parentFlow?.nodes.find(
      (node) =>
        node.id === item.nodeId && node.type === NodeType.GROUP && node.childFlowId === item.flowId,
    );
    if (!groupNode || !flows[item.flowId]) break;
    validPath.push(item);
    parentFlowId = item.flowId;
  }

  return validPath;
};

export const getRecentNativeGroupBreadcrumbPath = (
  activePath: NativeGroupPathItem[],
  rememberedPath: NativeGroupPathItem[],
  flows: FlowLookup,
  rootFlowId: string | null,
  options: { preserveRecentPath?: boolean } = {},
): NativeGroupPathItem[] => {
  const validRememberedPath = validateNativeGroupPath(rememberedPath, flows, rootFlowId);
  if (activePath.length === 0) {
    return options.preserveRecentPath === false ? [] : validRememberedPath;
  }

  if (!isNativeGroupPathPrefix(activePath, validRememberedPath)) {
    return activePath;
  }

  return options.preserveRecentPath === false
    ? activePath
    : [...activePath, ...validRememberedPath.slice(activePath.length)];
};
