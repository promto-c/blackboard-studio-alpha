import type { AnyNode, MatteControlNode } from '@blackboard/types';
import { getValueAtFrame, hasKeyframeAt } from '@blackboard/renderer';
import { CollapsibleSection, RangeSlider, Slider } from '@blackboard/ui';
import { ShaderCodeButton, ToggleSettingRow } from '@/components';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import { MATTE_CONTROL_LIMITS } from './matteControlModel';
import { MATTE_CONTROL_SHADER_SOURCE } from './matteControlShaders';

const formatMorphology = (value: number): string => {
  if (Math.abs(value) < 0.001) return 'Off';
  return value > 0 ? `Dilate ${Math.round(value)} px` : `Erode ${Math.round(Math.abs(value))} px`;
};

export function MatteControlAdjustments({ node: anyNode }: { node: AnyNode }) {
  const node = anyNode as MatteControlNode;
  const currentFrame = useEditorSelector((state) => state.currentFrame);
  const { setKeyframe, updateNode } = useEditorActions();
  const settings = node.matteControl;
  const valueAtFrame = (property: 'erodeDilate' | 'edgeBlur' | 'clampBlack' | 'clampWhite') =>
    getValueAtFrame(settings[property], currentFrame);
  const setAnimatedValue = (
    property: 'erodeDilate' | 'edgeBlur' | 'clampBlack' | 'clampWhite',
    value: number,
    forceStatic = false,
  ) => setKeyframe(node.id, `matteControl.${property}`, value, forceStatic);
  const toggleKeyframe = (property: 'erodeDilate' | 'edgeBlur' | 'clampBlack' | 'clampWhite') =>
    setKeyframe(node.id, `matteControl.${property}`);

  const updateSettings = (changes: Partial<Pick<typeof settings, 'invert'>>) =>
    updateNode(node.id, { matteControl: { ...settings, ...changes } }, true);

  const clampRange: [number, number] = [valueAtFrame('clampBlack'), valueAtFrame('clampWhite')];

  return (
    <div>
      <CollapsibleSection title="Matte Finesse" defaultOpen>
        <div className="space-y-4">
          <Slider
            label="Erode / Dilate"
            value={valueAtFrame('erodeDilate')}
            min={MATTE_CONTROL_LIMITS.morphology.min}
            max={MATTE_CONTROL_LIMITS.morphology.max}
            step={MATTE_CONTROL_LIMITS.morphology.step}
            onChange={(value) => setAnimatedValue('erodeDilate', value)}
            onReset={() => setAnimatedValue('erodeDilate', 0, true)}
            displayFormatter={formatMorphology}
            isKeyframed={hasKeyframeAt(settings.erodeDilate, currentFrame)}
            onToggleKeyframe={() => toggleKeyframe('erodeDilate')}
          />
          <Slider
            label="Edge Blur"
            value={valueAtFrame('edgeBlur')}
            min={MATTE_CONTROL_LIMITS.edgeBlur.min}
            max={MATTE_CONTROL_LIMITS.edgeBlur.max}
            step={MATTE_CONTROL_LIMITS.edgeBlur.step}
            onChange={(value) => setAnimatedValue('edgeBlur', value)}
            onReset={() => setAnimatedValue('edgeBlur', 0, true)}
            displayFormatter={(value) => (value === 0 ? 'Off' : `${value.toFixed(1)} px`)}
            isKeyframed={hasKeyframeAt(settings.edgeBlur, currentFrame)}
            onToggleKeyframe={() => toggleKeyframe('edgeBlur')}
          />
          <RangeSlider
            label="Clamp"
            value={clampRange}
            min={MATTE_CONTROL_LIMITS.clamp.min}
            max={MATTE_CONTROL_LIMITS.clamp.max}
            step={MATTE_CONTROL_LIMITS.clamp.step}
            minGap={MATTE_CONTROL_LIMITS.clamp.minGap}
            onValueChange={([black, white]) => {
              setAnimatedValue('clampBlack', black);
              setAnimatedValue('clampWhite', white);
            }}
            onReset={() => {
              setAnimatedValue('clampBlack', 0, true);
              setAnimatedValue('clampWhite', 1, true);
            }}
            displayFormatter={(value) => `${Math.round(value * 100)}%`}
          />
          <ToggleSettingRow
            label="Invert Matte"
            checked={settings.invert}
            onCheckedChange={(invert) => updateSettings({ invert })}
          />
        </div>
      </CollapsibleSection>

      <ShaderCodeButton
        title={`${node.name} GLSL Code (GPU Multipass)`}
        code={MATTE_CONTROL_SHADER_SOURCE}
      />
    </div>
  );
}
