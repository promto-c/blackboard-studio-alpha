import { useEditorActions } from '@/state/editorContext';
import { ImageSequenceNode, AnyNode } from '@blackboard/types';
import SourceAlphaControl from '../../SourceAlphaControl';
import SourceTransformControls from '../../SourceTransformControls';
import SourceSlot from '../../SourceSlot';
import { CollapsibleSection, ToggleSwitch } from '@blackboard/ui';
import { MediaColorManagementInspector, Slider } from '@/components';

function ImageSequenceAdjustments({ node: anyNode }: { node: AnyNode }) {
  const node = anyNode as ImageSequenceNode;
  const { updateNode } = useEditorActions();

  const handleUpdate = (updates: Partial<ImageSequenceNode>, withHistory: boolean = false) => {
    updateNode(node.id, updates, withHistory);
  };

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
      <CollapsibleSection title="Playback" defaultOpen>
        <div className="space-y-4">
          <Slider
            label="Start Frame Offset"
            value={node.startFrame}
            min={-1000}
            max={1000}
            step={1}
            onChange={(v) => handleUpdate({ startFrame: v }, true)}
            onReset={() => handleUpdate({ startFrame: 0 }, true)}
          />
          <ToggleSwitch
            label="Loop Sequence"
            checked={node.loop}
            onCheckedChange={(checked) => handleUpdate({ loop: checked }, true)}
          />
        </div>
      </CollapsibleSection>
      <SourceTransformControls node={node} />
    </div>
  );
}

export default ImageSequenceAdjustments;
