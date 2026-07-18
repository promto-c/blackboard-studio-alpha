import type { AnyNode } from '@blackboard/types';
import { ShaderCodeButton } from '@/components';
import { AlphaMathShader, UNPREMULTIPLY_ALPHA_EPSILON } from './alphaMathShader';

type AlphaMathOperation = 'premultiply' | 'unpremultiply';

const OPERATION_CONTENT = {
  premultiply: {
    equation: 'RGB × A',
    description: 'Associates straight RGB with its alpha. Alpha and HDR range are preserved.',
    guidance:
      'Use Unpremultiply before normal straight-alpha compositing or any operation that expects unassociated RGB.',
    shader: AlphaMathShader.PREMULTIPLY,
  },
  unpremultiply: {
    equation: 'RGB ÷ A',
    description: 'Restores straight RGB from an alpha-associated image. Alpha is preserved.',
    guidance: `Pixels with |alpha| ≤ ${UNPREMULTIPLY_ALPHA_EPSILON} become black to avoid unstable division.`,
    shader: AlphaMathShader.UNPREMULTIPLY,
  },
} as const;

function AlphaMathAdjustments({
  node,
  operation,
}: {
  node: AnyNode;
  operation: AlphaMathOperation;
}) {
  const content = OPERATION_CONTENT[operation];

  return (
    <div className="space-y-3 text-xs text-gray-300">
      <div className="rounded-md border border-white/10 bg-gray-950/40 p-3">
        <div className="font-mono text-sm font-semibold text-gray-100">{content.equation}</div>
        <p className="mt-2 leading-5 text-gray-400">{content.description}</p>
        <p className="mt-2 border-t border-white/5 pt-2 text-[10px] leading-4 text-gray-500">
          {content.guidance}
        </p>
      </div>
      <ShaderCodeButton title={`${node.name} GLSL Code`} code={content.shader} />
    </div>
  );
}

export function PremultiplyAdjustments({ node }: { node: AnyNode }) {
  return <AlphaMathAdjustments node={node} operation="premultiply" />;
}

export function UnpremultiplyAdjustments({ node }: { node: AnyNode }) {
  return <AlphaMathAdjustments node={node} operation="unpremultiply" />;
}
