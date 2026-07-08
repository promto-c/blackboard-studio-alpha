import { useEditorActions } from '@/state/editorContext';
import { MediaSourceNode, AnyNode } from '@blackboard/types';
import SourceAlphaControl from '../../SourceAlphaControl';
import SourceTransformControls from '../../SourceTransformControls';
import SourceSlot from '../../SourceSlot';
import { CollapsibleSection, ToggleSwitch } from '@blackboard/ui';
import { MediaColorManagementInspector } from '@/components';

function MediaSourceAdjustments({ node: anyNode }: { node: AnyNode }) {
  const node = anyNode as MediaSourceNode;
  const { updateNode } = useEditorActions();
  const isVideo = node.mediaKind === 'video';

  const handleUpdate = (updates: Partial<MediaSourceNode>, withHistory: boolean = false) => {
    updateNode(node.id, updates, withHistory);
  };

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

      {isVideo && (
        <CollapsibleSection title="Playback" defaultOpen>
          <ToggleSwitch
            label="Loop"
            checked={node.loop ?? true}
            onCheckedChange={(checked) => handleUpdate({ loop: checked }, true)}
          />
        </CollapsibleSection>
      )}

      <SourceTransformControls node={node} />
    </div>
  );
}

export default MediaSourceAdjustments;
