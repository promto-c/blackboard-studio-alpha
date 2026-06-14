import { AnyNode, ChromaKeyNode } from '@blackboard/types';
import { UniformRenderer, ShaderCodeButton } from '@/components';
import { parseUniformsFromGLSL } from '@blackboard/renderer';
import { CHROMA_KEY_SHADER } from './chromaKeyShader';
import { useEditorActions } from '@/state/editorContext';

function ChromaKeyAdjustments({ node: anyNode }: { node: AnyNode }) {
  const node = anyNode as ChromaKeyNode;
  const { updateNode } = useEditorActions();

  return (
    <>
      <UniformRenderer
        uniforms={node.uniforms}
        nodeId={node.id}
        sectionTitle="Keying Parameters"
        getDefaultValue={(name) => {
          const defaults = parseUniformsFromGLSL(CHROMA_KEY_SHADER);
          const u = defaults[name];
          return u && typeof u.value === 'number' ? u.value : undefined;
        }}
        onColorChange={(name, value) => {
          const newUniforms = {
            ...node.uniforms,
            [name]: { ...node.uniforms[name], value },
          };
          updateNode(node.id, { uniforms: newUniforms }, true);
        }}
      />
      <ShaderCodeButton title={`${node.name} GLSL Code`} code={CHROMA_KEY_SHADER} />
    </>
  );
}

export default ChromaKeyAdjustments;
