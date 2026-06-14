import { NodeType } from '@blackboard/types';
import * as Icons from '@blackboard/icons';
import { NodeToolButton } from '@/nodes/NodeToolButton';

function Scene3DToolButton() {
  return (
    <NodeToolButton
      nodeType={NodeType.SCENE_3D}
      icon={<Icons.CubeTransparent className="h-6 w-6" />}
    />
  );
}

export default Scene3DToolButton;
