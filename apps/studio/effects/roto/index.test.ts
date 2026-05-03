import { describe, expect, it, vi } from 'vitest';

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(),
  Modality: {},
  Type: {},
}));

vi.mock('./RotoAdjustments', () => ({ default: {} }));
vi.mock('./RotoItemsPanel', () => ({ default: {} }));
vi.mock('./RotoTool', () => ({ RotoTool: {} }));
vi.mock('./RotoViewportTools', () => ({ default: {} }));
vi.mock('./RotoToolPanels', () => ({ default: {} }));
vi.mock('./RotoIcon', () => ({ RotoIcon: {} }));

import {
  NodeType,
  RotoDrawMode,
  RotoPathBlend,
  RotoShapeType,
  type RotoNode,
} from '@blackboard/types';
import { projectTrackingModelToMatrix4 } from '@/utils/rotoTracking';
import { rotoEffect } from './index';

const createNode = (): RotoNode => ({
  id: 'roto-1',
  type: NodeType.ROTO,
  name: 'Roto',
  visible: true,
  invert: false,
  layers: [],
  paths: [],
});

const getStabilizeTransform = (
  node: RotoNode,
  frame: number,
  context: {
    selectedRotoLayerIds?: string[];
    selectedRotoPathIds?: string[];
    stabilizationConfig?: { scope: 'target' | 'composite' | 'parent' | 'full' };
    stabilizationReferenceFrame?: number | null;
  },
) => {
  const transform = rotoEffect.getStabilizeTransform?.(node, frame, context);
  expect(transform).not.toBeNull();
  return transform!;
};

