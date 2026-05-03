import { describe, expect, it } from 'vitest';
import {
  NodeType,
  RotoDrawMode,
  RotoPathBlend,
  RotoShapeType,
  type RotoNode,
} from '@blackboard/types';
import {
  buildRotoHierarchy,
  createRotoLayerFromHierarchySelection,
  createRotoLayerFromLayerSelection,
  createRotoLayerFromSelection,
  deleteRotoLayer,
  getRotoCreationParentLayerId,
  getRotoHierarchyStructureSignature,
  getVisibleRotoPaths,
  isRotoPathActiveAtFrame,
  isRotoPathVisible,
  moveRotoHierarchyItem,
  moveRotoHierarchyItems,
  moveRotoLayer,
  prependRotoPath,
} from './rotoHierarchy';

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

describe('buildRotoHierarchy', () => {
  it('builds nested layers and keeps path counts on each branch', () => {
    const node = makeNode({
      layers: [
        { id: 'layer_face', name: 'Face' },
        { id: 'layer_eyes', name: 'Eyes', parentLayerId: 'layer_face' },
      ],
      paths: [
        makePath('shape_head', 'Head', 'layer_face'),
        makePath('shape_eye_l', 'Eye L', 'layer_eyes'),
        makePath('shape_bg', 'Background'),
      ],
    });

    const hierarchy = buildRotoHierarchy(node);

    expect(hierarchy).toHaveLength(2);
    expect(hierarchy[0]).toMatchObject({
      type: 'layer',
      layer: { id: 'layer_face', name: 'Face' },
      pathCount: 2,
    });
    expect(hierarchy[1]).toMatchObject({
      type: 'path',
      path: { id: 'shape_bg', name: 'Background' },
    });

    const faceLayer = hierarchy[0];
    expect(faceLayer.type).toBe('layer');
    if (faceLayer.type !== 'layer') {
      throw new Error('Expected top-level hierarchy item to be a layer');
    }
    expect(faceLayer.children[0]).toMatchObject({
      type: 'layer',
      layer: { id: 'layer_eyes', name: 'Eyes' },
      pathCount: 1,
    });
  });

  it('shows a newly added shape above sibling layers at the same level', () => {
    const node = makeNode({
      layers: [{ id: 'layer_face', name: 'Face', stackOrder: 1 }],
    });

    const updates = prependRotoPath(node, makePath('shape_new', 'New Shape'));
    const hierarchy = buildRotoHierarchy({ ...node, ...updates });

    expect(hierarchy[0]).toMatchObject({
      type: 'path',
      path: { id: 'shape_new', name: 'New Shape' },
    });
    expect(hierarchy[1]).toMatchObject({
      type: 'layer',
      layer: { id: 'layer_face', name: 'Face' },
    });
  });
});

describe('isRotoPathVisible', () => {
  it('inherits hidden state from parent layers', () => {
    const node = makeNode({
      layers: [{ id: 'layer_hidden', name: 'Hidden', visible: false }],
      paths: [makePath('shape_hidden', 'Hidden Shape', 'layer_hidden')],
    });

    expect(isRotoPathVisible(node, node.paths[0])).toBe(false);
  });
});

describe('getVisibleRotoPaths', () => {
  it('returns only paths whose own visibility and parent layer chain are visible', () => {
    const node = makeNode({
      layers: [
        { id: 'layer_hidden', name: 'Hidden', visible: false },
        { id: 'layer_visible', name: 'Visible' },
        { id: 'layer_nested_hidden', name: 'Nested Hidden', parentLayerId: 'layer_hidden' },
      ],
      paths: [
        makePath('shape_visible', 'Visible Shape', 'layer_visible'),
        makePath('shape_top_level', 'Top Level Shape'),
        makePath('shape_hidden', 'Hidden Shape', 'layer_hidden'),
        makePath('shape_nested_hidden', 'Nested Hidden Shape', 'layer_nested_hidden'),
        { ...makePath('shape_self_hidden', 'Self Hidden Shape', 'layer_visible'), visible: false },
      ],
    });

    expect(getVisibleRotoPaths(node).map((path) => path.id)).toEqual([
      'shape_visible',
      'shape_top_level',
    ]);
  });
});

