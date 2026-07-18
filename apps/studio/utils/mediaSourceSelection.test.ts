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
import { createDefaultGrade } from '@/nodes/effects/grade/gradeModel';
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
  enabled: true,
  width: 1920,
  height: 1080,
  bitDepth: 16,
  colorSpace: 'Linear',
  startFrame: 0,
  maxFrames: 0,
  fps: 30,
};

const IMAGE_NODE: AnyNode = {
  id: 'img-1',
  type: NodeType.MEDIA_SOURCE,
  mediaKind: 'image',
  name: 'Plate',
  enabled: true,
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
  type: NodeType.MEDIA_SOURCE,
  mediaKind: 'video',
  name: 'Alt Plate',
  enabled: true,
  src: 'alt-plate',
  width: 1920,
  height: 1080,
  opacity: 100,
  operator: BlendMode.OVER,
  duration: 10,
  transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.NONE },
};

const GRADE_NODE = {
  id: 'grade-1',
  type: NodeType.GRADE,
  name: 'Look',
  enabled: true,
  stacked: true,
  grade: createDefaultGrade(),
} as AnyNode;

const ROTO_NODE: AnyNode = {
  id: 'roto-1',
  type: NodeType.ROTO,
  name: 'Roto',
  enabled: true,
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
      {
        value: MEDIA_SOURCE_UPSTREAM,
        label: 'Upstream Result',
        kind: 'upstream',
        description: 'Composited upstream flow',
      },
      {
        value: 'img-1',
        label: 'Plate',
        kind: 'media-source',
        description: 'Media source node',
      },
      {
        value: 'vid-1',
        label: 'Alt Plate',
        kind: 'media-source',
        description: 'Media source node',
      },
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
      {
        value: MEDIA_SOURCE_UPSTREAM,
        label: 'Upstream Result',
        kind: 'upstream',
        description: 'Composited upstream flow',
      },
    ]);
  });

  it('detects when upstream resolves to a raw media source node', () => {
    const nodes = [SCENE_NODE, IMAGE_NODE, ROTO_NODE];

    expect(getUpstreamMediaSourceNode(nodes, 'roto-1')).toEqual(IMAGE_NODE);
  });

  it('does not expose upstream when the roto node has no non-scene nodes before it', () => {
    const nodes = [SCENE_NODE, ROTO_NODE, IMAGE_NODE];

    expect(getDefaultMediaSourceId(nodes, 'roto-1')).toBe('');
    expect(getMediaSourceOptions(nodes, 'roto-1')).toEqual([
      {
        value: 'img-1',
        label: 'Plate',
        kind: 'media-source',
        description: 'Media source node',
      },
    ]);
    expect(isValidMediaSourceId(nodes, 'roto-1', MEDIA_SOURCE_UPSTREAM)).toBe(false);
  });
});
