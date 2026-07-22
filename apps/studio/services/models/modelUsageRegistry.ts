import { getRegisteredPlugins } from '@blackboard/plugin-sdk';
import type { AnyNode, ModelRequirement } from '@blackboard/types';
import type { NodeDefinition } from '@/nodes/NodeDefinition';
import { nodeRegistry } from '@/nodes/registry';

export type ModelConsumerKind = 'node-type' | 'plugin' | 'project-node';

export interface ModelConsumer {
  id: string;
  kind: ModelConsumerKind;
  label: string;
  detail: string;
  active: boolean;
  optional: boolean;
  pluginId?: string;
  pluginName?: string;
}

export interface DeclaredModelRequirement {
  requirement: ModelRequirement;
  consumers: ModelConsumer[];
}

const getStaticRequirements = (definition: NodeDefinition): ModelRequirement[] =>
  Array.isArray(definition.modelRequirements) ? definition.modelRequirements : [];

const getNodeRequirements = (definition: NodeDefinition, node: AnyNode): ModelRequirement[] => {
  if (!definition.modelRequirements) return [];
  return typeof definition.modelRequirements === 'function'
    ? definition.modelRequirements(node)
    : definition.modelRequirements;
};

const getPluginOwners = (): Map<string, { id: string; name: string }> => {
  const owners = new Map<string, { id: string; name: string }>();
  getRegisteredPlugins().forEach((plugin) => {
    plugin.nodeExtensions.forEach((extension) => {
      owners.set(extension.type, { id: plugin.id, name: plugin.name });
    });
  });
  return owners;
};

const requirementMatches = (
  requirement: ModelRequirement,
  modelKeys: ReadonlySet<string>,
): boolean =>
  modelKeys.has(requirement.modelId) ||
  Boolean(requirement.repoName && modelKeys.has(requirement.repoName));

const uniqueConsumers = (consumers: ModelConsumer[]): ModelConsumer[] => {
  const seen = new Set<string>();
  return consumers.filter((consumer) => {
    const key = `${consumer.kind}:${consumer.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const getModelConsumers = (
  modelKeys: Iterable<string>,
  projectNodes: readonly AnyNode[] = [],
): ModelConsumer[] => {
  const keys = new Set(modelKeys);
  const pluginOwners = getPluginOwners();
  const consumers: ModelConsumer[] = [];

  nodeRegistry.forEach((definition) => {
    const owner = pluginOwners.get(definition.type);
    getStaticRequirements(definition).forEach((requirement) => {
      if (!requirementMatches(requirement, keys)) return;
      consumers.push({
        id: definition.type,
        kind: 'node-type',
        label: definition.name,
        detail: requirement.purpose,
        active: false,
        optional: requirement.optional === true,
        pluginId: owner?.id,
        pluginName: owner?.name,
      });
    });
  });

  getRegisteredPlugins().forEach((plugin) => {
    plugin.modelRequirements?.forEach((requirement) => {
      if (!requirementMatches(requirement, keys)) return;
      consumers.push({
        id: plugin.id,
        kind: 'plugin',
        label: plugin.name,
        detail: requirement.purpose,
        active: false,
        optional: requirement.optional === true,
        pluginId: plugin.id,
        pluginName: plugin.name,
      });
    });
  });

  projectNodes.forEach((node) => {
    const definition = nodeRegistry.get(node.type);
    if (!definition) return;
    getNodeRequirements(definition, node).forEach((requirement) => {
      if (!requirementMatches(requirement, keys)) return;
      const owner = pluginOwners.get(definition.type);
      consumers.push({
        id: node.id,
        kind: 'project-node',
        label: node.name,
        detail: requirement.purpose,
        active: true,
        optional: requirement.optional === true,
        pluginId: owner?.id,
        pluginName: owner?.name,
      });
    });
  });

  return uniqueConsumers(consumers).sort((left, right) => {
    if (left.active !== right.active) return left.active ? -1 : 1;
    return left.label.localeCompare(right.label);
  });
};

export const getDeclaredModelRequirements = (): DeclaredModelRequirement[] => {
  const requirements = new Map<string, DeclaredModelRequirement>();
  const add = (requirement: ModelRequirement, consumer: ModelConsumer) => {
    const existing = requirements.get(requirement.modelId);
    if (existing) {
      existing.consumers = uniqueConsumers([...existing.consumers, consumer]);
      return;
    }
    requirements.set(requirement.modelId, { requirement, consumers: [consumer] });
  };

  const pluginOwners = getPluginOwners();
  nodeRegistry.forEach((definition) => {
    const owner = pluginOwners.get(definition.type);
    getStaticRequirements(definition).forEach((requirement) => {
      add(requirement, {
        id: definition.type,
        kind: 'node-type',
        label: definition.name,
        detail: requirement.purpose,
        active: false,
        optional: requirement.optional === true,
        pluginId: owner?.id,
        pluginName: owner?.name,
      });
    });
  });

  getRegisteredPlugins().forEach((plugin) => {
    plugin.modelRequirements?.forEach((requirement) => {
      add(requirement, {
        id: plugin.id,
        kind: 'plugin',
        label: plugin.name,
        detail: requirement.purpose,
        active: false,
        optional: requirement.optional === true,
        pluginId: plugin.id,
        pluginName: plugin.name,
      });
    });
  });

  return Array.from(requirements.values()).sort((left, right) =>
    left.requirement.modelName.localeCompare(right.requirement.modelName),
  );
};
