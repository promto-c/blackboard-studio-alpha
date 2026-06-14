import { AnyNode, PixelateNode } from '@blackboard/types';
import { UniformRenderer, ShaderCodeButton } from '@/components';
import { parseUniformsFromGLSL } from '@blackboard/renderer';
import { PIXELATE_SHADER } from './pixelateShader';

function PixelateAdjustments({ node: anyNode }: { node: AnyNode }) {
  const node = anyNode as PixelateNode;

  return (
    <>
      <UniformRenderer
        uniforms={node.uniforms}
        nodeId={node.id}
        getDefaultValue={(name) => {
          const defaults = parseUniformsFromGLSL(PIXELATE_SHADER);
          const u = defaults[name];
          return u && typeof u.value === 'number' ? u.value : undefined;
        }}
      />
      <ShaderCodeButton title={`${node.name} GLSL Code`} code={PIXELATE_SHADER} />
    </>
  );
}

export default PixelateAdjustments;
