import React, { useState } from 'react';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { AnyNode, Grade, GradeNode } from '@blackboard/types';
import { AttentionPulse, CollapsibleSection, Slider, ShaderCodeModal } from '@/components';
import { GRADE_SHADER } from './gradeShader';
import { getValueAtFrame, hasKeyframeAt } from '@blackboard/renderer';

const GRADE_DEFAULTS: Record<keyof Grade, number> = {
  brightness: 0,
  contrast: 1,
  saturation: 1,
  gain: 1,
  gamma: 1,
};

const GradeAdjustments: React.FC<{ node: AnyNode }> = ({ node: anyNode }) => {
  const node = anyNode as GradeNode;
  const currentFrame = useEditorSelector((state) => state.currentFrame);
  const aiApplyNotice = useEditorSelector((state) => state.aiApplyNotice);
  const { setKeyframe } = useEditorActions();
  const [isCodeVisible, setIsCodeVisible] = useState(false);
  const gradeApplyNotice =
    aiApplyNotice?.nodeId === node.id && aiApplyNotice.field === 'grade' ? aiApplyNotice : null;

  const handleGradeChange = (key: keyof Grade, value: number) => {
    setKeyframe(node.id, `grade.${key}`, value);
  };

  const handleReset = (key: keyof Grade) => () => {
    const defaultValue = GRADE_DEFAULTS[key];
    setKeyframe(node.id, `grade.${key}`, defaultValue, true);
  };

  const handleToggleKeyframe = (key: keyof Grade) => () => {
    setKeyframe(node.id, `grade.${key}`);
  };

  const gradeAtCurrentFrame = {
    brightness: getValueAtFrame(node.grade.brightness, currentFrame),
    contrast: getValueAtFrame(node.grade.contrast, currentFrame),
    saturation: getValueAtFrame(node.grade.saturation, currentFrame),
    gain: getValueAtFrame(node.grade.gain, currentFrame),
    gamma: getValueAtFrame(node.grade.gamma, currentFrame),
  };

  return (
    <>
      <CollapsibleSection title="Parameters" defaultOpen>
        <AttentionPulse activeKey={gradeApplyNotice?.id} className="space-y-4 rounded-lg">
          <Slider
            label="Brightness"
            value={gradeAtCurrentFrame.brightness}
            min={-1}
            max={1}
            step={0.01}
            onChange={(v) => handleGradeChange('brightness', v)}
            onReset={handleReset('brightness')}
            displayFormatter={(v) => v.toFixed(2)}
            isKeyframed={hasKeyframeAt(node.grade.brightness, currentFrame)}
            onToggleKeyframe={handleToggleKeyframe('brightness')}
          />
          <Slider
            label="Contrast"
            value={gradeAtCurrentFrame.contrast}
            min={0}
            max={2}
            step={0.01}
            onChange={(v) => handleGradeChange('contrast', v)}
            onReset={handleReset('contrast')}
            displayFormatter={(v) => v.toFixed(2)}
            isKeyframed={hasKeyframeAt(node.grade.contrast, currentFrame)}
            onToggleKeyframe={handleToggleKeyframe('contrast')}
          />
          <Slider
            label="Saturation"
            value={gradeAtCurrentFrame.saturation}
            min={0}
            max={2}
            step={0.01}
            onChange={(v) => handleGradeChange('saturation', v)}
            onReset={handleReset('saturation')}
            displayFormatter={(v) => v.toFixed(2)}
            isKeyframed={hasKeyframeAt(node.grade.saturation, currentFrame)}
            onToggleKeyframe={handleToggleKeyframe('saturation')}
          />
          <Slider
            label="Gain"
            value={gradeAtCurrentFrame.gain}
            min={0}
            max={4}
            step={0.05}
            onChange={(v) => handleGradeChange('gain', v)}
            onReset={handleReset('gain')}
            displayFormatter={(v) => v.toFixed(2)}
            isKeyframed={hasKeyframeAt(node.grade.gain, currentFrame)}
            onToggleKeyframe={handleToggleKeyframe('gain')}
          />
          <Slider
            label="Gamma"
            value={gradeAtCurrentFrame.gamma}
            min={0.01}
            max={4}
            step={0.01}
            onChange={(v) => handleGradeChange('gamma', v)}
            onReset={handleReset('gamma')}
            displayFormatter={(v) => v.toFixed(2)}
            isKeyframed={hasKeyframeAt(node.grade.gamma, currentFrame)}
            onToggleKeyframe={handleToggleKeyframe('gamma')}
          />
        </AttentionPulse>
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
          title={`${node.name} GLSL Code`}
          code={GRADE_SHADER}
          onClose={() => setIsCodeVisible(false)}
        />
      )}
    </>
  );
};

export default GradeAdjustments;
