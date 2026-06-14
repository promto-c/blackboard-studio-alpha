import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { BlendMode, MergeNode } from '@blackboard/types';
import { CollapsibleSection } from '@blackboard/ui';
import { SegmentedControl, Slider } from '@/components';
import { getValueAtFrame, hasKeyframeAt } from '@blackboard/renderer';

const blendModeOptions = [
  { value: BlendMode.OVER, label: 'Normal' },
  { value: BlendMode.MULTIPLY, label: 'Multiply' },
  { value: BlendMode.SCREEN, label: 'Screen' },
  { value: BlendMode.ADD, label: 'Add' },
];

interface MergeAdjustmentsProps {
  nodeId: string;
}

function MergeAdjustments({ nodeId }: MergeAdjustmentsProps) {
  const nodes = useEditorSelector((s) => s.nodes);
  const currentFrame = useEditorSelector((s) => s.currentFrame);
  const { updateNode, setKeyframe } = useEditorActions();

  const node = nodes.find((n) => n.id === nodeId) as MergeNode | undefined;

  if (!node) {
    return <p className="p-4 text-xs text-gray-500">Could not resolve merge node.</p>;
  }

  const opacityAtFrame =
    typeof node.opacity === 'number' ? node.opacity : getValueAtFrame(node.opacity, currentFrame);

  return (
    <div>
      <CollapsibleSection title="Merge" defaultOpen>
        <div className="space-y-3">
          <Slider
            label="Mix"
            value={opacityAtFrame}
            min={0}
            max={100}
            step={1}
            onChange={(v) => setKeyframe(node.id, 'opacity', v)}
            onReset={() => setKeyframe(node.id, 'opacity', 100, true)}
            displayFormatter={(v) => `${v.toFixed(0)}%`}
            isKeyframed={hasKeyframeAt(node.opacity, currentFrame)}
            onToggleKeyframe={() => setKeyframe(node.id, 'opacity')}
          />
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-400">Blend Mode</label>
            <SegmentedControl
              value={node.operator ?? BlendMode.OVER}
              options={blendModeOptions}
              onChange={(value) => updateNode(node.id, { operator: value as BlendMode }, true)}
            />
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );
}

export default MergeAdjustments;
