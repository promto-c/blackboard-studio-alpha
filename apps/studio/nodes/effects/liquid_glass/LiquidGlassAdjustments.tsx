import { AnyNode, LiquidGlassNode } from '@blackboard/types';
import { UniformRenderer, ShaderCodeButton } from '@/components';
import { parseUniformsFromGLSL } from '@blackboard/renderer';
import { LIQUID_GLASS_SHADER } from './liquidGlassShader';

function LiquidGlassAdjustments({ node: anyNode }: { node: AnyNode }) {
  const node = anyNode as LiquidGlassNode;

  return (
    <>
      <UniformRenderer
        uniforms={node.uniforms}
        nodeId={node.id}
        getDefaultValue={(name) => {
          const defaults = parseUniformsFromGLSL(LIQUID_GLASS_SHADER);
          const u = defaults[name];
          return u && typeof u.value === 'number' ? u.value : undefined;
        }}
      />
      <ShaderCodeButton title={`${node.name} GLSL Code`} code={LIQUID_GLASS_SHADER} />
    </>
  );
}

export default LiquidGlassAdjustments;
