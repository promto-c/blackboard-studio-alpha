import { ImageSequenceNode, AnyNode } from '@blackboard/types';
import SourceAlphaControl from '../../SourceAlphaControl';
import SourceTransformControls from '../../SourceTransformControls';
import SourceSlot from '../../SourceSlot';
import SourceTimingControls from '../../SourceTimingControls';
import { CollapsibleSection } from '@blackboard/ui';
import { MediaColorManagementInspector } from '@/components';

function ImageSequenceAdjustments({ node: anyNode }: { node: AnyNode }) {
  const node = anyNode as ImageSequenceNode;

  return (
    <div>
      <SourceSlot
        nodeId={node.id}
        kind="image_sequence"
        sourceFileName={node.sourceFileName}
        width={node.width}
        height={node.height}
        frameCount={node.frames.length}
      />
      <CollapsibleSection title="Color Management" defaultOpen>
        <div className="space-y-3">
          <MediaColorManagementInspector node={node} />
          <SourceAlphaControl node={node} />
        </div>
      </CollapsibleSection>
      <SourceTimingControls node={node} />
      <SourceTransformControls node={node} />
    </div>
  );
}

export default ImageSequenceAdjustments;
