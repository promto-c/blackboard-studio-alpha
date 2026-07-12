import { describe, expect, it } from 'vitest';
import { NodeType, type AnyNode } from '@blackboard/types';
import { getNodeAssetIds, getRenderOutputContract } from './helpers';
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

describe('node asset descriptors', () => {
  it('collects OCIO file-transform assets through the node definition shorthand', () => {
    expect(
      getNodeAssetIds({
        id: 'ocio-file',
        type: NodeType.OCIO_FILE_TRANSFORM,
        name: 'OCIO File Transform',
        enabled: true,
        assetId: 'asset_lut',
      } as AnyNode),
    ).toEqual(['asset_lut']);
  });
});
