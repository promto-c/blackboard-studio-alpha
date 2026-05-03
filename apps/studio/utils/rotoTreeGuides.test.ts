import { describe, expect, it } from 'vitest';
import {
  NodeType,
  RotoDrawMode,
  RotoPathBlend,
  RotoShapeType,
  type RotoNode,
} from '@blackboard/types';
import { buildRotoHierarchy } from './rotoHierarchy';
import { TREE_GUIDE_START, TREE_GUIDE_STEP, collectTreeGuideSegments } from './rotoTreeGuides';

const makePath = (id: string, name: string, parentLayerId: string | null = null) => ({
  id,
  name,
  parentLayerId,
  shapeType: RotoShapeType.BSPLINE,
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
    { x: 20, y: 5 },
  ],
  closed: true,
  feather: 0,
  opacity: 100,
  blend: RotoPathBlend.ADD,
  style: {
    mode: RotoDrawMode.FILL,
    strokeWidth: 2,
  },
});

const makeNode = (overrides: Partial<RotoNode> = {}): RotoNode => ({
  id: 'roto_1',
  type: NodeType.ROTO,
  name: 'Roto',
  visible: true,
  paths: [],
  layers: [],
  invert: false,
  ...overrides,
});

describe('collectTreeGuideSegments', () => {
  it('stops a parent guide at the last direct child row', () => {
    const hierarchy = buildRotoHierarchy(
      makeNode({
        layers: [
          { id: 'layer_root', name: 'Root' },
          { id: 'layer_child', name: 'Child', parentLayerId: 'layer_root' },
        ],
        paths: [makePath('path_leaf', 'Leaf', 'layer_child')],
      }),
    );

    const segments = collectTreeGuideSegments(
      hierarchy,
      new Map([
        ['layer:layer_root', { top: 0, height: 28 }],
        ['layer:layer_child', { top: 28, height: 28 }],
        ['path:path_leaf', { top: 56, height: 28 }],
      ]),
    );

    expect(segments.find((segment) => segment.key === 'vertical:layer:layer_root')).toEqual({
      key: 'vertical:layer:layer_root',
      orientation: 'vertical',
      left: TREE_GUIDE_START,
      top: 14,
      height: 28,
    });
    expect(segments.find((segment) => segment.key === 'vertical:layer:layer_child')).toEqual({
      key: 'vertical:layer:layer_child',
      orientation: 'vertical',
      left: TREE_GUIDE_START + TREE_GUIDE_STEP,
      top: 42,
      height: 28,
    });
  });

  it('keeps the parent guide running through earlier descendants when a later sibling exists', () => {
    const hierarchy = buildRotoHierarchy(
      makeNode({
        layers: [
          { id: 'layer_root', name: 'Root' },
          { id: 'layer_child', name: 'Child', parentLayerId: 'layer_root' },
        ],
        paths: [
          makePath('path_leaf', 'Leaf', 'layer_child'),
          makePath('path_sibling', 'Sibling', 'layer_root'),
        ],
      }),
    );

    const segments = collectTreeGuideSegments(
      hierarchy,
      new Map([
        ['layer:layer_root', { top: 0, height: 28 }],
        ['layer:layer_child', { top: 28, height: 28 }],
        ['path:path_leaf', { top: 56, height: 28 }],
        ['path:path_sibling', { top: 84, height: 28 }],
      ]),
    );

    expect(segments.find((segment) => segment.key === 'vertical:layer:layer_root')).toEqual({
      key: 'vertical:layer:layer_root',
      orientation: 'vertical',
      left: TREE_GUIDE_START,
      top: 14,
      height: 84,
    });
  });
});
