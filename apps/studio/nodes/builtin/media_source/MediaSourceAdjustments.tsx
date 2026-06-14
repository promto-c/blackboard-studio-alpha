import { useEditorActions } from '@/state/editorContext';
import { MediaSourceNode, AnyNode } from '@blackboard/types';
import SourceAlphaControl from '../../SourceAlphaControl';
import SourceTransformControls from '../../SourceTransformControls';
import SourceSlot from '../../SourceSlot';
import { CollapsibleSection, ToggleSwitch } from '@blackboard/ui';
import { OcioColorSpaceDropdown } from '@/components';

function MediaSourceAdjustments({ node: anyNode }: { node: AnyNode }) {
  const node = anyNode as MediaSourceNode;
  const { updateNode } = useEditorActions();
  const isVideo = node.mediaKind === 'video';

  const handleUpdate = (updates: Partial<MediaSourceNode>, withHistory: boolean = false) => {
    updateNode(node.id, updates, withHistory);
  };

  const handleColorSpaceChange = (value: string) => {
    handleUpdate({ colorSpace: value as MediaSourceNode['colorSpace'] }, true);
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
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label className="text-xs font-medium text-gray-400">Input Color Space</label>
          </div>
          <OcioColorSpaceDropdown
            value={node.colorSpace ?? 'sRGB Encoded Rec.709 (sRGB)'}
            onChange={handleColorSpaceChange}
            includeData
          />
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

      <SourceAlphaControl node={node} />
      <SourceTransformControls node={node} />
    </div>
  );
}

export default MediaSourceAdjustments;
