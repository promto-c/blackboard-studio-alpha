import { describe, expect, it } from 'vitest';
import { BlendMode, ImageFitMode, NodeType, type SceneNode } from '@blackboard/types';
import {
  createAutoFitTransform,
  createSourceTransformUpdate,
  type SourceTransformNode,
} from './sourceNodeBehavior';

const sceneNode = {
  id: 'scene',
  name: 'Scene',
  enabled: true,
  type: NodeType.SCENE,
  width: 1920,
  height: 1080,
} as SceneNode;

const makeSourceNode = (overrides: Partial<SourceTransformNode> = {}): SourceTransformNode =>
  ({
    id: 'source_a',
    name: 'Source',
    enabled: true,
    type: NodeType.MEDIA_SOURCE,
    src: '',
    mediaKind: 'image',
    width: 256,
    height: 512,
    opacity: 100,
    operator: BlendMode.OVER,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.FIT },
    ...overrides,
  }) as SourceTransformNode;

describe('source node transform behavior', () => {
  it('fits source transforms to the scene', () => {
    const transform = createAutoFitTransform({
      node: makeSourceNode(),
      imageSize: { width: 960, height: 540 },
      sceneNode,
    });

    expect(transform).toMatchObject({ x: 0, y: 0, scaleX: 2, scaleY: 2 });
  });

  it('preserves manual scale when fit mode is custom', () => {
    const node = makeSourceNode({
      transform: { x: 12, y: -8, scaleX: 1.4, scaleY: 1.2, fitMode: ImageFitMode.FIT },
    });

    const update = createSourceTransformUpdate(
      node,
      { transform: { fitMode: ImageFitMode.CUSTOM } },
      { sceneNode },
    );

    expect(update?.changes.transform).toMatchObject({
      x: 12,
      y: -8,
      scaleX: 1.4,
      scaleY: 1.2,
      fitMode: ImageFitMode.CUSTOM,
    });
  });

  it('does not refit custom transforms when the source size changes', () => {
    const node = makeSourceNode({
      transform: { x: 0, y: 0, scaleX: 1.4, scaleY: 1.2, fitMode: ImageFitMode.CUSTOM },
    });

    const update = createSourceTransformUpdate(node, { width: 960, height: 540 }, { sceneNode });

    expect(update).toBeNull();
  });
});
