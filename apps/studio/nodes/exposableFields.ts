import {
  UniformUIType,
  type AnimatableNumber,
  type AnyNode,
  type AnyUniform,
} from '@blackboard/types';
import { getImmutable } from '@blackboard/renderer';
import type {
  NodeDefinition,
  NodeExposableFieldControl,
  NodeExposableFieldDescriptor,
} from './NodeDefinition';

const STRUCTURAL_FIELDS = new Set([
  'childFlowId',
  'externalInputs',
  'exposedFields',
  'inputNodeId',
  'inputs',
  'inputSourcePorts',
  'outputNodeId',
]);

const humanizeFieldName = (name: string): string =>
  name
    .replace(/^u_/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (character) => character.toUpperCase());

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const isAnimatableNumber = (value: unknown): value is AnimatableNumber =>
  typeof value === 'number' ||
  (Array.isArray(value) &&
    value.every(
      (entry) =>
        isRecord(entry) && typeof entry.frame === 'number' && typeof entry.value === 'number',
    ));

const uniformControl = (uniform: AnyUniform): NodeExposableFieldControl => {
  switch (uniform.ui) {
    case UniformUIType.SLIDER:
      return 'slider';
    case UniformUIType.COLOR:
      return 'color';
    case UniformUIType.TOGGLE:
      return 'toggle';
    case UniformUIType.SEGMENTED:
      return 'select';
    default:
      return 'number';
  }
};

const getUniformFields = (node: AnyNode): NodeExposableFieldDescriptor[] => {
  if (!('uniforms' in node) || !isRecord(node.uniforms)) return [];

  return Object.entries(node.uniforms).flatMap(([name, candidate]) => {
    if (!isRecord(candidate) || typeof candidate.label !== 'string' || !('ui' in candidate)) {
      return [];
    }

    const uniform = candidate as unknown as AnyUniform;
    return [
      {
        path: `uniforms.${name}.value`,
        label: uniform.label,
        section: 'Parameters',
        control: uniformControl(uniform),
        ...('min' in uniform ? { min: uniform.min } : {}),
        ...('max' in uniform ? { max: uniform.max } : {}),
        ...('step' in uniform ? { step: uniform.step } : {}),
        ...('options' in uniform ? { options: uniform.options } : {}),
        animatable: uniform.ui === UniformUIType.SLIDER,
      },
    ];
  });
};

const inferPrimitiveField = (
  node: AnyNode,
  path: string,
  key: string,
  section: string,
  defaultValue: unknown,
): NodeExposableFieldDescriptor | null => {
  const currentValue = getImmutable(node, path);

  if (typeof defaultValue === 'number' && isAnimatableNumber(currentValue)) {
    return {
      path,
      label: humanizeFieldName(key),
      section,
      control: 'number',
      animatable: Array.isArray(currentValue),
    };
  }
  if (typeof defaultValue === 'boolean' && typeof currentValue === 'boolean') {
    return { path, label: humanizeFieldName(key), section, control: 'toggle' };
  }
  if (typeof defaultValue === 'string' && typeof currentValue === 'string') {
    return { path, label: humanizeFieldName(key), section, control: 'text' };
  }
  if (
    Array.isArray(defaultValue) &&
    defaultValue.length === 3 &&
    defaultValue.every((value) => typeof value === 'number') &&
    Array.isArray(currentValue) &&
    currentValue.length === 3 &&
    currentValue.every((value) => typeof value === 'number') &&
    /colou?r|tint/i.test(key)
  ) {
    return { path, label: humanizeFieldName(key), section, control: 'color' };
  }
  return null;
};

const getInitialStateFields = (
  node: AnyNode,
  definition: NodeDefinition,
): NodeExposableFieldDescriptor[] => {
  const defaults = definition.getInitialNodeProps?.();
  if (!isRecord(defaults)) return [];

  const fields: NodeExposableFieldDescriptor[] = [];
  const visit = (value: unknown, path: string, section: string, depth: number) => {
    if (!isRecord(value) || depth > 4) return;

    Object.entries(value).forEach(([key, childValue]) => {
      if (STRUCTURAL_FIELDS.has(key)) return;
      const childPath = path ? `${path}.${key}` : key;
      if (childPath.startsWith('uniforms.')) return;

      const primitive = inferPrimitiveField(node, childPath, key, section, childValue);
      if (primitive) {
        fields.push(primitive);
        return;
      }

      if (isRecord(childValue)) {
        visit(childValue, childPath, humanizeFieldName(key), depth + 1);
      }
    });
  };

  visit(defaults, '', 'Parameters', 0);
  return fields;
};

/**
 * Resolve the editable fields a node can surface through a Group inspector.
 * Definition metadata wins, while registry animation metadata and ordinary
 * initial node props provide broad automatic coverage.
 */
export const resolveNodeExposableFields = (
  node: AnyNode,
  definition: NodeDefinition,
): NodeExposableFieldDescriptor[] => {
  const declared = definition.exposableFields
    ? typeof definition.exposableFields === 'function'
      ? definition.exposableFields(node)
      : definition.exposableFields
    : [];
  const animated =
    definition.animation?.getAnimatableProperties?.(node).map((property) => ({
      path: property.path,
      label: property.name,
      section: property.group,
      control: 'number' as const,
      animatable: true,
    })) ?? [];

  const uniqueFields = new Map<string, NodeExposableFieldDescriptor>();
  [
    ...declared,
    ...getUniformFields(node),
    ...animated,
    ...getInitialStateFields(node, definition),
  ].forEach((field) => {
    if (!uniqueFields.has(field.path)) uniqueFields.set(field.path, field);
  });
  return Array.from(uniqueFields.values());
};
