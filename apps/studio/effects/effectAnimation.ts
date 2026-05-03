import type { AnimatableNumber, AnyNode } from '@blackboard/types';

import { effectRegistry } from './effectRegistry';
import {
  setDefaultKeyframeValue,
  type AnimatablePropertiesOptions,
  type AnimatablePropertyDef,
} from './effectAnimationHelpers';

export type { AnimatablePropertiesOptions, AnimatablePropertyDef } from './effectAnimationHelpers';

export const setKeyframeValue = (
  nodes: AnyNode[],
  nodeId: string,
  propertyPath: string,
  frame: number,
  value?: number,
): AnyNode[] => {
  const layerIndex = nodes.findIndex((node) => node.id === nodeId);
  if (layerIndex === -1) return nodes;

  const node = nodes[layerIndex];
  const animation = effectRegistry.get(node.type)?.animation;
  const newNode =
    animation?.setKeyframeValue?.(node, propertyPath, frame, value) ??
    setDefaultKeyframeValue(node, propertyPath, frame, value);

  if (!newNode) {
    return nodes;
  }

  const newNodes = [...nodes];
  newNodes[layerIndex] = newNode;
  return newNodes;
};

export const getAnimatableProperties = (
  node: AnyNode | undefined,
  options?: AnimatablePropertiesOptions,
): AnimatablePropertyDef[] => {
  if (!node) return [];

  const props: AnimatablePropertyDef[] = [];

  const addProp = (
    name: string,
    path: string,
    prop: AnimatableNumber | undefined,
    group: string,
    trackingData?: { [frame: number]: number },
  ) => {
    if (prop !== undefined) {
      props.push({ name, path, prop, group, trackingData });
    }
  };

  if ('opacity' in node) {
    addProp('Opacity', 'opacity', node.opacity, 'General');
  }

  const effectProps = effectRegistry
    .get(node.type)
    ?.animation?.getAnimatableProperties?.(node, options);
  if (effectProps) {
    props.push(...effectProps);
  }

  return props;
};
