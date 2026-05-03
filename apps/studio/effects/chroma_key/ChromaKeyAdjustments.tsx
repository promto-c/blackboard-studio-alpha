import React, { useState } from 'react';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { AnyNode, ChromaKeyNode, UniformUIType, AnyUniform } from '@blackboard/types';
import { Slider, ColorPicker, CollapsibleSection, ShaderCodeModal } from '@/components';
import { parseUniformsFromGLSL } from '@/utils/glsl';
import { CHROMA_KEY_SHADER } from './chromaKeyShader';
import { getValueAtFrame, hasKeyframeAt } from '@blackboard/renderer';

const ChromaKeyAdjustments: React.FC<{ node: AnyNode }> = ({ node: anyNode }) => {
  const node = anyNode as ChromaKeyNode;
  const currentFrame = useEditorSelector((s) => s.currentFrame);
  const { updateNode, setKeyframe } = useEditorActions();
  const [isCodeVisible, setIsCodeVisible] = useState(false);

  const handleUniformChange = (name: string, value: any) => {
    setKeyframe(node.id, `uniforms.${name}.value`, value);
  };

  const handleColorUniformChange = (name: string, value: any) => {
    const newUniforms = {
      ...node.uniforms,
      [name]: { ...node.uniforms[name], value: value },
    };
    updateNode(node.id, { uniforms: newUniforms }, true);
  };

  const handleReset = (name: string) => () => {
    const defaultUniforms = parseUniformsFromGLSL(CHROMA_KEY_SHADER);
    if (defaultUniforms[name]) {
      setKeyframe(node.id, `uniforms.${name}.value`, (defaultUniforms[name] as any).value, true);
    }
  };

  const renderUniformControl = (name: string, uniform: AnyUniform) => {
    if (uniform.ui === UniformUIType.SLIDER) {
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
          displayFormatter={(v) => v.toFixed(3)}
          isKeyframed={hasKeyframeAt(uniform.value, currentFrame)}
          onToggleKeyframe={() => setKeyframe(node.id, `uniforms.${name}.value`)}
        />
      );
    }
    if (uniform.ui === UniformUIType.COLOR) {
      return (
        <ColorPicker
          key={name}
          label={uniform.label}
          value={uniform.value as [number, number, number]}
          onChange={(v) => handleColorUniformChange(name, v)}
        />
      );
    }
    return null;
  };

  return (
    <>
      <CollapsibleSection title="Keying Parameters" defaultOpen>
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
          code={CHROMA_KEY_SHADER}
          onClose={() => setIsCodeVisible(false)}
        />
      )}
    </>
  );
};

export default ChromaKeyAdjustments;
