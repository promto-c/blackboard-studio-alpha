import React, { useState } from 'react';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { AnyNode, PixelateNode, UniformUIType, AnyUniform } from '@blackboard/types';
import { CollapsibleSection, Slider, ShaderCodeModal } from '@/components';
import { parseUniformsFromGLSL } from '@/utils/glsl';
import { PIXELATE_SHADER } from './pixelateShader';
import { getValueAtFrame, hasKeyframeAt } from '@blackboard/renderer';

const PixelateAdjustments: React.FC<{ node: AnyNode }> = ({ node: anyNode }) => {
  const node = anyNode as PixelateNode;
  const currentFrame = useEditorSelector((s) => s.currentFrame);
  const { updateNode, setKeyframe } = useEditorActions();
  const [isCodeVisible, setIsCodeVisible] = useState(false);

  const handleUniformChange = (name: string, value: any) => {
    setKeyframe(node.id, `uniforms.${name}.value`, value);
  };

  const handleReset = (name: string) => () => {
    const defaultUniforms = parseUniformsFromGLSL(PIXELATE_SHADER);
    if (defaultUniforms[name]) {
      setKeyframe(node.id, `uniforms.${name}.value`, (defaultUniforms[name] as any).value, true);
    }
  };

  const renderUniformControl = (name: string, uniform: AnyUniform) => {
    if (uniform.ui === UniformUIType.SLIDER) {
      // FIX: Moved getValueAtFrame inside the type guard to ensure correct type.
      const valueAtFrame = getValueAtFrame(uniform.value, currentFrame);
      return (
        <Slider
          key={name}
          label={uniform.label}
          value={valueAtFrame}
          min={uniform.min}
          max={uniform.max}
          step={uniform.step}
          onChange={(v) => handleUniformChange(name, v)}
          onReset={handleReset(name)}
          displayFormatter={(v) => v.toFixed(uniform.step < 1 ? 2 : 0)}
          isKeyframed={hasKeyframeAt(uniform.value, currentFrame)}
          onToggleKeyframe={() => setKeyframe(node.id, `uniforms.${name}.value`)}
        />
      );
    }
    return null;
  };

  return (
    <>
      <CollapsibleSection title="Parameters" defaultOpen>
        <div className="space-y-4">
          {Object.entries(node.uniforms).map(([name, uniform]) =>
            renderUniformControl(name, uniform as AnyUniform),
          )}
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
          title={`${node.name} GLSL Code`}
          code={PIXELATE_SHADER}
          onClose={() => setIsCodeVisible(false)}
        />
      )}
    </>
  );
};

export default PixelateAdjustments;
