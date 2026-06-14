import { NodeType, type GroupNode } from '@blackboard/types';
import { NodeDefinition } from '../../NodeDefinition';
import GroupAdjustments from './GroupAdjustments';
import * as Icons from '@blackboard/icons';

export const groupNode: NodeDefinition = {
  type: NodeType.GROUP,
  name: 'Group',
  category: 'Effect',
  renderMode: 'scene',
  description: 'Container node with explicit external input ports.',
  IconComponent: Icons.FolderOpen,
  AdjustmentComponent: GroupAdjustments,
  flags: {
    isRenderable: true,
  },
  inputPorts: (node) =>
    ((node as GroupNode).externalInputs ?? []).map((input) => ({
      name: input.id,
      label: input.label || input.targetPort,
      type: 'texture' as const,
      required: false,
      description: `${input.targetNodeId} / ${input.targetPort}`,
    })),
  getInitialNodeProps: (): Omit<GroupNode, 'id' | 'name' | 'enabled' | 'type'> => ({
    childFlowId: null,
    externalInputs: [],
  }),
};
