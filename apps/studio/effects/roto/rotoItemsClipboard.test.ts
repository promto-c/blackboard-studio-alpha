import { describe, expect, it } from 'vitest';
import {
  NodeType,
  RotoDrawMode,
  RotoPathBlend,
  RotoShapeType,
  type RotoNode,
} from '@blackboard/types';
import { buildRotoHierarchy } from '@/utils/rotoHierarchy';
import {
  buildRotoItemsClipboardPayload,
  pasteRotoItemsClipboardPayload,
} from './rotoItemsClipboard';

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
  id: 'roto_test',
  type: NodeType.ROTO,
  name: 'Roto',
  visible: true,
  paths: [],
  layers: [],
  invert: false,
  ...overrides,
});

describe('rotoItemsClipboard', () => {
  it('copies selected roots in hierarchy order and pastes them as a preserved subtree', () => {
    const sourceNode = makeNode({
      layers: [
        { id: 'layer_group', name: 'Group', stackOrder: 3 },
        { id: 'layer_child', name: 'Child', parentLayerId: 'layer_group', stackOrder: 2 },
        { id: 'layer_target', name: 'Target', stackOrder: 1 },
      ],
      paths: [
        { ...makePath('path_inside_child', 'Inside Child', 'layer_child'), stackOrder: 1 },
        { ...makePath('path_root', 'Root Path'), stackOrder: 2 },
      ],
    });

    const payload = buildRotoItemsClipboardPayload(sourceNode, ['layer_group'], ['path_root']);
    expect(payload).not.toBeNull();
    if (!payload) {
      throw new Error('Expected roto clipboard payload');
    }

    expect(payload.items).toHaveLength(2);
    expect(payload.items[0]).toMatchObject({
      type: 'layer',
      layer: { id: 'layer_group' },
    });
    expect(payload.items[1]).toMatchObject({
      type: 'path',
      path: { id: 'path_root' },
    });

    const pasted = pasteRotoItemsClipboardPayload(sourceNode, payload, 'layer_target');
    const combinedNode = makeNode({
      layers: [...pasted.layers, ...(sourceNode.layers ?? [])],
      paths: [...pasted.paths, ...sourceNode.paths],
    });
    const hierarchy = buildRotoHierarchy(combinedNode);

    const targetLayer = hierarchy.find(
      (item) => item.type === 'layer' && item.layer.id === 'layer_target',
    );
    expect(targetLayer).toBeTruthy();
    if (!targetLayer || targetLayer.type !== 'layer') {
      throw new Error('Expected target layer in hierarchy');
    }

    expect(targetLayer.children[0]).toMatchObject({
      type: 'layer',
      layer: { id: pasted.selectedLayerIds[0] },
    });
    expect(targetLayer.children[1]).toMatchObject({
      type: 'path',
      path: { id: pasted.selectedPathIds[0] },
    });

    const pastedLayer = targetLayer.children[0];
    expect(pastedLayer.type).toBe('layer');
    if (pastedLayer.type !== 'layer') {
      throw new Error('Expected pasted roto layer');
    }

    expect(pastedLayer.children[0]).toMatchObject({
      type: 'layer',
    });
    const pastedChildLayer = pastedLayer.children[0];
    expect(pastedChildLayer.type).toBe('layer');
    if (pastedChildLayer.type !== 'layer') {
      throw new Error('Expected pasted roto child layer');
    }

    expect(pastedChildLayer.children[0]).toMatchObject({
      type: 'path',
      path: { name: 'Inside Child 1' },
    });
    expect(pasted.selectedLayerIds[0]).not.toBe('layer_group');
    expect(pasted.selectedPathIds[0]).not.toBe('path_root');
  });

  it('renames pasted duplicate layers and paths using the first available number', () => {
    const sourceNode = makeNode({
      layers: [
        { id: 'layer_named', name: 'SomeShape name', stackOrder: 2 },
        { id: 'layer_target', name: 'Target', stackOrder: 1 },
      ],
      paths: [
        { ...makePath('path_shape_1', 'Shape 1'), stackOrder: 5 },
        { ...makePath('path_shape_2', 'Shape 2'), stackOrder: 4 },
        { ...makePath('path_shape_5', 'Shape 5'), stackOrder: 3 },
      ],
    });

    const payload = buildRotoItemsClipboardPayload(sourceNode, ['layer_named'], ['path_shape_2']);
    expect(payload).not.toBeNull();
    if (!payload) {
      throw new Error('Expected roto clipboard payload');
    }

    const pasted = pasteRotoItemsClipboardPayload(sourceNode, payload, 'layer_target');
    const pastedLayer = pasted.layers.find((layer) => layer.id === pasted.selectedLayerIds[0]);
    const pastedPath = pasted.paths.find((path) => path.id === pasted.selectedPathIds[0]);

    expect(pastedLayer?.name).toBe('SomeShape name 1');
    expect(pastedPath?.name).toBe('Shape 3');
  });
});
