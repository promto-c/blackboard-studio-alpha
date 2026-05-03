import { describe, expect, it } from 'vitest';
import { NodeType, type PaintNode } from '@blackboard/types';
import { buildPaintHierarchy } from './paintLayers';
import {
  buildPaintItemsClipboardPayload,
  pastePaintItemsClipboardPayload,
} from './paintItemsClipboard';

const makeStroke = (id: string, name: string, parentLayerId: string | null = null) => ({
  id,
  name,
  tool: 'brush' as const,
  visible: true,
  raster: `asset:${id}`,
  path: {
    mode: 'polyline' as const,
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ],
  },
  pointCount: 2,
  size: 18,
  softness: 50,
  opacity: 100,
  color: [1, 1, 1] as [number, number, number],
  parentLayerId,
});

const makeNode = (overrides: Partial<PaintNode> = {}): PaintNode => ({
  id: 'paint_test',
  type: NodeType.PAINT,
  name: 'Paint',
  visible: true,
  strokes: [],
  layers: [],
  ...overrides,
});

describe('paintItemsClipboard', () => {
  it('copies selected roots in hierarchy order and pastes them with preserved nesting', () => {
    const sourceNode = makeNode({
      layers: [
        { id: 'layer_group', name: 'Group', stackOrder: 3 },
        { id: 'layer_child', name: 'Child', parentLayerId: 'layer_group', stackOrder: 2 },
        { id: 'layer_target', name: 'Target', stackOrder: 1 },
      ],
      strokes: [
        { ...makeStroke('stroke_inside_child', 'Inside Child', 'layer_child'), stackOrder: 1 },
        { ...makeStroke('stroke_root', 'Root Stroke'), stackOrder: 2 },
        { ...makeStroke('stroke_existing', 'Existing', 'layer_target'), stackOrder: 1 },
      ],
    });

    const payload = buildPaintItemsClipboardPayload(sourceNode, ['layer_group'], ['stroke_root']);
    expect(payload).not.toBeNull();
    if (!payload) {
      throw new Error('Expected paint clipboard payload');
    }

    expect(payload.items).toHaveLength(2);
    expect(payload.items[0]).toMatchObject({
      type: 'layer',
      layer: { id: 'layer_group' },
    });
    expect(payload.items[1]).toMatchObject({
      type: 'stroke',
      stroke: { id: 'stroke_root' },
    });

    const pasted = pastePaintItemsClipboardPayload(sourceNode, payload, 'layer_target');
    const hierarchy = buildPaintHierarchy({
      layers: [...pasted.layers, ...(sourceNode.layers ?? [])],
      strokes: [...pasted.strokes, ...sourceNode.strokes],
    });

    const targetLayer = hierarchy.find(
      (item) => item.type === 'layer' && item.layer.id === 'layer_target',
    );
    expect(targetLayer).toBeTruthy();
    if (!targetLayer || targetLayer.type !== 'layer') {
      throw new Error('Expected target paint layer in hierarchy');
    }

    expect(targetLayer.children[0]).toMatchObject({
      type: 'layer',
      layer: { id: pasted.selectedLayerIds[0] },
    });
    expect(targetLayer.children[1]).toMatchObject({
      type: 'stroke',
      stroke: { id: pasted.selectedStrokeIds[0] },
    });
    expect(targetLayer.children[2]).toMatchObject({
      type: 'stroke',
      stroke: { id: 'stroke_existing' },
    });

    const pastedLayer = targetLayer.children[0];
    expect(pastedLayer.type).toBe('layer');
    if (pastedLayer.type !== 'layer') {
      throw new Error('Expected pasted paint layer');
    }

    expect(pastedLayer.children[0]).toMatchObject({
      type: 'layer',
    });
    const pastedChildLayer = pastedLayer.children[0];
    expect(pastedChildLayer.type).toBe('layer');
    if (pastedChildLayer.type !== 'layer') {
      throw new Error('Expected pasted paint child layer');
    }

    expect(pastedChildLayer.children[0]).toMatchObject({
      type: 'stroke',
      stroke: { name: 'Inside Child 1' },
    });
    expect(pasted.selectedLayerIds[0]).not.toBe('layer_group');
    expect(pasted.selectedStrokeIds[0]).not.toBe('stroke_root');
  });

  it('renames pasted duplicate layers and strokes using the first available number', () => {
    const sourceNode = makeNode({
      layers: [
        { id: 'layer_named', name: 'SomeShape name', stackOrder: 2 },
        { id: 'layer_target', name: 'Target', stackOrder: 1 },
      ],
      strokes: [
        { ...makeStroke('stroke_shape_1', 'Shape 1'), stackOrder: 5 },
        { ...makeStroke('stroke_shape_2', 'Shape 2'), stackOrder: 4 },
        { ...makeStroke('stroke_shape_5', 'Shape 5'), stackOrder: 3 },
      ],
    });

    const payload = buildPaintItemsClipboardPayload(
      sourceNode,
      ['layer_named'],
      ['stroke_shape_2'],
    );
    expect(payload).not.toBeNull();
    if (!payload) {
      throw new Error('Expected paint clipboard payload');
    }

    const pasted = pastePaintItemsClipboardPayload(sourceNode, payload, 'layer_target');
    const pastedLayer = pasted.layers.find((layer) => layer.id === pasted.selectedLayerIds[0]);
    const pastedStroke = pasted.strokes.find((stroke) => stroke.id === pasted.selectedStrokeIds[0]);

    expect(pastedLayer?.name).toBe('SomeShape name 1');
    expect(pastedStroke?.name).toBe('Shape 3');
  });
});
