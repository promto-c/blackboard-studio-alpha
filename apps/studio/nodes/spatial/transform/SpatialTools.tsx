import { NodeType } from '@blackboard/types';
import { NodeToolButton } from '../../NodeToolButton';

export const ReformatTool = () => <NodeToolButton nodeType={NodeType.REFORMAT} />;
export const TransformTool = () => <NodeToolButton nodeType={NodeType.TRANSFORM} />;
export const CropTool = () => <NodeToolButton nodeType={NodeType.CROP} />;
