import { NodeType } from '@blackboard/types';
import * as Icons from '@blackboard/icons';
import { NodeToolButton } from '../../NodeToolButton';

export const ExtractChannelsTool = () => {
  return (
    <NodeToolButton
      nodeType={NodeType.EXTRACT_CHANNELS}
      icon={<Icons.Channels channel="R" className="h-6 w-6" />}
    />
  );
};

export const MergeChannelsTool = () => {
  return (
    <NodeToolButton
      nodeType={NodeType.MERGE_CHANNELS}
      icon={<Icons.Channels channel="RGB" className="h-6 w-6" />}
    />
  );
};
