import { describe, expect, it } from 'vitest';
import { NodeType } from '@blackboard/types';
import { getRenderOutputContract } from './helpers';
import { nodeRegistry } from './registry';

describe('node render output contracts', () => {
  it('exposes Scene 3D as a scene-linear pipeline output', () => {
    expect(getRenderOutputContract(NodeType.SCENE_3D)).toBe('pipeline');
    expect(getRenderOutputContract(NodeType.MEDIA_SOURCE)).toBe('pipeline');
    expect(getRenderOutputContract(NodeType.NOTE)).toBe('none');
    expect(nodeRegistry.get(NodeType.SCENE_3D)).toMatchObject({
      renderOutputContract: 'pipeline',
      outputPorts: [
        expect.objectContaining({
          name: 'output',
          processingDomain: 'scene_linear',
        }),
      ],
      renderOutput: expect.any(Function),
      flags: {
        isRenderable: true,
      },
    });
  });
});
