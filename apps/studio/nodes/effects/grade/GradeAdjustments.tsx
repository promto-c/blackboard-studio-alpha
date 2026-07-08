import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import type {
  AnimatableNumber,
  AnyNode,
  GradeNode,
  GradeOutOfGamutMode,
  GradeProcessingDomain,
} from '@blackboard/types';
import { CollapsibleSection } from '@blackboard/ui';
import { AttentionPulse, SegmentedControl, ShaderCodeButton, Slider } from '@/components';
import { getValueAtFrame, hasKeyframeAt } from '@blackboard/renderer';
import { GRADE_SHADER } from './gradeShader';
import {
  GRADE_RGB_DEFAULTS,
  GRADE_SCALAR_DEFAULTS,
  getGradeProperty,
  type GradeChannel,
  type GradeRgbPath,
} from './gradeModel';

interface GradeSliderDefinition {
  label: string;
  path: keyof typeof GRADE_SCALAR_DEFAULTS;
  min: number;
  max: number;
  step: number;
  suffix?: string;
}

interface GradeRgbDefinition {
  label: string;
  path: GradeRgbPath;
  min: number;
  max: number;
  step: number;
}

const PRIMARY_CONTROLS: GradeSliderDefinition[] = [
  { label: 'Exposure', path: 'exposure', min: -10, max: 10, step: 0.05, suffix: ' stops' },
  { label: 'Contrast', path: 'contrast', min: 0, max: 4, step: 0.01 },
  { label: 'Middle Gray', path: 'contrastPivot', min: 0.001, max: 1, step: 0.001 },
  { label: 'Saturation', path: 'saturation', min: 0, max: 4, step: 0.01 },
];

const LGG_CONTROLS: GradeRgbDefinition[] = [
  { label: 'Lift', path: 'lift', min: -2, max: 2, step: 0.01 },
  { label: 'Gamma', path: 'gamma', min: 0.01, max: 4, step: 0.01 },
  { label: 'Gain', path: 'gain', min: 0, max: 8, step: 0.01 },
];

const CDL_CONTROLS: GradeRgbDefinition[] = [
  { label: 'Slope', path: 'cdl.slope', min: 0, max: 4, step: 0.01 },
  { label: 'Offset', path: 'cdl.offset', min: -2, max: 2, step: 0.01 },
  { label: 'Power', path: 'cdl.power', min: 0.01, max: 4, step: 0.01 },
];

const CHANNELS: Array<{ key: GradeChannel; label: string }> = [
  { key: 'r', label: 'R' },
  { key: 'g', label: 'G' },
  { key: 'b', label: 'B' },
];

interface AnimatableGradeSliderProps {
  nodeId: string;
  label: string;
  path: string;
  property: AnimatableNumber;
  defaultValue: number;
  frame: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
}

function AnimatableGradeSlider({
  nodeId,
  label,
  path,
  property,
  defaultValue,
  frame,
  min,
  max,
  step,
  suffix = '',
}: AnimatableGradeSliderProps) {
  const { setKeyframe } = useEditorActions();
  return (
    <Slider
      label={label}
      value={getValueAtFrame(property, frame)}
      min={min}
      max={max}
      step={step}
      onChange={(value) => setKeyframe(nodeId, `grade.${path}`, value)}
      onReset={() => setKeyframe(nodeId, `grade.${path}`, defaultValue, true)}
      displayFormatter={(value) => `${value.toFixed(step < 0.01 ? 3 : 2)}${suffix}`}
      isKeyframed={hasKeyframeAt(property, frame)}
      onToggleKeyframe={() => setKeyframe(nodeId, `grade.${path}`)}
    />
  );
}

function GradeRgbControls({
  node,
  definition,
  frame,
}: {
  node: GradeNode;
  definition: GradeRgbDefinition;
  frame: number;
}) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-medium text-gray-300">{definition.label}</div>
      {CHANNELS.map(({ key, label }) => {
        const path = `${definition.path}.${key}`;
        return (
          <AnimatableGradeSlider
            key={path}
            nodeId={node.id}
            label={label}
            path={path}
            property={getGradeProperty(node.grade, path)}
            defaultValue={GRADE_RGB_DEFAULTS[definition.path]}
            frame={frame}
            min={definition.min}
            max={definition.max}
            step={definition.step}
          />
        );
      })}
    </div>
  );
}

function GradeAdjustments({ node: anyNode }: { node: AnyNode }) {
  const node = anyNode as GradeNode;
  const currentFrame = useEditorSelector((state) => state.currentFrame);
  const aiApplyNotice = useEditorSelector((state) => state.aiApplyNotice);
  const { updateNode } = useEditorActions();
  const gradeApplyNotice =
    aiApplyNotice?.nodeId === node.id && aiApplyNotice.field === 'grade' ? aiApplyNotice : null;

  const updateGradeMode = (
    patch: Partial<Pick<GradeNode['grade'], 'processingDomain' | 'outOfGamut'>>,
  ) => updateNode(node.id, { grade: { ...node.grade, ...patch } }, true);

  return (
    <>
      <CollapsibleSection title="Processing" defaultOpen>
        <div className="space-y-3">
          <SegmentedControl
            options={[
              { value: 'scene_linear', label: 'Scene Linear' },
              { value: 'log', label: 'Log' },
            ]}
            value={node.grade.processingDomain}
            onChange={(value) =>
              updateGradeMode({ processingDomain: value as GradeProcessingDomain })
            }
          />
          <SegmentedControl
            options={[
              { value: 'preserve', label: 'Preserve RGB' },
              { value: 'clamp_negative', label: 'Clamp Negative' },
            ]}
            value={node.grade.outOfGamut}
            onChange={(value) => updateGradeMode({ outOfGamut: value as GradeOutOfGamutMode })}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Primary" defaultOpen>
        <AttentionPulse activeKey={gradeApplyNotice?.id} className="space-y-4 rounded-lg">
          {PRIMARY_CONTROLS.map((control) => (
            <AnimatableGradeSlider
              key={control.path}
              nodeId={node.id}
              path={control.path}
              label={control.label}
              property={getGradeProperty(node.grade, control.path)}
              defaultValue={GRADE_SCALAR_DEFAULTS[control.path]}
              frame={currentFrame}
              min={control.min}
              max={control.max}
              step={control.step}
              suffix={control.suffix}
            />
          ))}
        </AttentionPulse>
      </CollapsibleSection>

      <CollapsibleSection title="Lift / Gamma / Gain">
        <div className="space-y-5">
          {LGG_CONTROLS.map((definition) => (
            <GradeRgbControls
              key={definition.path}
              node={node}
              definition={definition}
              frame={currentFrame}
            />
          ))}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="ASC CDL">
        <div className="space-y-5">
          {CDL_CONTROLS.map((definition) => (
            <GradeRgbControls
              key={definition.path}
              node={node}
              definition={definition}
              frame={currentFrame}
            />
          ))}
          <AnimatableGradeSlider
            nodeId={node.id}
            label="Saturation"
            path="cdl.saturation"
            property={node.grade.cdl.saturation}
            defaultValue={GRADE_SCALAR_DEFAULTS['cdl.saturation']}
            frame={currentFrame}
            min={0}
            max={4}
            step={0.01}
          />
        </div>
      </CollapsibleSection>

      <ShaderCodeButton title={`${node.name} GLSL Code`} code={GRADE_SHADER} />
    </>
  );
}

export default GradeAdjustments;
