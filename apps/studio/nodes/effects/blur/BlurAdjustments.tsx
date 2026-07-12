import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { AnyNode, BlurNode, BlurMethod } from '@blackboard/types';
import { CollapsibleSection, Slider } from '@blackboard/ui';
import { SegmentedControl, SettingRow, ShaderCodeButton } from '@/components';
import { BlurShader } from './blurShader';
import { getValueAtFrame, hasKeyframeAt } from '@blackboard/renderer';

const SHADER_BY_METHOD: Record<string, { horizontal: string; vertical: string }> = {
  [BlurMethod.GAUSSIAN]: { horizontal: BlurShader.GAUSSIAN_H, vertical: BlurShader.GAUSSIAN_V },
  [BlurMethod.BOX]: { horizontal: BlurShader.BOX_H, vertical: BlurShader.BOX_V },
  [BlurMethod.ITERATED_BOX]: {
    horizontal: BlurShader.ITERATED_BOX_H,
    vertical: BlurShader.ITERATED_BOX_V,
  },
};

function BlurAdjustments({ node: anyNode }: { node: AnyNode }) {
  const node = anyNode as BlurNode;
  const currentFrame = useEditorSelector((s) => s.currentFrame);
  const { updateNode, setKeyframe } = useEditorActions();
  const blurMethodOptions = [
    { value: BlurMethod.GAUSSIAN, label: 'Gaussian' },
    { value: BlurMethod.BOX, label: 'Box' },
    { value: BlurMethod.ITERATED_BOX, label: '3× Box' },
  ];

  const handleBlurChange = (value: number) => {
    setKeyframe(node.id, 'blur.radius', value);
  };

  const handleReset = () => {
    setKeyframe(node.id, 'blur.radius', 0, true);
  };

  const handleMethodChange = (method: BlurMethod) => {
    updateNode(node.id, { blur: { ...node.blur, method } }, true);
  };

  const handleToggleKeyframe = () => {
    setKeyframe(node.id, 'blur.radius');
  };

  const radiusAtCurrentFrame = getValueAtFrame(node.blur.radius, currentFrame);
  const activeShader = SHADER_BY_METHOD[node.blur.method] || SHADER_BY_METHOD[BlurMethod.GAUSSIAN];

  return (
    <>
      <CollapsibleSection title="Parameters" defaultOpen>
        <div className="space-y-4">
          <SettingRow label="Method">
            <SegmentedControl
              options={blurMethodOptions}
              value={node.blur.method || BlurMethod.GAUSSIAN}
              onChange={(val) => handleMethodChange(val as BlurMethod)}
              className="w-full"
            />
          </SettingRow>
          <Slider
            label="Radius"
            value={radiusAtCurrentFrame}
            min={0}
            max={100}
            step={0.1}
            onChange={handleBlurChange}
            onReset={handleReset}
            displayFormatter={(v) => `${v.toFixed(1)}px`}
            isKeyframed={hasKeyframeAt(node.blur.radius, currentFrame)}
            onToggleKeyframe={handleToggleKeyframe}
          />
        </div>
      </CollapsibleSection>
      <ShaderCodeButton
        title={`${node.name} GLSL Code (2-Pass)`}
        code={`// Horizontal Pass\n${activeShader.horizontal}\n\n// Vertical Pass\n${activeShader.vertical}`}
      />
    </>
  );
}

export default BlurAdjustments;
