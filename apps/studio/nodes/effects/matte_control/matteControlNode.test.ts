import { describe, expect, it } from 'vitest';
import { NodeType, type MatteControlNode } from '@blackboard/types';
import { nodeRegistry } from '@/nodes/registry';
import { resolveRendererNodeProcessingDomain } from '@blackboard/renderer';
import { usesPipelineInput } from '@/utils/nodePredicates';
import { resolveMatteControlSettings } from './matteControlModel';
import {
  MATTE_CONTROL_DIRECT_SHADER,
  MATTE_CONTROL_FINAL_SHADER,
  MATTE_CONTROL_PREPARE_SHADER,
} from './matteControlShaders';

describe('Matte Control node', () => {
  const definition = nodeRegistry.get(NodeType.MATTE_CONTROL)!;

  it('registers as a standard unary image node', () => {
    expect(definition).toMatchObject({
      type: NodeType.MATTE_CONTROL,
      name: 'Matte Control',
      category: 'Utility',
      renderMode: 'mask',
      processingDomain: 'scene_linear',
    });
    expect(definition.inputPorts).toBeUndefined();
    expect(definition.outputPorts).toBeUndefined();
    expect(usesPipelineInput(NodeType.MATTE_CONTROL)).toBe(true);

    const node = {
      id: 'matte-control',
      type: NodeType.MATTE_CONTROL,
      name: 'Matte Control',
      enabled: true,
      ...definition.getInitialNodeProps(),
    } as MatteControlNode;
    expect(resolveRendererNodeProcessingDomain(definition, node, 'output')).toBe('scene_linear');
  });

  it('creates neutral matte-finesse defaults', () => {
    expect(definition.getInitialNodeProps()).toEqual({
      matteControl: {
        erodeDilate: 0,
        edgeBlur: 0,
        clampBlack: 0,
        clampWhite: 1,
        invert: false,
      },
    });
  });

  it('refines the primary image alpha and preserves straight RGB', () => {
    expect(MATTE_CONTROL_PREPARE_SHADER).toContain('texture(u_tSource, v_uv).a');
    expect(MATTE_CONTROL_PREPARE_SHADER).not.toContain('ExternalMatte');
    expect(MATTE_CONTROL_DIRECT_SHADER).toContain('vec4(source.rgb, matte)');
    expect(MATTE_CONTROL_FINAL_SHADER).toContain('vec4(source.rgb, matte)');
  });

  it('bounds animated radii and normalizes crossing clamp points at render time', () => {
    const node = {
      id: 'matte-control',
      type: NodeType.MATTE_CONTROL,
      name: 'Matte Control',
      enabled: true,
      matteControl: {
        erodeDilate: 80,
        edgeBlur: -4,
        clampBlack: 0.8,
        clampWhite: 0.2,
        invert: false,
      },
    } as MatteControlNode;

    expect(resolveMatteControlSettings(node, 0)).toMatchObject({
      erodeDilate: 32,
      edgeBlur: 0,
      clampBlack: 0.2,
      clampWhite: 0.8,
    });
  });
});