describe('isRotoPathActiveAtFrame', () => {
  it('treats zero-opacity paths as inactive for that frame', () => {
    const node = makeNode({
      paths: [{ ...makePath('shape_hidden', 'Hidden Shape'), opacity: 0 }],
    });

    expect(isRotoPathActiveAtFrame(node, node.paths[0], 0)).toBe(false);
  });

  it('evaluates animated opacity per frame', () => {
    const node = makeNode({
      paths: [
        {
          ...makePath('shape_animated', 'Animated Shape'),
          opacity: [
            { frame: 0, value: 100 },
            { frame: 10, value: 0 },
          ],
        },
      ],
    });

    expect(isRotoPathActiveAtFrame(node, node.paths[0], 0)).toBe(true);
    expect(isRotoPathActiveAtFrame(node, node.paths[0], 10)).toBe(false);
  });
});

describe('getRotoHierarchyStructureSignature', () => {
  it('ignores point edits that do not change the visible tree structure', () => {
    const node = makeNode({
      layers: [{ id: 'layer_face', name: 'Face', expanded: true }],
      paths: [makePath('shape_a', 'A', 'layer_face')],
    });

    const updatedPointsNode = makeNode({
      ...node,
      paths: [
        {
          ...node.paths[0],
          points: [
            { x: 100, y: 50 },
            { x: 120, y: 25 },
            { x: 140, y: 75 },
          ],
        },
      ],
    });

    expect(getRotoHierarchyStructureSignature(updatedPointsNode)).toBe(
      getRotoHierarchyStructureSignature(node),
    );
  });

  it('changes when hierarchy-visible metadata changes', () => {
    const node = makeNode({
      layers: [{ id: 'layer_face', name: 'Face', expanded: true }],
      paths: [makePath('shape_a', 'A', 'layer_face')],
    });

    const collapsedLayerNode = makeNode({
      ...node,
      layers: [{ ...node.layers[0], expanded: false }],
    });

    expect(getRotoHierarchyStructureSignature(collapsedLayerNode)).not.toBe(
      getRotoHierarchyStructureSignature(node),
    );
  });
});

describe('createRotoLayerFromSelection', () => {
  it('wraps selected shapes inside a new layer at their common parent', () => {
    const node = makeNode({
      layers: [{ id: 'layer_face', name: 'Face' }],
      paths: [makePath('shape_a', 'A', 'layer_face'), makePath('shape_b', 'B', 'layer_face')],
    });

    const { layer, updates } = createRotoLayerFromSelection(node, ['shape_a', 'shape_b'], 'Eyes');

    expect(layer.parentLayerId).toBe('layer_face');
    expect(updates.layers).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: layer.id, name: 'Eyes' })]),
    );
    expect(updates.paths.every((path) => path.parentLayerId === layer.id)).toBe(true);
    expect(updates.layers[0]?.id).toBe(layer.id);
  });

  it('preserves current shape order even when ids are provided out of order', () => {
    const node = makeNode({
      paths: [
        { ...makePath('shape_a', 'A'), stackOrder: 3 },
        { ...makePath('shape_b', 'B'), stackOrder: 2 },
        { ...makePath('shape_c', 'C'), stackOrder: 1 },
      ],
    });

    const { layer, updates } = createRotoLayerFromSelection(node, ['shape_c', 'shape_a'], 'Wrap');
    const hierarchy = buildRotoHierarchy({ ...node, ...updates });

    expect(hierarchy[0]).toMatchObject({
      type: 'layer',
      layer: { id: layer.id },
    });

    const wrapperLayer = hierarchy[0];
    expect(wrapperLayer.type).toBe('layer');
    if (wrapperLayer.type !== 'layer') {
      throw new Error('Expected wrapper item to be a layer');
    }

    expect(
      wrapperLayer.children.map((item) => (item.type === 'path' ? item.path.id : item.layer.id)),
    ).toEqual(['shape_a', 'shape_c']);
  });
});

