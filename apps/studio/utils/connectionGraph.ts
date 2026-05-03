import type { AnyNode } from '@blackboard/types';

/**
 * Check whether connecting `sourceId` as an input to `consumerId`
 * would create a cycle in the flow graph.
 * Uses BFS from the source node through its own inputs.
 */
export function wouldCreateCycle(nodes: AnyNode[], consumerId: string, sourceId: string): boolean {
  const visited = new Set<string>();
  const queue = [sourceId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === consumerId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const node = nodes.find((candidate) => candidate.id === current);
    if (node?.inputs) {
      for (const refId of Object.values(node.inputs)) {
        queue.push(refId);
      }
    }
  }
  return false;
}

/** Returns all input connections for a node as an array. */
export function getInputConnections(node: AnyNode): { portName: string; sourceNodeId: string }[] {
  if (!node.inputs) return [];
  return Object.entries(node.inputs)
    .filter(([, sourceId]) => !!sourceId)
    .map(([portName, sourceNodeId]) => ({ portName, sourceNodeId }));
}

/** Returns all nodes that reference `nodeId` in their inputs. */
export function getOutputConnections(
  nodes: AnyNode[],
  nodeId: string,
): { node: AnyNode; portName: string }[] {
  const results: { node: AnyNode; portName: string }[] = [];
  for (const node of nodes) {
    if (!node.inputs) continue;
    for (const [portName, sourceId] of Object.entries(node.inputs)) {
      if (sourceId === nodeId) {
        results.push({ node, portName });
      }
    }
  }
  return results;
}

/**
 * Clean up dangling input references after nodes have been deleted.
 * Returns a new array if any references were removed, otherwise returns the original.
 */
export function cleanDanglingNodeInputs(nodes: AnyNode[], deletedIds: Set<string>): AnyNode[] {
  let changed = false;
  const cleaned = nodes.map((node) => {
    if (!node.inputs) return node;
    const newInputs = { ...node.inputs };
    let nodeChanged = false;
    for (const [port, sourceId] of Object.entries(newInputs)) {
      if (deletedIds.has(sourceId)) {
        delete newInputs[port];
        nodeChanged = true;
      }
    }
    if (nodeChanged) {
      changed = true;
      return { ...node, inputs: Object.keys(newInputs).length > 0 ? newInputs : undefined };
    }
    return node;
  });
  return changed ? cleaned : nodes;
}
