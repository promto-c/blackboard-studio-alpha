import { AnyNode, LensDistortionNode } from '@blackboard/types';
import { UniformRenderer, ShaderCodeButton } from '@/components';
import { parseUniformsFromGLSL } from '@blackboard/renderer';
import { LENS_DISTORTION_SHADER } from './lensDistortionShader';

function LensDistortionAdjustments({ node: anyNode }: { node: AnyNode }) {
  const node = anyNode as LensDistortionNode;

  return (
    <>
      <UniformRenderer
        uniforms={node.uniforms}
        nodeId={node.id}
        getDefaultValue={(name) => {
          const defaults = parseUniformsFromGLSL(LENS_DISTORTION_SHADER);
          const u = defaults[name];
          return u && typeof u.value === 'number' ? u.value : undefined;
        }}
      />
      <ShaderCodeButton title={`${node.name} GLSL Code`} code={LENS_DISTORTION_SHADER} />
    </>
  );
}

export default LensDistortionAdjustments;
