import { AlphaMergeOperation, type AnyNode, type MaskedMergeNode } from '@blackboard/types';
import { getValueAtFrame, hasKeyframeAt } from '@blackboard/renderer';
import { CollapsibleSection, Slider } from '@blackboard/ui';
import { SegmentedControl, SettingRow, ShaderCodeButton } from '@/components';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import {
  DEFAULT_MASKED_MERGE_ALPHA_OPERATION,
  DEFAULT_MASKED_MERGE_MIX,
} from './maskedMergeDefaults';
import { MASKED_MERGE_SHADER } from './maskedMergeShader';

const ALPHA_OPERATION_OPTIONS = [
  { value: AlphaMergeOperation.REPLACE, label: 'Replace' },
  { value: AlphaMergeOperation.UNION, label: 'Union' },
  { value: AlphaMergeOperation.SUBTRACT, label: 'Subtract' },
  { value: AlphaMergeOperation.INTERSECT, label: 'Intersect' },
];

export function MaskedMergeAdjustments({ node: anyNode }: { node: AnyNode }) {
  const node = anyNode as MaskedMergeNode;
  const currentFrame = useEditorSelector((state) => state.currentFrame);
  const { setKeyframe, updateNode } = useEditorActions();
  const mixProperty = node.mix ?? DEFAULT_MASKED_MERGE_MIX;
  const mix = getValueAtFrame(mixProperty, currentFrame);
  const alphaOperation = node.alphaOperation ?? DEFAULT_MASKED_MERGE_ALPHA_OPERATION;

  const setMix = (value: number, withHistory = true) => {
    if (node.mix === undefined) {
      updateNode(node.id, { mix: value }, withHistory);
      return;
    }
    setKeyframe(node.id, 'mix', value, withHistory);
  };

  return (
    <div>
      <CollapsibleSection title="Alpha Merge" defaultOpen>
        <div className="space-y-3">
          <Slider
            label="Mix"
            value={mix}
            min={0}
            max={100}
            step={1}
            onChange={(value) => setMix(value)}
            onReset={() => setMix(DEFAULT_MASKED_MERGE_MIX, true)}
            displayFormatter={(value) => `${Math.round(value)}%`}
            isKeyframed={hasKeyframeAt(mixProperty, currentFrame)}
            onToggleKeyframe={() => {
              if (node.mix === undefined) {
                updateNode(node.id, { mix: DEFAULT_MASKED_MERGE_MIX }, true);
                return;
              }
              setKeyframe(node.id, 'mix');
            }}
          />
          <SettingRow label="Alpha Operation">
            <SegmentedControl
              value={alphaOperation}
              options={ALPHA_OPERATION_OPTIONS}
              onChange={(value) =>
                updateNode(
                  node.id,
                  { alphaOperation: value as MaskedMergeNode['alphaOperation'] },
                  true,
                )
              }
              ariaLabel="Alpha Operation"
              className="w-full"
            />
          </SettingRow>
          <p className="text-[10px] leading-4 text-gray-500">
            RGB always comes from the RGBA input. Only its alpha is combined with the mask.
          </p>
        </div>
      </CollapsibleSection>
      <ShaderCodeButton title={`${node.name} GLSL Code`} code={MASKED_MERGE_SHADER} />
    </div>
  );
}