describe('createRotoLayerFromLayerSelection', () => {
  it('inserts wrapped layers at the top of the sibling order', () => {
    const node = makeNode({
      layers: [
        { id: 'layer_face', name: 'Face' },
        { id: 'layer_eyes', name: 'Eyes', parentLayerId: 'layer_face' },
      ],
    });

    const { layer, updates } = createRotoLayerFromLayerSelection(node, ['layer_eyes'], 'Detail');

    expect(updates.layers[0]?.id).toBe(layer.id);
    expect(updates.layers.find((existingLayer) => existingLayer.id === 'layer_eyes')).toMatchObject(
      {
        parentLayerId: layer.id,
      },
    );
  });

  it('preserves current layer order even when ids are provided out of order', () => {
    const node = makeNode({
      layers: [
        { id: 'layer_a', name: 'A', stackOrder: 3 },
        { id: 'layer_b', name: 'B', stackOrder: 2 },
        { id: 'layer_c', name: 'C', stackOrder: 1 },
      ],
    });

    const { layer, updates } = createRotoLayerFromLayerSelection(node, ['layer_c', 'layer_a']);
    const hierarchy = buildRotoHierarchy({ ...node, ...updates });

    expect(hierarchy[0]).toMatchObject({
      type: 'layer',
      layer: { id: layer.id },
    });

    const wrapperLayer = hierarchy[0];
    expect(wrapperLayer.type).toBe('layer');
    if (wrapperLayer.type !== 'layer') {
      throw new Error('Expected wrapper item to be a layer');
    }

    expect(
      wrapperLayer.children.map((item) => (item.type === 'path' ? item.path.id : item.layer.id)),
    ).toEqual(['layer_a', 'layer_c']);
  });
});

describe('createRotoLayerFromHierarchySelection', () => {
  it('wraps mixed selected layers and shapes into one new layer', () => {
    const node = makeNode({
      layers: [{ id: 'layer_face', name: 'Face', stackOrder: 3 }],
      paths: [
        { ...makePath('shape_a', 'A'), stackOrder: 2 },
        { ...makePath('shape_b', 'B'), stackOrder: 1 },
      ],
    });

    const { layer, updates } = createRotoLayerFromHierarchySelection(node, [
      { type: 'layer', id: 'layer_face' },
      { type: 'path', id: 'shape_a' },
    ]);
    const hierarchy = buildRotoHierarchy({ ...node, ...updates });

    expect(layer.parentLayerId).toBe(null);
    expect(hierarchy[0]).toMatchObject({
      type: 'layer',
      layer: { id: layer.id },
    });
    expect(hierarchy[1]).toMatchObject({
      type: 'path',
      path: { id: 'shape_b' },
    });

    const wrapperLayer = hierarchy[0];
    expect(wrapperLayer.type).toBe('layer');
    if (wrapperLayer.type !== 'layer') {
      throw new Error('Expected wrapper item to be a layer');
    }

    expect(
      wrapperLayer.children.map((item) => (item.type === 'path' ? item.path.id : item.layer.id)),
    ).toEqual(['layer_face', 'shape_a']);
  });

  it('does not duplicate selected shapes that are already inside a selected layer', () => {
    const node = makeNode({
      layers: [{ id: 'layer_face', name: 'Face', stackOrder: 2 }],
      paths: [{ ...makePath('shape_a', 'A', 'layer_face'), stackOrder: 1 }],
    });

    const { layer, updates } = createRotoLayerFromHierarchySelection(node, [
      { type: 'layer', id: 'layer_face' },
      { type: 'path', id: 'shape_a' },
    ]);
    const hierarchy = buildRotoHierarchy({ ...node, ...updates });

    expect(hierarchy[0]).toMatchObject({
      type: 'layer',
      layer: { id: layer.id },
    });

    const wrapperLayer = hierarchy[0];
    expect(wrapperLayer.type).toBe('layer');
    if (wrapperLayer.type !== 'layer') {
      throw new Error('Expected wrapper item to be a layer');
    }

    expect(wrapperLayer.children).toHaveLength(1);
    expect(wrapperLayer.children[0]).toMatchObject({
      type: 'layer',
      layer: { id: 'layer_face', parentLayerId: layer.id },
    });
  });
});

describe('getRotoCreationParentLayerId', () => {
  it('prefers a single selected layer over selected shape parents', () => {
    const node = makeNode({
      layers: [{ id: 'layer_face', name: 'Face' }],
      paths: [makePath('shape_a', 'A')],
    });

    expect(getRotoCreationParentLayerId(node, ['layer_face'], ['shape_a'])).toBe('layer_face');
  });
});

