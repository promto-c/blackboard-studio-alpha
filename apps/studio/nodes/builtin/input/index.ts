import { NodeType, type InputNode } from '@blackboard/types';
import { NodeDefinition } from '../../NodeDefinition';
import * as Icons from '@blackboard/icons';

export const inputNode: NodeDefinition = {
  type: NodeType.INPUT,
  name: 'Input',
  category: 'Effect',
  renderMode: 'scene',
  processingDomain: 'scene_linear',
  description: 'Entry proxy for scene and group inputs.',
  IconComponent: Icons.ArrowDown,
  AdjustmentComponent: () => null,
  flags: {
    isSource: true,
  },
  getInitialNodeProps: (): Omit<InputNode, 'id' | 'name' | 'enabled' | 'type'> => ({
    groupNodeId: null,
    externalInputId: null,
  }),
};
