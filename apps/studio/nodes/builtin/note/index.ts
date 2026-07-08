import { NodeType, type NoteNode } from '@blackboard/types';
import { NodeDefinition } from '../../NodeDefinition';
import NoteAdjustments from './NoteAdjustments';
import NoteTool from './NoteTool';
import * as Icons from '@blackboard/icons';

export const noteNode: NodeDefinition = {
  type: NodeType.NOTE,
  name: 'Note',
  category: 'Utility',
  renderMode: 'utility',
  processingDomain: 'data',
  description: 'Add a markdown note to the graph.',
  IconComponent: Icons.DocumentPlus,
  ToolComponent: NoteTool,
  AdjustmentComponent: NoteAdjustments,
  outputPorts: [],
  flags: {
    isDraggable: true,
    isRenderable: false,
  },
  getInitialNodeProps: (): Omit<NoteNode, 'id' | 'name' | 'enabled' | 'type'> => ({
    content: 'Use softer edge for hair matte',
    color: 'theme',
  }),
};