describe('deleteRotoLayer', () => {
  it('reparents child layers and shapes to the deleted layer parent', () => {
    const node = makeNode({
      layers: [
        { id: 'layer_root', name: 'Root Group' },
        { id: 'layer_child', name: 'Child Group', parentLayerId: 'layer_root' },
      ],
      paths: [makePath('shape_1', 'Shape 1', 'layer_child')],
    });

    const updates = deleteRotoLayer(node, 'layer_root');

    expect(updates.layers).toEqual([
      expect.objectContaining({ id: 'layer_child', parentLayerId: null }),
    ]);
    expect(updates.paths).toEqual([
      expect.objectContaining({ id: 'shape_1', parentLayerId: 'layer_child' }),
    ]);
  });
});

describe('moveRotoLayer', () => {
  it('prevents cycles when moving a layer beneath its own descendant', () => {
    const node = makeNode({
      layers: [
        { id: 'layer_root', name: 'Root Group' },
        { id: 'layer_child', name: 'Child Group', parentLayerId: 'layer_root' },
      ],
    });

    const updates = moveRotoLayer(node, 'layer_root', 'layer_child');

    expect(updates.layers.find((layer) => layer.id === 'layer_root')?.parentLayerId).toBe(null);
  });
});

describe('moveRotoHierarchyItem', () => {
  it('reorders mixed siblings within the same parent using one shared stack order', () => {
    const node = makeNode({
      layers: [{ id: 'layer_face', name: 'Face', stackOrder: 2 }],
      paths: [
        { ...makePath('shape_a', 'A'), stackOrder: 1 },
        { ...makePath('shape_b', 'B'), stackOrder: 0 },
      ],
    });

    const updates = moveRotoHierarchyItem(node, { type: 'path', id: 'shape_b' }, null, 0);
    const hierarchy = buildRotoHierarchy({ ...node, ...updates });

    expect(hierarchy.map((item) => (item.type === 'layer' ? item.layer.id : item.path.id))).toEqual(
      ['shape_b', 'layer_face', 'shape_a'],
    );
  });

  it('reparents a shape into a target layer at the requested child slot', () => {
    const node = makeNode({
      layers: [{ id: 'layer_face', name: 'Face', stackOrder: 1 }],
      paths: [{ ...makePath('shape_a', 'A'), stackOrder: 2 }],
    });

    const updates = moveRotoHierarchyItem(node, { type: 'path', id: 'shape_a' }, 'layer_face', 0);
    const hierarchy = buildRotoHierarchy({ ...node, ...updates });

    expect(hierarchy).toHaveLength(1);
    expect(hierarchy[0]).toMatchObject({
      type: 'layer',
      layer: { id: 'layer_face' },
    });

    const faceLayer = hierarchy[0];
    expect(faceLayer.type).toBe('layer');
    if (faceLayer.type !== 'layer') {
      throw new Error('Expected top-level hierarchy item to be a layer');
    }

    expect(faceLayer.children[0]).toMatchObject({
      type: 'path',
      path: { id: 'shape_a', parentLayerId: 'layer_face' },
    });
  });

  it('keeps layer parents unchanged when a drag would create a cycle', () => {
    const node = makeNode({
      layers: [
        { id: 'layer_root', name: 'Root Group', stackOrder: 2 },
        { id: 'layer_child', name: 'Child Group', parentLayerId: 'layer_root', stackOrder: 1 },
      ],
    });

    const updates = moveRotoHierarchyItem(
      node,
      { type: 'layer', id: 'layer_root' },
      'layer_child',
      0,
    );

    expect(updates.layers.find((layer) => layer.id === 'layer_root')?.parentLayerId ?? null).toBe(
      null,
    );
  });
});

