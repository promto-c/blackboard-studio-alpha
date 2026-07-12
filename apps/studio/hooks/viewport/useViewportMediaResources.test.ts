import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { NodeKind, NodeType, type AnyNode } from '@blackboard/types';
import { TextureCache } from '@/utils/textureCache';
import { areViewportMediaNodesReady } from './useViewportMediaResources';
import { getGeneratedOutputAssetIdsAt } from './useViewportMediaCache';

const imageNode = (enabled = true): AnyNode =>
  ({
    id: 'image',
    kind: NodeKind.EFFECT,
    type: NodeType.MEDIA_SOURCE,
    name: 'Image',
    enabled,
    mediaKind: 'image',
    src: 'asset:image',
    width: 100,
    height: 100,
    opacity: 100,
  }) as AnyNode;

describe('areViewportMediaNodesReady', () => {
  it('waits for enabled media nodes and ignores disabled ones', () => {
    const cache = new TextureCache();

    expect(areViewportMediaNodesReady([imageNode()], 0, cache)).toBe(false);
    expect(areViewportMediaNodesReady([imageNode(false)], 0, cache)).toBe(true);

    cache.add('asset:image', new THREE.Texture());
    expect(areViewportMediaNodesReady([imageNode()], 0, cache)).toBe(true);
    cache.clear();
  });

  it('preloads and waits for an enabled Comfy difference-mask reference', () => {
    const node = {
      id: 'comfy',
      type: NodeType.COMFY,
      name: 'Comfy',
      enabled: true,
      generatedOutputs: [
        {
          id: 'output',
          src: 'asset:output',
          width: 100,
          height: 100,
          createdAt: 1,
          differenceMask: {
            enabled: true,
            referenceAssetId: 'asset:reference',
            referenceWidth: 100,
            referenceHeight: 100,
            thresholdLow: 0.06,
            thresholdHigh: 0.18,
            edgeAdjustment: 0,
            removeSpecks: 0,
            fillHoles: 0,
          },
        },
      ],
    } as AnyNode;
    const cache = new TextureCache();

    expect(getGeneratedOutputAssetIdsAt(node, 0)).toEqual(['asset:output', 'asset:reference']);

    cache.add('asset:output', new THREE.Texture());
    expect(areViewportMediaNodesReady([node], 0, cache)).toBe(false);

    cache.add('asset:reference', new THREE.Texture());
    expect(areViewportMediaNodesReady([node], 0, cache)).toBe(true);
    cache.clear();
  });
});
