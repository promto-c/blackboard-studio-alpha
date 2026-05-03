import { ToolDefinition } from '../EffectDefinition';
import AiInpaintingToolButton from './AiInpaintingToolButton';

export const aiInpaintingTool: ToolDefinition = {
  type: 'ai_generate',
  name: 'Generate',
  category: 'Image',
  ToolComponent: AiInpaintingToolButton,
};
