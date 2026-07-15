import type { AnyNode } from '@blackboard/types';
import { nodeRegistry } from '@/nodes/registry';
import { getInputPorts } from '@/nodes/helpers';
import { getInputPortKey, getOutputPortKey } from './nodePortKeys';

export const buildNodePortColorMap = (nodes: readonly AnyNode[]): ReadonlyMap<string, string> => {
  const colors = new Map<string, string>();

  for (const node of nodes) {
    for (const port of getInputPorts(node)) {
      if (port.color) colors.set(getInputPortKey(node.id, port.name), port.color);
    }

    const outputPorts = nodeRegistry.get(node.type)?.outputPorts;
    const resolvedOutputPorts = typeof outputPorts === 'function' ? outputPorts(node) : outputPorts;
    for (const port of resolvedOutputPorts ?? []) {
      if (port.color) colors.set(getOutputPortKey(node.id, port.name), port.color);
    }
  }

  return colors;
};
