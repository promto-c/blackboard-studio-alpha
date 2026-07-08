import { AnyNode, BlendMode } from '@blackboard/types';
import { nodeFlags } from '@/nodes/helpers';

export const getBlendModeLabel = (mode?: BlendMode): string => {
  if (!mode) return 'Over';

  switch (mode) {
    case BlendMode.OVER:
      return 'Over';
    case BlendMode.ADD:
      return 'Add';
    case BlendMode.MULTIPLY:
      return 'Mult';
    case BlendMode.SCREEN:
      return 'Scrn';
    default:
      return 'Over';
  }
};
