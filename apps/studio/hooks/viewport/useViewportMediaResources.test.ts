import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { NodeKind, NodeType, type AnyNode } from '@blackboard/types';
import { TextureCache } from '@/utils/textureCache';
import { areViewportMediaNodesReady } from './useViewportMediaResources';

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
});
