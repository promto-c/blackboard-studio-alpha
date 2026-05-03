import { NodeType, BlendMode, TextNode } from '@blackboard/types';
import { EffectDefinition } from '../EffectDefinition';
import {
  createAnimatablePropertyCollector,
  type EffectAnimationBehavior,
} from '../effectAnimationHelpers';
import TextAdjustments from './TextAdjustments';
import { Text } from '@blackboard/icons';
import { TextTool } from './TextTool';

const textAnimation: EffectAnimationBehavior = {
  getAnimatableProperties: (node) => {
    const textNode = node as TextNode;
    const { props, addProp } = createAnimatablePropertyCollector();

    addProp('Font Size', 'fontSize', textNode.fontSize, 'Style');
    addProp('Rotation', 'rotation', textNode.rotation, 'Transform');
    addProp('Position X', 'position.x', textNode.position.x, 'Transform');
    addProp('Position Y', 'position.y', textNode.position.y, 'Transform');

    return props;
  },
};

export const textEffect: EffectDefinition = {
  type: NodeType.TEXT,
  name: 'Text',
  category: 'Image',
  renderMode: 'text',
  description: 'Add a text node.',
  IconComponent: Text,
  ToolComponent: TextTool,
  AdjustmentComponent: TextAdjustments,
  animation: textAnimation,
  flags: {
    isSource: true,
    isRenderable: true,
  },
  getInitialNodeProps: (): Omit<TextNode, 'id' | 'name' | 'visible' | 'type'> => ({
    text: 'Hello World',
    fontFamily: 'Arial, sans-serif',
    fontSize: 100,
    color: [1.0, 1.0, 1.0],
    position: { x: 0, y: 0 },
    rotation: 0,
    opacity: 100,
    operator: BlendMode.OVER,
  }),
};