describe('rotoEffect stabilization scopes', () => {
  it('includes parent-layer user transforms in parent scope for shapes', () => {
    const node = createNode();
    node.layers = [
      {
        id: 'layer-root',
        name: 'Root',
        visible: true,
        expanded: true,
        trackingTransform: {
          matrix: projectTrackingModelToMatrix4([10, 0], 'translation'),
          model: 'translation',
          sourcePathIds: ['shape-1'],
        },
        userTransform: {
          matrix: projectTrackingModelToMatrix4([2, 3], 'translation'),
          model: 'translation',
          sourcePathIds: [],
        },
      },
      {
        id: 'layer-a',
        name: 'Layer A',
        parentLayerId: 'layer-root',
        visible: true,
        expanded: true,
        trackingTransform: {
          matrix: projectTrackingModelToMatrix4([5, 0], 'translation'),
          model: 'translation',
          sourcePathIds: ['shape-1'],
        },
        userTransform: {
          matrix: projectTrackingModelToMatrix4([1, 1], 'translation'),
          model: 'translation',
          sourcePathIds: [],
        },
      },
    ];
    node.paths = [
      {
        id: 'shape-1',
        name: 'Shape 1',
        parentLayerId: 'layer-a',
        shapeType: RotoShapeType.POLYGON,
        points: [{ x: 0, y: 0 }],
        closed: true,
        feather: 0,
        opacity: 100,
        blend: RotoPathBlend.ADD,
        style: { mode: RotoDrawMode.FILL, strokeWidth: 1 },
        trackingTransform: {
          matrix: projectTrackingModelToMatrix4([7, 0], 'translation'),
          model: 'translation',
          sourcePathIds: ['shape-1'],
        },
        userTransform: {
          matrix: projectTrackingModelToMatrix4([11, -2], 'translation'),
          model: 'translation',
          sourcePathIds: [],
        },
      },
    ];

    const transform = getStabilizeTransform(node, 0, {
      selectedRotoPathIds: ['shape-1'],
      selectedRotoLayerIds: [],
      stabilizationConfig: { scope: 'parent' },
    });

    expect(transform.x).toBe(18);
    expect(transform.y).toBe(4);
  });

  it('includes shape user transform in shape scope', () => {
    const node = createNode();
    node.layers = [
      {
        id: 'layer-root',
        name: 'Root',
        visible: true,
        expanded: true,
        trackingTransform: {
          matrix: projectTrackingModelToMatrix4([10, 0], 'translation'),
          model: 'translation',
          sourcePathIds: ['shape-1'],
        },
        userTransform: {
          matrix: projectTrackingModelToMatrix4([2, 3], 'translation'),
          model: 'translation',
          sourcePathIds: [],
        },
      },
      {
        id: 'layer-a',
        name: 'Layer A',
        parentLayerId: 'layer-root',
        visible: true,
        expanded: true,
        trackingTransform: {
          matrix: projectTrackingModelToMatrix4([5, 0], 'translation'),
          model: 'translation',
          sourcePathIds: ['shape-1'],
        },
        userTransform: {
          matrix: projectTrackingModelToMatrix4([1, 1], 'translation'),
          model: 'translation',
          sourcePathIds: [],
        },
      },
    ];
    node.paths = [
      {
        id: 'shape-1',
        name: 'Shape 1',
        parentLayerId: 'layer-a',
        shapeType: RotoShapeType.POLYGON,
        points: [{ x: 0, y: 0 }],
        closed: true,
        feather: 0,
        opacity: 100,
        blend: RotoPathBlend.ADD,
        style: { mode: RotoDrawMode.FILL, strokeWidth: 1 },
        trackingTransform: {
          matrix: projectTrackingModelToMatrix4([7, 0], 'translation'),
          model: 'translation',
          sourcePathIds: ['shape-1'],
        },
        userTransform: {
          matrix: projectTrackingModelToMatrix4([11, -2], 'translation'),
          model: 'translation',
          sourcePathIds: [],
        },
      },
    ];

    const transform = getStabilizeTransform(node, 0, {
      selectedRotoPathIds: ['shape-1'],
      selectedRotoLayerIds: [],
      stabilizationConfig: { scope: 'composite' },
    });

    expect(transform.x).toBe(36);
    expect(transform.y).toBe(2);
  });

  it('keeps full scope derived position translation behavior', () => {
    const node = createNode();
    node.layers = [
      {
        id: 'layer-root',
        name: 'Root',
        visible: true,
        expanded: true,
        trackingTransform: {
          matrix: projectTrackingModelToMatrix4([10, 0], 'translation'),
          model: 'translation',
          sourcePathIds: ['shape-1'],
        },
        userTransform: {
          matrix: projectTrackingModelToMatrix4([2, 3], 'translation'),
          model: 'translation',
          sourcePathIds: [],
        },
      },
      {
        id: 'layer-a',
        name: 'Layer A',
        parentLayerId: 'layer-root',
        visible: true,
        expanded: true,
        trackingTransform: {
          matrix: projectTrackingModelToMatrix4([5, 0], 'translation'),
          model: 'translation',
          sourcePathIds: ['shape-1'],
        },
        userTransform: {
          matrix: projectTrackingModelToMatrix4([1, 1], 'translation'),
          model: 'translation',
          sourcePathIds: [],
        },
      },
    ];
    node.paths = [
      {
        id: 'shape-1',
        name: 'Shape 1',
        parentLayerId: 'layer-a',
        shapeType: RotoShapeType.POLYGON,
        points: [
          {
            x: [
              { frame: 0, value: 10 },
              { frame: 5, value: 20 },
            ],
            y: [
              { frame: 0, value: 10 },
              { frame: 5, value: 30 },
            ],
          },
          {
            x: [
              { frame: 0, value: 30 },
              { frame: 5, value: 40 },
            ],
            y: [
              { frame: 0, value: 10 },
              { frame: 5, value: 30 },
            ],
          },
        ],
        closed: true,
        feather: 0,
        opacity: 100,
        blend: RotoPathBlend.ADD,
        style: { mode: RotoDrawMode.FILL, strokeWidth: 1 },
        trackingTransform: {
          matrix: projectTrackingModelToMatrix4([7, 0], 'translation'),
          model: 'translation',
          sourcePathIds: ['shape-1'],
        },
      },
    ];

    const transform = getStabilizeTransform(node, 5, {
      selectedRotoPathIds: ['shape-1'],
      selectedRotoLayerIds: [],
      stabilizationConfig: { scope: 'full' },
      stabilizationReferenceFrame: 0,
    });

    expect(transform.x).toBe(25);
    expect(transform.y).toBe(4);
    expect(transform.auxiliaryTranslation).toBeDefined();
    expect(transform.auxiliaryTranslation[0][3]).toBe(10);
    expect(transform.auxiliaryTranslation[1][3]).toBe(20);
  });

  it('combines shape user transform and derived keyframed translation in full scope', () => {
    const node = createNode();
    node.layers = [
      {
        id: 'layer-root',
        name: 'Root',
        visible: true,
        expanded: true,
        trackingTransform: {
          matrix: projectTrackingModelToMatrix4([10, 0], 'translation'),
          model: 'translation',
          sourcePathIds: ['shape-1'],
        },
        userTransform: {
          matrix: projectTrackingModelToMatrix4([2, 3], 'translation'),
          model: 'translation',
          sourcePathIds: [],
        },
      },
      {
        id: 'layer-a',
        name: 'Layer A',
        parentLayerId: 'layer-root',
        visible: true,
        expanded: true,
        trackingTransform: {
          matrix: projectTrackingModelToMatrix4([5, 0], 'translation'),
          model: 'translation',
          sourcePathIds: ['shape-1'],
        },
        userTransform: {
          matrix: projectTrackingModelToMatrix4([1, 1], 'translation'),
          model: 'translation',
          sourcePathIds: [],
        },
      },
    ];
    node.paths = [
      {
        id: 'shape-1',
        name: 'Shape 1',
        parentLayerId: 'layer-a',
        shapeType: RotoShapeType.POLYGON,
        points: [
          {
            x: [
              { frame: 0, value: 10 },
              { frame: 5, value: 20 },
            ],
            y: [
              { frame: 0, value: 10 },
              { frame: 5, value: 30 },
            ],
          },
          {
            x: [
              { frame: 0, value: 30 },
              { frame: 5, value: 40 },
            ],
            y: [
              { frame: 0, value: 10 },
              { frame: 5, value: 30 },
            ],
          },
        ],
        closed: true,
        feather: 0,
        opacity: 100,
        blend: RotoPathBlend.ADD,
        style: { mode: RotoDrawMode.FILL, strokeWidth: 1 },
        trackingTransform: {
          matrix: projectTrackingModelToMatrix4([7, 0], 'translation'),
          model: 'translation',
          sourcePathIds: ['shape-1'],
        },
        userTransform: {
          matrix: projectTrackingModelToMatrix4([11, -2], 'translation'),
          model: 'translation',
          sourcePathIds: [],
        },
      },
    ];

    const transform = getStabilizeTransform(node, 5, {
      selectedRotoPathIds: ['shape-1'],
      selectedRotoLayerIds: [],
      stabilizationConfig: { scope: 'full' },
      stabilizationReferenceFrame: 0,
    });

    expect(transform.x).toBe(36);
    expect(transform.y).toBe(2);
    expect(transform.auxiliaryTranslation).toBeDefined();
    expect(transform.auxiliaryTranslation[0][3]).toBe(10);
    expect(transform.auxiliaryTranslation[1][3]).toBe(20);
  });

  it('includes parent-layer user transforms in parent scope for selected layers', () => {
    const node = createNode();
    node.layers = [
      {
        id: 'layer-root',
        name: 'Root',
        visible: true,
        expanded: true,
        trackingTransform: {
          matrix: projectTrackingModelToMatrix4([10, 0], 'translation'),
          model: 'translation',
          sourcePathIds: [],
        },
        userTransform: {
          matrix: projectTrackingModelToMatrix4([2, 3], 'translation'),
          model: 'translation',
          sourcePathIds: [],
        },
      },
      {
        id: 'layer-a',
        name: 'Layer A',
        parentLayerId: 'layer-root',
        visible: true,
        expanded: true,
        trackingTransform: {
          matrix: projectTrackingModelToMatrix4([5, 0], 'translation'),
          model: 'translation',
          sourcePathIds: [],
        },
        userTransform: {
          matrix: projectTrackingModelToMatrix4([11, 13], 'translation'),
          model: 'translation',
          sourcePathIds: [],
        },
      },
    ];

    const transform = getStabilizeTransform(node, 0, {
      selectedRotoLayerIds: ['layer-a'],
      selectedRotoPathIds: [],
      stabilizationConfig: { scope: 'parent' },
    });

    expect(transform.x).toBe(12);
    expect(transform.y).toBe(3);
  });

  it('includes selected-layer user transform in shape scope', () => {
    const node = createNode();
    node.layers = [
      {
        id: 'layer-root',
        name: 'Root',
        visible: true,
        expanded: true,
        trackingTransform: {
          matrix: projectTrackingModelToMatrix4([10, 0], 'translation'),
          model: 'translation',
          sourcePathIds: [],
        },
        userTransform: {
          matrix: projectTrackingModelToMatrix4([2, 3], 'translation'),
          model: 'translation',
          sourcePathIds: [],
        },
      },
      {
        id: 'layer-a',
        name: 'Layer A',
        parentLayerId: 'layer-root',
        visible: true,
        expanded: true,
        trackingTransform: {
          matrix: projectTrackingModelToMatrix4([5, 0], 'translation'),
          model: 'translation',
          sourcePathIds: [],
        },
        userTransform: {
          matrix: projectTrackingModelToMatrix4([11, 13], 'translation'),
          model: 'translation',
          sourcePathIds: [],
        },
      },
    ];

    const transform = getStabilizeTransform(node, 0, {
      selectedRotoLayerIds: ['layer-a'],
      selectedRotoPathIds: [],
      stabilizationConfig: { scope: 'composite' },
    });

    expect(transform.x).toBe(28);
    expect(transform.y).toBe(16);
  });

  it('combines layer user transform and child keyframed translation in full scope', () => {
    const node = createNode();
    node.layers = [
      {
        id: 'layer-root',
        name: 'Root',
        visible: true,
        expanded: true,
        trackingTransform: {
          matrix: projectTrackingModelToMatrix4([10, 0], 'translation'),
          model: 'translation',
          sourcePathIds: [],
        },
        userTransform: {
          matrix: projectTrackingModelToMatrix4([2, 3], 'translation'),
          model: 'translation',
          sourcePathIds: [],
        },
      },
      {
        id: 'layer-a',
        name: 'Layer A',
        parentLayerId: 'layer-root',
        visible: true,
        expanded: true,
        trackingTransform: {
          matrix: projectTrackingModelToMatrix4([5, 0], 'translation'),
          model: 'translation',
          sourcePathIds: [],
        },
        userTransform: {
          matrix: projectTrackingModelToMatrix4([11, 13], 'translation'),
          model: 'translation',
          sourcePathIds: [],
        },
      },
    ];
    node.paths = [
      {
        id: 'shape-1',
        name: 'Shape 1',
        parentLayerId: 'layer-a',
        shapeType: RotoShapeType.POLYGON,
        points: [
          {
            x: [
              { frame: 0, value: 10 },
              { frame: 5, value: 20 },
            ],
            y: [
              { frame: 0, value: 10 },
              { frame: 5, value: 30 },
            ],
          },
          {
            x: [
              { frame: 0, value: 30 },
              { frame: 5, value: 40 },
            ],
            y: [
              { frame: 0, value: 10 },
              { frame: 5, value: 30 },
            ],
          },
        ],
        closed: true,
        feather: 0,
        opacity: 100,
        blend: RotoPathBlend.ADD,
        style: { mode: RotoDrawMode.FILL, strokeWidth: 1 },
      },
    ];

    const transform = getStabilizeTransform(node, 5, {
      selectedRotoLayerIds: ['layer-a'],
      selectedRotoPathIds: [],
      stabilizationConfig: { scope: 'full' },
      stabilizationReferenceFrame: 0,
    });

    expect(transform.x).toBe(28);
    expect(transform.y).toBe(16);
    expect(transform.auxiliaryTranslation).toBeDefined();
    expect(transform.auxiliaryTranslation[0][3]).toBe(10);
    expect(transform.auxiliaryTranslation[1][3]).toBe(20);
  });
});
