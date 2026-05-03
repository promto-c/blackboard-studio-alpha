import { describe, expect, it } from 'vitest';
import { NodeType, type PaintNode } from '@blackboard/types';
import {
  assignPaintStrokesToLayer,
  buildPaintHierarchy,
  canMovePaintLayerToParent,
  deletePaintLayer,
  flattenPaintHierarchyStrokeItems,
  getNextPaintLayerName,
  getPaintCreationParentLayerId,
  getOrderedPaintSiblingItems,
  getPaintLayerStrokeIds,
  isPaintLayerActiveAtFrame,
  isPaintStrokeActiveAtFrame,
  movePaintHierarchyItems,
  wrapPaintSelectionInNewLayer,
} from './paintLayers';

const makeNode = (): PaintNode => ({
  id: 'paint_node',
  type: NodeType.PAINT,
  name: 'Paint',
  visible: true,
  strokes: [
    {
      id: 'stroke_root_top',
      name: 'Stroke Root Top',
      tool: 'brush',
      visible: true,
      raster: 'a',
      pointCount: 2,
      size: 24,
      softness: 30,
      opacity: 100,
      color: [1, 1, 1],
      stackOrder: 400,
    },
    {
      id: 'stroke_layer_top',
      name: 'Stroke Layer Top',
      tool: 'brush',
      visible: true,
      raster: 'b',
      pointCount: 2,
      size: 24,
      softness: 30,
      opacity: 100,
      color: [1, 1, 1],
      parentLayerId: 'layer_1',
      stackOrder: 300,
    },
    {
      id: 'stroke_child',
      name: 'Stroke Child',
      tool: 'brush',
      visible: true,
      raster: 'c',
      pointCount: 2,
      size: 24,
      softness: 30,
      opacity: 100,
      color: [1, 1, 1],
      parentLayerId: 'layer_2',
      stackOrder: 100,
    },
    {
      id: 'stroke_root_bottom',
      name: 'Stroke Root Bottom',
      tool: 'brush',
      visible: true,
      raster: 'd',
      pointCount: 2,
      size: 24,
      softness: 30,
      opacity: 100,
      color: [1, 1, 1],
      stackOrder: 50,
    },
  ],
  layers: [
    {
      id: 'layer_1',
      name: 'Layer 1',
      visible: true,
      expanded: true,
      stackOrder: 350,
    },
    {
      id: 'layer_2',
      name: 'Layer 2',
      parentLayerId: 'layer_1',
      visible: true,
      expanded: true,
      stackOrder: 200,
    },
  ],
});

describe('paintLayers', () => {
  it('gets the next layer name', () => {
    expect(getNextPaintLayerName(makeNode())).toBe('Layer 3');
  });

  it('resolves the creation parent from a selected layer', () => {
    expect(getPaintCreationParentLayerId(makeNode(), ['layer_1'])).toBe('layer_1');
  });

  it('assigns strokes to a layer', () => {
    const node = makeNode();
    expect(
      assignPaintStrokesToLayer(node, ['stroke_root_top'], 'layer_1').strokes[0].parentLayerId,
    ).toBe('layer_1');
  });

  it('deletes a layer and reparents its children to the parent layer', () => {
    const node = makeNode();
    const updates = deletePaintLayer(node, 'layer_1');

    expect(updates.layers.find((layer) => layer.id === 'layer_2')?.parentLayerId ?? null).toBe(
      null,
    );
    expect(
      updates.strokes.find((stroke) => stroke.id === 'stroke_layer_top')?.parentLayerId ?? null,
    ).toBe(null);
  });

  it('wraps selected strokes in a new layer under their common parent', () => {
    const node = makeNode();
    const { layer, updates } = wrapPaintSelectionInNewLayer(node, ['stroke_child']);

    expect(layer.parentLayerId).toBe('layer_2');
    expect(updates.layers.some((candidate) => candidate.id === layer.id)).toBe(true);
    expect(updates.strokes.find((stroke) => stroke.id === 'stroke_child')?.parentLayerId).toBe(
      layer.id,
    );
  });

  it('builds a mixed hierarchy with top-first ordering', () => {
    const node = makeNode();
    const hierarchy = buildPaintHierarchy(node);

    expect(
      hierarchy.map((item) =>
        item.type === 'layer' ? `layer:${item.layer.id}` : `stroke:${item.stroke.id}`,
      ),
    ).toEqual(['stroke:stroke_root_top', 'layer:layer_1', 'stroke:stroke_root_bottom']);

    expect(
      hierarchy[1]?.type === 'layer'
        ? hierarchy[1].children.map((item) =>
            item.type === 'layer' ? `layer:${item.layer.id}` : `stroke:${item.stroke.id}`,
          )
        : null,
    ).toEqual(['stroke:stroke_layer_top', 'layer:layer_2']);

    expect(getPaintLayerStrokeIds(node, 'layer_1')).toEqual(['stroke_layer_top', 'stroke_child']);
    expect(flattenPaintHierarchyStrokeItems(hierarchy).map((item) => item.stroke.id)).toEqual([
      'stroke_root_top',
      'stroke_layer_top',
      'stroke_child',
      'stroke_root_bottom',
    ]);
  });

  it('orders siblings using mixed layer and stroke stack order', () => {
    const node = makeNode();

    expect(getOrderedPaintSiblingItems(node, null)).toEqual([
      { type: 'stroke', id: 'stroke_root_top' },
      { type: 'layer', id: 'layer_1' },
      { type: 'stroke', id: 'stroke_root_bottom' },
    ]);
  });

  it('moves paint hierarchy items across parents and preserves drop order', () => {
    const node = makeNode();
    const updates = movePaintHierarchyItems(
      node,
      [{ type: 'stroke', id: 'stroke_root_top' }],
      'layer_1',
      1,
    );
    const hierarchy = buildPaintHierarchy({ layers: updates.layers, strokes: updates.strokes });

    expect(
      hierarchy[0]?.type === 'layer'
        ? hierarchy[0].children.map((item) =>
            item.type === 'layer' ? `layer:${item.layer.id}` : `stroke:${item.stroke.id}`,
          )
        : null,
    ).toEqual(['stroke:stroke_layer_top', 'stroke:stroke_root_top', 'layer:layer_2']);
  });

  it('prevents moving a layer into its descendant', () => {
    expect(canMovePaintLayerToParent(makeNode(), 'layer_1', 'layer_2')).toBe(false);
  });

  it('evaluates stroke lifetimes at a frame', () => {
    const node = makeNode();
    node.strokes[0] = {
      ...node.strokes[0],
      lifetime: {
        mode: 'single',
        frame: 12,
      },
    };

    expect(isPaintStrokeActiveAtFrame(node, node.strokes[0], 12)).toBe(true);
    expect(isPaintStrokeActiveAtFrame(node, node.strokes[0], 13)).toBe(false);
  });

  it('inherits inactive lifetimes from parent layers', () => {
    const node = makeNode();
    node.layers = node.layers?.map((layer) =>
      layer.id === 'layer_1'
        ? {
            ...layer,
            lifetime: {
              mode: 'range',
              startFrame: 10,
              endFrame: 20,
            },
          }
        : layer,
    );

    expect(isPaintLayerActiveAtFrame(node, 'layer_2', 15)).toBe(true);
    expect(isPaintLayerActiveAtFrame(node, 'layer_2', 30)).toBe(false);
    expect(isPaintStrokeActiveAtFrame(node, node.strokes[1], 30)).toBe(false);
  });
});
