import { useCallback, useMemo } from 'react';
import { RotoNode, type RotoMotionBlurPhase, type RotoMotionBlurSettings } from '@blackboard/types';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { Badge, CollapsibleSection, Slider } from '@blackboard/ui';
import { SegmentedControl, SettingRow, ToggleSettingRow } from '@/components';
import { DEFAULT_ROTO_MOTION_BLUR, resolveRotoMotionBlurSettings } from '@/utils/rotoMotionBlur';

interface RotoBatchAdjustmentsProps {
  nodeIds: string[];
}

function isMixed<T>(nodes: RotoNode[], getValue: (node: RotoNode) => T): boolean {
  if (nodes.length <= 1) return false;
  const first = getValue(nodes[0]);
  return !nodes.every((n) => getValue(n) === first);
}

function firstValue<T>(nodes: RotoNode[], getValue: (node: RotoNode) => T): T {
  return getValue(nodes[0]);
}

function MixedBadge() {
  return (
    <Badge size="sm" uppercase shrink noBorder className="!bg-yellow-500/15 !text-yellow-400">
      Mixed
    </Badge>
  );
}

function RotoBatchAdjustments({ nodeIds }: RotoBatchAdjustmentsProps) {
  const nodes = useEditorSelector((s) => s.nodes);
  const { batchUpdateNodes } = useEditorActions();

  const rotoNodes = useMemo(
    () => nodes.filter((n) => nodeIds.includes(n.id)) as RotoNode[],
    [nodes, nodeIds],
  );

  const invertMixed = isMixed(rotoNodes, (n) => n.invert);
  const invertValue = firstValue(rotoNodes, (n) => n.invert);

  const mbEnabledMixed = isMixed(
    rotoNodes,
    (n) => resolveRotoMotionBlurSettings(n.motionBlur).enabled,
  );
  const mbEnabledValue = firstValue(
    rotoNodes,
    (n) => resolveRotoMotionBlurSettings(n.motionBlur).enabled,
  );

  const shutterMixed = isMixed(
    rotoNodes,
    (n) => resolveRotoMotionBlurSettings(n.motionBlur).shutter,
  );
  const shutterValue = shutterMixed
    ? DEFAULT_ROTO_MOTION_BLUR.shutter
    : firstValue(rotoNodes, (n) => resolveRotoMotionBlurSettings(n.motionBlur).shutter);

  const samplesMixed = isMixed(
    rotoNodes,
    (n) => resolveRotoMotionBlurSettings(n.motionBlur).samples,
  );
  const samplesValue = samplesMixed
    ? DEFAULT_ROTO_MOTION_BLUR.samples
    : firstValue(rotoNodes, (n) => resolveRotoMotionBlurSettings(n.motionBlur).samples);

  const phaseMixed = isMixed(rotoNodes, (n) => resolveRotoMotionBlurSettings(n.motionBlur).phase);
  const phaseValue = phaseMixed
    ? DEFAULT_ROTO_MOTION_BLUR.phase
    : firstValue(rotoNodes, (n) => resolveRotoMotionBlurSettings(n.motionBlur).phase);

  const currentBatchMotionBlur = useMemo(
    () => ({
      enabled: mbEnabledValue,
      shutter: shutterValue,
      samples: samplesValue,
      phase: phaseValue,
    }),
    [mbEnabledValue, shutterValue, samplesValue, phaseValue],
  );

  const batchUpdateMotionBlur = useCallback(
    (updates: Partial<RotoMotionBlurSettings>) => {
      batchUpdateNodes(
        nodeIds,
        { motionBlur: { ...currentBatchMotionBlur, ...updates } } as Partial<RotoNode>,
        true,
      );
    },
    [nodeIds, batchUpdateNodes, currentBatchMotionBlur],
  );

  const shutterPhaseOptions = [
    { value: 'start', label: 'Start' },
    { value: 'centered', label: 'Centered' },
    { value: 'end', label: 'End' },
  ];

  const effectiveMbEnabled = mbEnabledMixed ? false : mbEnabledValue;

  return (
    <div className="space-y-2">
      <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">
        Batch Editing {rotoNodes.length} Roto Nodes
      </div>
      <CollapsibleSection title="Node Settings" defaultOpen>
        <div className="space-y-3">
          <ToggleSettingRow
            label="Invert Matte"
            labelAccessory={invertMixed ? <MixedBadge /> : null}
            checked={invertValue}
            onCheckedChange={(checked) =>
              batchUpdateNodes(nodeIds, { invert: checked } as Partial<RotoNode>, true)
            }
          />
          <ToggleSettingRow
            label="Motion Blur"
            labelAccessory={mbEnabledMixed ? <MixedBadge /> : null}
            checked={mbEnabledValue}
            onCheckedChange={(checked) => batchUpdateMotionBlur({ enabled: checked })}
          />
          <div
            className={
              effectiveMbEnabled ? 'space-y-3' : 'opacity-60 pointer-events-none space-y-3'
            }
          >
            <div className="flex items-center gap-1.5">
              {shutterMixed && <MixedBadge />}
              <div className="flex-1">
                <Slider
                  label="Shutter"
                  value={shutterValue}
                  min={0}
                  max={2}
                  step={0.01}
                  onChange={(value) => batchUpdateMotionBlur({ shutter: value })}
                  onReset={() =>
                    batchUpdateMotionBlur({ shutter: DEFAULT_ROTO_MOTION_BLUR.shutter })
                  }
                  displayFormatter={(value) => `${value.toFixed(2)}f`}
                />
              </div>
            </div>
            <SettingRow label="Shutter Offset" labelAccessory={phaseMixed ? <MixedBadge /> : null}>
              <SegmentedControl
                value={phaseValue}
                options={shutterPhaseOptions}
                onChange={(value) => batchUpdateMotionBlur({ phase: value as RotoMotionBlurPhase })}
                className="w-full"
              />
            </SettingRow>
            <div className="flex items-center gap-1.5">
              {samplesMixed && <MixedBadge />}
              <div className="flex-1">
                <Slider
                  label="Samples"
                  value={samplesValue}
                  min={2}
                  max={128}
                  step={1}
                  onChange={(value) => batchUpdateMotionBlur({ samples: Math.round(value) })}
                  onReset={() =>
                    batchUpdateMotionBlur({ samples: DEFAULT_ROTO_MOTION_BLUR.samples })
                  }
                  displayFormatter={(value) => `${Math.round(value)}`}
                />
              </div>
            </div>
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );
}

export default RotoBatchAdjustments;
