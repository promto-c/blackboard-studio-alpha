import { describe, expect, it } from 'vitest';
import { NodeType } from '@blackboard/types';
import { nodeRegistry } from '@/nodes/registry';
import { KEYER_SHADER } from './keyerShader';

describe('keyer node definition', () => {
  const keyerNode = nodeRegistry.get(NodeType.KEYER)!;

  it('exposes the modern keyer identity and viewport sample tool', () => {
    expect(keyerNode.type).toBe(NodeType.KEYER);
    expect(keyerNode.name).toBe('Keyer');
    expect(keyerNode.viewportTools).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'keyer_sample', isToggle: true })]),
    );
  });

  it('initializes qualification, matte, despill, and view uniforms', () => {
    const props = keyerNode.getInitialNodeProps();
    const uniforms = props.uniforms as Record<string, unknown>;
    expect(props.matteOverlayWhileAdjusting).toBe(true);
    expect(Object.keys(uniforms)).toEqual(
      expect.arrayContaining([
        'u_keyColor',
        'u_hueLow',
        'u_hueHigh',
        'u_satLow',
        'u_satHigh',
        'u_lumaLow',
        'u_lumaHigh',
        'u_clipBlack',
        'u_clipWhite',
        'u_matteDenoise',
        'u_matteGrow',
        'u_invertMatte',
        'u_despillEnabled',
        'u_despillAmount',
        'u_viewMode',
      ]),
    );
    expect(uniforms).not.toHaveProperty('u_similarity');
  });

  it('uses view modes for RGB diagnostics while preserving keyed alpha', () => {
    expect(KEYER_SHADER).toContain('fragColor = vec4(displayColor, source.a * matte);');
    expect(KEYER_SHADER).not.toMatch(/fragColor\s*=\s*vec4\([^;]+,\s*1\.0\)/);
    expect(KEYER_SHADER).not.toContain('fragColor = source;');
  });
});
