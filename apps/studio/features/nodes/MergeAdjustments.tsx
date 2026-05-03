import React, { useMemo } from 'react';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { AnyNode, BlendMode, MergeNode } from '@blackboard/types';
import { CollapsibleSection, SegmentedControl, Slider } from '@/components';
import { getValueAtFrame, hasKeyframeAt } from '@blackboard/renderer';
import { buildNodeStacks } from '@/utils/nodeStacks';
import { resolveMergeSourceStack } from '@/utils/mergeNodes';

const blendModeOptions = [
  { value: BlendMode.OVER, label: 'Normal' },
  { value: BlendMode.MULTIPLY, label: 'Multiply' },
  { value: BlendMode.SCREEN, label: 'Screen' },
  { value: BlendMode.ADD, label: 'Add' },
];

function findMergeTarget(mergeId: string, nodes: AnyNode[]): AnyNode | null {
  const stacks = buildNodeStacks(nodes);
  const sourceStack = resolveMergeSourceStack(mergeId, stacks);
  return sourceStack?.[0] ?? null;
}

interface MergeAdjustmentsProps {
  mergeId?: string;
  node?: MergeNode;
}

const MergeAdjustments: React.FC<MergeAdjustmentsProps> = ({ mergeId, node: realMergeNode }) => {
  const nodes = useEditorSelector((s) => s.nodes);
  const currentFrame = useEditorSelector((s) => s.currentFrame);
  const { updateNode, setKeyframe } = useEditorActions();

  const virtualMergeTarget = useMemo(
    () => (mergeId ? findMergeTarget(mergeId, nodes) : null),
    [mergeId, nodes],
  );
  const target = realMergeNode ?? virtualMergeTarget;

  if (!target) {
    return <p className="p-4 text-xs text-gray-500">Could not resolve merge node.</p>;
  }

  const secondaryNode = target;
  const node = secondaryNode as any;
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
            onChange={(v) => setKeyframe(secondaryNode.id, 'opacity', v)}
            onReset={() => setKeyframe(secondaryNode.id, 'opacity', 100, true)}
            displayFormatter={(v) => `${v.toFixed(0)}%`}
            isKeyframed={hasKeyframeAt(node.opacity, currentFrame)}
            onToggleKeyframe={() => setKeyframe(secondaryNode.id, 'opacity')}
          />
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-400">Blend Mode</label>
            <SegmentedControl
              value={node.operator ?? BlendMode.OVER}
              options={blendModeOptions}
              onChange={(value) =>
                updateNode(secondaryNode.id, { operator: value as BlendMode }, true)
              }
            />
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );
};

export default MergeAdjustments;
