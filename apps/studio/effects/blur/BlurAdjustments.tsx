import React, { useState } from 'react';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { AnyNode, BlurNode, BlurMethod } from '@blackboard/types';
import { CollapsibleSection, SegmentedControl, Slider, ShaderCodeModal } from '@/components';
import { BLUR_H_SHADER, BLUR_V_SHADER } from './blurShader';
import { getValueAtFrame, hasKeyframeAt } from '@blackboard/renderer';

const BlurAdjustments: React.FC<{ node: AnyNode }> = ({ node: anyNode }) => {
  const node = anyNode as BlurNode;
  const currentFrame = useEditorSelector((s) => s.currentFrame);
  const { updateNode, setKeyframe } = useEditorActions();
  const [isCodeVisible, setIsCodeVisible] = useState(false);

  const blurMethodOptions = [
    { value: BlurMethod.GAUSSIAN, label: 'Gaussian' },
    { value: BlurMethod.BOX, label: 'Box' },
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

  return (
    <>
      <CollapsibleSection title="Parameters" defaultOpen>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-400">Method</label>
            <SegmentedControl
              options={blurMethodOptions}
              value={node.blur.method || BlurMethod.GAUSSIAN}
              onChange={(val) => handleMethodChange(val as BlurMethod)}
            />
          </div>
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
      <div className="mt-4 flex justify-end">
        <button
          onClick={() => setIsCodeVisible(true)}
          className="text-xs text-gray-400 hover:text-primary-400 transition-colors flex items-center gap-1"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-3 w-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
            />
          </svg>
          View Code
        </button>
      </div>
      {isCodeVisible && (
        <ShaderCodeModal
          title={`${node.name} GLSL Code (2-Pass)`}
          code={`// Horizontal Pass\n${BLUR_H_SHADER}\n\n// Vertical Pass\n${BLUR_V_SHADER}`}
          onClose={() => setIsCodeVisible(false)}
        />
      )}
    </>
  );
};

export default BlurAdjustments;
