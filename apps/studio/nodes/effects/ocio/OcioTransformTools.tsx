import { NodeType } from '@blackboard/types';
import { NodeToolButton } from '../../NodeToolButton';

export const OcioColorSpaceTransformTool = () => (
  <NodeToolButton nodeType={NodeType.OCIO_COLOR_SPACE} />
);

export const OcioNamedTransformTool = () => (
  <NodeToolButton nodeType={NodeType.OCIO_NAMED_TRANSFORM} />
);

export const OcioFileTransformTool = () => (
  <NodeToolButton nodeType={NodeType.OCIO_FILE_TRANSFORM} />
);

export const OcioLookTransformTool = () => (
  <NodeToolButton nodeType={NodeType.OCIO_LOOK_TRANSFORM} />
);
