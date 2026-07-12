import { MediaSourceNode, AnyNode } from '@blackboard/types';
import SourceAlphaControl from '../../SourceAlphaControl';
import SourceTransformControls from '../../SourceTransformControls';
import SourceSlot from '../../SourceSlot';
import SourceTimingControls from '../../SourceTimingControls';
import { CollapsibleSection } from '@blackboard/ui';
import { MediaColorManagementInspector } from '@/components';

function MediaSourceAdjustments({ node: anyNode }: { node: AnyNode }) {
  const node = anyNode as MediaSourceNode;
  const isVideo = node.mediaKind === 'video';

  return (
    <div>
      <SourceSlot
        nodeId={node.id}
        kind={isVideo ? 'video' : 'image'}
        sourceFileName={node.sourceFileName}
        width={node.width}
        height={node.height}
      />

      <CollapsibleSection title="Color Management" defaultOpen>
        <div className="space-y-3">
          <MediaColorManagementInspector node={node} />
          <SourceAlphaControl node={node} />
        </div>
      </CollapsibleSection>

      {isVideo && <SourceTimingControls node={node} />}

      <SourceTransformControls node={node} />
    </div>
  );
}

export default MediaSourceAdjustments;
