import type { AnimatableNumber, AnyNode } from '@blackboard/types';
import { getImmutable, setImmutable, setKeyframeOnValue } from '@blackboard/renderer';

export interface AnimatablePropertyDef {
  name: string;
  path: string;
  prop: AnimatableNumber;
  group: string;
  trackingData?: { [frame: number]: number };
}

export interface AnimatablePropertiesOptions {
  selectedRotoPathIds?: string[];
}

export interface EffectAnimationBehavior {
  getAnimatableProperties?: (
    node: AnyNode,
    options?: AnimatablePropertiesOptions,
  ) => AnimatablePropertyDef[];
  setKeyframeValue?: (
    node: AnyNode,
    propertyPath: string,
    frame: number,
    value?: number,
  ) => AnyNode | undefined;
}

export const createAnimatablePropertyCollector = () => {
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

  return { props, addProp };
};

export const setDefaultKeyframeValue = (
  node: AnyNode,
  propertyPath: string,
  frame: number,
  value?: number,
): AnyNode | undefined => {
  const prop = getImmutable(node, propertyPath) as AnimatableNumber;

  if (prop === undefined) {
    return undefined;
  }

  const finalProp = setKeyframeOnValue(prop, frame, value);
  return setImmutable(node, propertyPath, finalProp);
};

export const mediaTransformAnimation: EffectAnimationBehavior = {
  getAnimatableProperties: (node) => {
    const { props, addProp } = createAnimatablePropertyCollector();

    if (!('transform' in node)) {
      return props;
    }

    addProp('Scale X', 'transform.scaleX', node.transform.scaleX, 'Transform');
    addProp('Scale Y', 'transform.scaleY', node.transform.scaleY, 'Transform');
    addProp('Position X', 'transform.x', node.transform.x, 'Transform');
    addProp('Position Y', 'transform.y', node.transform.y, 'Transform');

    return props;
  },
};

export const uniformSliderAnimation: EffectAnimationBehavior = {
  getAnimatableProperties: (node) => {
    const { props, addProp } = createAnimatablePropertyCollector();

    if (!('uniforms' in node)) {
      return props;
    }

    for (const key in node.uniforms) {
      const uniform = node.uniforms[key];
      if (uniform.ui === 'slider') {
        addProp(uniform.label, `uniforms.${key}.value`, uniform.value, 'Shader Uniforms');
      }
    }

    return props;
  },
};
