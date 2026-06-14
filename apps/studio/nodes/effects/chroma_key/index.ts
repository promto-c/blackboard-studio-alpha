import { NodeType } from '@blackboard/types';
import { createShaderNodeDefinition } from '../../nodeFactoryHelpers';
import ChromaKeyAdjustments from './ChromaKeyAdjustments';
import { ChromaKeyIcon } from './ChromaKeyIcon';
import { ChromaKeyTool } from './ChromaKeyTool';
import { CHROMA_KEY_SHADER } from './chromaKeyShader';

export const chromaKeyNode = createShaderNodeDefinition({
  type: NodeType.CHROMA_KEY,
  name: 'Keying',
  description: 'Remove a specific background color (Green Screen).',
  IconComponent: ChromaKeyIcon,
  ToolComponent: ChromaKeyTool,
  AdjustmentComponent: ChromaKeyAdjustments,
  shader: CHROMA_KEY_SHADER,
});
