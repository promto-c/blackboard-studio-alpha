import { type ImageSequenceNode, type AnyNode } from '@blackboard/types';
import SourceAlphaControl from '../../SourceAlphaControl';
import SourceTransformControls from '../../SourceTransformControls';
import SourceSlot from '../../SourceSlot';
import SourceTimingControls from '../../SourceTimingControls';
import { CollapsibleSection, StyledDropdown } from '@blackboard/ui';
import { MediaColorManagementInspector } from '@/components';
import { useEditorActions } from '@/state/editorContext';
import { selectImageSequencePlate } from '@/utils/imageSequencePlates';

function ImageSequenceAdjustments({ node: anyNode }: { node: AnyNode }) {
  const node = anyNode as ImageSequenceNode;
  const { updateNode } = useEditorActions();
  const plates = node.plates ?? [];
  const activePlateId = node.activePlateId ?? plates[0]?.id ?? '';

  const handlePlateChange = (plateId: string | number) => {
    const updates = selectImageSequencePlate(node, String(plateId));
    if (updates) updateNode(node.id, updates as Partial<AnyNode>, true);
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
      >
        {plates.length > 1 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-medium text-gray-400">Plate</span>
              <span className="text-[10px] tabular-nums text-gray-500">
                {plates.length} available
              </span>
            </div>
            <StyledDropdown
              value={activePlateId}
              options={plates.map((plate) => ({
                value: plate.id,
                label: plate.name,
                secondaryLabel: `${plate.startFrame}–${plate.startFrame + Math.max(0, plate.frames.length - 1)} · ${plate.frames.length} frames`,
              }))}
              onChange={handlePlateChange}
              density="compact"
              widthClass="w-full"
              showSelectedBadges={false}
            />
          </div>
        )}
      </SourceSlot>
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
