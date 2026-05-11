import { describe, expect, it } from 'vitest';
import {
  BlendMode,
  ImageFitMode,
  NodeType,
  RotoDrawMode,
  RotoPathBlend,
  RotoShapeType,
  type AnyNode,
} from '@blackboard/types';
import {
  MEDIA_SOURCE_UPSTREAM,
  getDefaultMediaSourceId,
  getUpstreamMediaSourceNode,
  getMediaSourceOptions,
  getUpstreamSourceNodes,
  isValidMediaSourceId,
} from './mediaSourceSelection';

const SCENE_NODE: AnyNode = {
  id: 'scene',
  type: NodeType.SCENE,
  name: 'Scene',
  visible: true,
  width: 1920,
  height: 1080,
  bitDepth: 16,
  colorSpace: 'Linear',
  maxFrames: 0,
  fps: 30,
};

const IMAGE_NODE: AnyNode = {
  id: 'img-1',
  type: NodeType.IMAGE,
  name: 'Plate',
  visible: true,
  src: 'plate',
  width: 1920,
  height: 1080,
  opacity: 100,
  operator: BlendMode.OVER,
  colorSpace: 'sRGB',
  transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.NONE },
};

const VIDEO_NODE: AnyNode = {
  id: 'vid-1',
  type: NodeType.VIDEO,
  name: 'Alt Plate',
  visible: true,
  src: 'alt-plate',
  width: 1920,
  height: 1080,
  opacity: 100,
  operator: BlendMode.OVER,
  duration: 10,
  loop: true,
  transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.NONE },
};

const GRADE_NODE: AnyNode = {
  id: 'grade-1',
  type: NodeType.GRADE,
  name: 'Look',
  visible: true,
  stacked: true,
  grade: {
    brightness: 0,
    contrast: 1,
    saturation: 1,
    gain: 1,
    gamma: 1,
  },
};

const ROTO_NODE: AnyNode = {
  id: 'roto-1',
  type: NodeType.ROTO,
  name: 'Roto',
  visible: true,
  invert: false,
  paths: [
    {
      id: 'shape-1',
      name: 'Shape 1',
      shapeType: RotoShapeType.POLYGON,
      points: [],
      closed: true,
      feather: 0,
      opacity: 100,
      blend: RotoPathBlend.ADD,
      style: { mode: RotoDrawMode.FILL, strokeWidth: 1 },
    },
  ],
};

describe('mediaSourceSelection', () => {
  it('offers upstream result before direct media sources when the roto node has upstream content', () => {
    const nodes = [SCENE_NODE, IMAGE_NODE, GRADE_NODE, ROTO_NODE, VIDEO_NODE];

    expect(getMediaSourceOptions(nodes, 'roto-1')).toEqual([
      { value: MEDIA_SOURCE_UPSTREAM, label: 'Upstream Result' },
      { value: 'img-1', label: 'Plate' },
      { value: 'vid-1', label: 'Alt Plate' },
    ]);
  });

  it('prefers upstream result as the default when upstream content exists', () => {
    const nodes = [SCENE_NODE, IMAGE_NODE, GRADE_NODE, ROTO_NODE, VIDEO_NODE];

    expect(getDefaultMediaSourceId(nodes, 'roto-1')).toBe(MEDIA_SOURCE_UPSTREAM);
    expect(isValidMediaSourceId(nodes, 'roto-1', MEDIA_SOURCE_UPSTREAM)).toBe(true);
    expect(getUpstreamSourceNodes(nodes, 'roto-1')).toEqual([SCENE_NODE, IMAGE_NODE, GRADE_NODE]);
  });

  it('falls back to upstream when no direct media source precedes the roto node', () => {
    const nodes = [SCENE_NODE, GRADE_NODE, ROTO_NODE];

    expect(getDefaultMediaSourceId(nodes, 'roto-1')).toBe(MEDIA_SOURCE_UPSTREAM);
    expect(getMediaSourceOptions(nodes, 'roto-1')).toEqual([
      { value: MEDIA_SOURCE_UPSTREAM, label: 'Upstream Result' },
    ]);
  });

  it('detects when upstream resolves to a raw media source node', () => {
    const nodes = [SCENE_NODE, IMAGE_NODE, ROTO_NODE];

    expect(getUpstreamMediaSourceNode(nodes, 'roto-1')).toEqual(IMAGE_NODE);
  });

  it('does not expose upstream when the roto node has no non-scene nodes before it', () => {
    const nodes = [SCENE_NODE, ROTO_NODE, IMAGE_NODE];

    expect(getDefaultMediaSourceId(nodes, 'roto-1')).toBe('');
    expect(getMediaSourceOptions(nodes, 'roto-1')).toEqual([{ value: 'img-1', label: 'Plate' }]);
    expect(isValidMediaSourceId(nodes, 'roto-1', MEDIA_SOURCE_UPSTREAM)).toBe(false);
  });
});