describe('moveRotoHierarchyItems', () => {
  it('moves all selected shapes together while preserving their relative order', () => {
    const node = makeNode({
      layers: [{ id: 'layer_face', name: 'Face', stackOrder: 1 }],
      paths: [
        { ...makePath('shape_a', 'A'), stackOrder: 4 },
        { ...makePath('shape_b', 'B'), stackOrder: 3 },
        { ...makePath('shape_c', 'C'), stackOrder: 2 },
      ],
    });

    const updates = moveRotoHierarchyItems(
      node,
      [
        { type: 'path', id: 'shape_a' },
        { type: 'path', id: 'shape_c' },
      ],
      'layer_face',
      0,
    );
    const hierarchy = buildRotoHierarchy({ ...node, ...updates });

    expect(hierarchy).toHaveLength(2);
    expect(hierarchy[0]).toMatchObject({
      type: 'path',
      path: { id: 'shape_b' },
    });
    expect(hierarchy[1]).toMatchObject({
      type: 'layer',
      layer: { id: 'layer_face' },
    });

    const faceLayer = hierarchy[1];
    expect(faceLayer.type).toBe('layer');
    if (faceLayer.type !== 'layer') {
      throw new Error('Expected top-level hierarchy item to be a layer');
    }

    expect(
      faceLayer.children.map((item) => (item.type === 'path' ? item.path.id : item.layer.id)),
    ).toEqual(['shape_a', 'shape_c']);
  });

  it('moves mixed layer and shape selections together while preserving their relative order', () => {
    const node = makeNode({
      layers: [
        { id: 'layer_a', name: 'Layer A', stackOrder: 4 },
        { id: 'layer_b', name: 'Layer B', stackOrder: 2 },
      ],
      paths: [
        { ...makePath('shape_a', 'Shape A'), stackOrder: 3 },
        { ...makePath('shape_b', 'Shape B'), stackOrder: 1 },
      ],
    });

    const updates = moveRotoHierarchyItems(
      node,
      [
        { type: 'layer', id: 'layer_a' },
        { type: 'path', id: 'shape_a' },
      ],
      null,
      2,
    );
    const hierarchy = buildRotoHierarchy({ ...node, ...updates });

    expect(hierarchy.map((item) => (item.type === 'layer' ? item.layer.id : item.path.id))).toEqual(
      ['layer_b', 'shape_b', 'layer_a', 'shape_a'],
    );
  });

  it('ignores selected shapes that are already inside selected layers when moving a branch', () => {
    const node = makeNode({
      layers: [
        { id: 'layer_root', name: 'Root', stackOrder: 4 },
        { id: 'layer_other', name: 'Other', stackOrder: 2 },
      ],
      paths: [{ ...makePath('shape_inside', 'Inside', 'layer_root'), stackOrder: 3 }],
    });

    const updates = moveRotoHierarchyItems(
      node,
      [
        { type: 'layer', id: 'layer_root' },
        { type: 'path', id: 'shape_inside' },
      ],
      null,
      1,
    );
    const hierarchy = buildRotoHierarchy({ ...node, ...updates });

    expect(hierarchy.map((item) => (item.type === 'layer' ? item.layer.id : item.path.id))).toEqual(
      ['layer_other', 'layer_root'],
    );

    const movedLayer = hierarchy[1];
    expect(movedLayer.type).toBe('layer');
    if (movedLayer.type !== 'layer') {
      throw new Error('Expected moved item to remain a layer branch');
    }

    expect(movedLayer.children[0]).toMatchObject({
      type: 'path',
      path: { id: 'shape_inside', parentLayerId: 'layer_root' },
    });
  });

  it('moves only top-level selected layers so nested children stay inside their parent branch', () => {
    const node = makeNode({
      layers: [
        { id: 'layer_root', name: 'Root', stackOrder: 4 },
        { id: 'layer_child', name: 'Child', parentLayerId: 'layer_root', stackOrder: 3 },
        { id: 'layer_other', name: 'Other', stackOrder: 2 },
      ],
      paths: [{ ...makePath('shape_inside', 'Inside', 'layer_child'), stackOrder: 1 }],
    });

    const updates = moveRotoHierarchyItems(
      node,
      [
        { type: 'layer', id: 'layer_root' },
        { type: 'layer', id: 'layer_child' },
      ],
      null,
      1,
    );
    const hierarchy = buildRotoHierarchy({ ...node, ...updates });

    expect(hierarchy.map((item) => (item.type === 'layer' ? item.layer.id : item.path.id))).toEqual(
      ['layer_other', 'layer_root'],
    );

    const movedRoot = hierarchy[1];
    expect(movedRoot.type).toBe('layer');
    if (movedRoot.type !== 'layer') {
      throw new Error('Expected moved root item to be a layer');
    }

    expect(movedRoot.children[0]).toMatchObject({
      type: 'layer',
      layer: { id: 'layer_child', parentLayerId: 'layer_root' },
    });
  });
});
