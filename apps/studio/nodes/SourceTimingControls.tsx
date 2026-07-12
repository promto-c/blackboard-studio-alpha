import type { AnyNode, SourceRangeBehavior } from '@blackboard/types';
import { CollapsibleSection, NumberInput, StyledDropdown } from '@blackboard/ui';
import { SettingRow } from '@/components/SettingRow';
import { useEditorActions } from '@/state/editorContext';
import {
  DEFAULT_SOURCE_RANGE_BEHAVIOR,
  getSourceFrameRange,
  type TemporalMediaNode,
} from './sourceFrameRange';

const RANGE_BEHAVIOR_OPTIONS: Array<{
  value: SourceRangeBehavior;
  label: string;
  secondaryLabel: string;
}> = [
  { value: 'hold', label: 'Hold', secondaryLabel: 'Freeze the nearest edge frame' },
  { value: 'black', label: 'Black', secondaryLabel: 'Return transparent black' },
  { value: 'loop', label: 'Loop', secondaryLabel: 'Repeat the source range' },
  { value: 'bounce', label: 'Bounce', secondaryLabel: 'Play forward, then backward' },
];

function SourceTimingControls({ node }: { node: TemporalMediaNode }) {
  const { updateNode } = useEditorActions();
  const range = getSourceFrameRange(node);
  const applyStartFrame = (startFrame: number) => {
    if (startFrame !== range.startFrame) {
      updateNode(node.id, { startFrame } as Partial<AnyNode>, true);
    }
  };

  const updateBehavior = (
    property: 'beforeRangeBehavior' | 'afterRangeBehavior',
    value: string | number,
  ) => {
    updateNode(node.id, { [property]: value as SourceRangeBehavior } as Partial<AnyNode>, true);
  };

  return (
    <CollapsibleSection title="Timing" defaultOpen>
      <div>
        <SettingRow label="Timeline Start">
          <NumberInput
            step="1"
            value={range.startFrame}
            normalizeValue={Math.round}
            onValueChange={applyStartFrame}
            aria-label="Source timeline start frame"
          />
        </SettingRow>

        <SettingRow label="Available Range">
          <div className="px-2.5 py-2 text-right font-mono text-xs tabular-nums text-gray-300">
            {range.frameCount > 0 ? `${range.startFrame}–${range.endFrame}` : 'No frames'}
          </div>
        </SettingRow>

        <SettingRow label="Before Range">
          <StyledDropdown
            value={node.beforeRangeBehavior ?? DEFAULT_SOURCE_RANGE_BEHAVIOR}
            options={RANGE_BEHAVIOR_OPTIONS}
            onChange={(value) => updateBehavior('beforeRangeBehavior', value)}
            widthClass="w-full"
            popoverWidthClass="w-64"
          />
        </SettingRow>

        <SettingRow label="After Range">
          <StyledDropdown
            value={node.afterRangeBehavior ?? DEFAULT_SOURCE_RANGE_BEHAVIOR}
            options={RANGE_BEHAVIOR_OPTIONS}
            onChange={(value) => updateBehavior('afterRangeBehavior', value)}
            widthClass="w-full"
            popoverWidthClass="w-64"
          />
        </SettingRow>

        <p className="mt-2 text-[10px] leading-relaxed text-gray-500">
          Black returns zero RGBA, so this source contributes nothing when composited over another
          input.
        </p>
      </div>
    </CollapsibleSection>
  );
}

export default SourceTimingControls;
