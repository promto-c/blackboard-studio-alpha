import { describe, expect, it } from 'vitest';
import { BlendMode, ImageFitMode, NodeType, type AnyNode } from '@blackboard/types';
import { OUTPUT_NODE_ID } from '@/state/editor/flowModel';
import { buildPipelineOrder, computeAutoLayout } from '@/utils/autoLayoutGraph';

const createSceneNode = (id: string): AnyNode =>
  ({
    id,
    type: NodeType.SCENE,
    name: 'Scene',
    enabled: true,
    width: 1920,
    height: 1080,
    bitDepth: 8,
    colorSpace: 'sRGB',
    maxFrames: 1,
    fps: 24,
  }) as AnyNode;

const createImageNode = (id: string): AnyNode =>
  ({
    id,
    type: NodeType.MEDIA_SOURCE,
    name: 'Image',
    enabled: true,
    mediaKind: 'image',
    src: `${id}.png`,
    width: 512,
    height: 512,
    opacity: 1,
    operator: BlendMode.OVER,
    transform: {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      fitMode: ImageFitMode.FIT,
    },
    colorSpace: 'sRGB',
  }) as AnyNode;

describe('autoLayoutGraph output node identity', () => {
  it('uses the canonical output node id when computing positions', () => {
    const sceneNode = createSceneNode('scene-1');
    const imageNode = createImageNode('image-1');

    const positions = computeAutoLayout([[imageNode]]);

    expect(positions[sceneNode.id]).toBeUndefined();
    expect(positions[OUTPUT_NODE_ID]).toEqual({ x: -96, y: 182 });
    expect(positions['@output']).toBeUndefined();
  });

  it('omits scene and keeps the canonical output node id at the end of the pipeline order', () => {
    const firstImageNode = createImageNode('image-1');
    const secondImageNode = createImageNode('image-2');

    const pipelineOrder = buildPipelineOrder([[firstImageNode], [secondImageNode]]);

    expect(pipelineOrder).toEqual([firstImageNode.id, secondImageNode.id, OUTPUT_NODE_ID]);
  });
});
