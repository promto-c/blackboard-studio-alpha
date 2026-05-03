import { describe, expect, it } from 'vitest';
import {
  NodeType,
  RotoDrawMode,
  RotoPathBlend,
  RotoShapeType,
  type RotoNode,
} from '@blackboard/types';
import {
  createIdentityRotoTrackingMatrix4,
  deriveUserTranslationFromPoints,
  materializeRotoTrackingTarget,
  reduceRotoTrackingMatrix4ToComponents,
  keyframeRotoTrackingMatrix4,
  projectScenePointToRotoPathBasePoint,
  projectTrackingModelToMatrix4,
  resolveRotoLayerCompositeMatrix,
  resolveRotoPathCompositeMatrix,
  resolveRotoPathPointsAtFrame,
  resolveRotoTrackingSelection,
} from './rotoTracking';

const createNode = (): RotoNode => ({
  id: 'roto-1',
  type: NodeType.ROTO,
  name: 'Roto',
  visible: true,
  invert: false,
  layers: [
    { id: 'layer-a', name: 'Layer A', visible: true, expanded: true },
    { id: 'layer-b', name: 'Layer B', visible: true, expanded: true },
  ],
  paths: [
    {
      id: 'shape-1',
      name: 'Shape 1',
      parentLayerId: 'layer-a',
      shapeType: RotoShapeType.POLYGON,
      points: [],
      closed: true,
      feather: 0,
      opacity: 100,
      blend: RotoPathBlend.ADD,
      style: { mode: RotoDrawMode.FILL, strokeWidth: 1 },
    },
    {
      id: 'shape-2',
      name: 'Shape 2',
      parentLayerId: 'layer-a',
      shapeType: RotoShapeType.POLYGON,
      points: [],
      closed: true,
      feather: 0,
      opacity: 100,
      blend: RotoPathBlend.ADD,
      style: { mode: RotoDrawMode.FILL, strokeWidth: 1 },
    },
    {
      id: 'shape-3',
      name: 'Shape 3',
      parentLayerId: 'layer-b',
      shapeType: RotoShapeType.POLYGON,
      points: [],
      closed: true,
      feather: 0,
      opacity: 100,
      blend: RotoPathBlend.ADD,
      style: { mode: RotoDrawMode.FILL, strokeWidth: 1 },
    },
  ],
});

describe('rotoTracking', () => {
  it('defaults a single selected shape to the shape target', () => {
    const scope = resolveRotoTrackingSelection(createNode(), [], ['shape-1']);

    expect(scope.defaultTarget).toEqual({ kind: 'shape', pathId: 'shape-1' });
    expect(scope.availableTargets).toEqual(['shape', 'layer']);
  });

  it('allows an unparented single shape to target a new layer', () => {
    const node = createNode();
    node.paths = node.paths.map((path) =>
      path.id === 'shape-1' ? { ...path, parentLayerId: null } : path,
    );

    const scope = resolveRotoTrackingSelection(node, [], ['shape-1']);

    expect(scope.defaultTarget).toEqual({ kind: 'shape', pathId: 'shape-1' });
    expect(scope.availableTargets).toEqual(['shape', 'layer']);
    expect(scope.layerTargetOption).toEqual({
      kind: 'layer',
      createLayer: true,
      parentLayerId: null,
      layerName: 'Layer 1',
    });
  });

  it('defaults multi-shape selection to the common parent layer', () => {
    const scope = resolveRotoTrackingSelection(createNode(), [], ['shape-1', 'shape-2']);

    expect(scope.defaultTarget).toEqual({ kind: 'layer', layerId: 'layer-a' });
    expect(scope.availableTargets).toEqual(['layer']);
  });

  it('creates a pending layer target for unparented multi-shape selection', () => {
    const node = createNode();
    node.paths = node.paths.map((path) =>
      path.id === 'shape-1' || path.id === 'shape-2' ? { ...path, parentLayerId: null } : path,
    );

    const scope = resolveRotoTrackingSelection(node, [], ['shape-1', 'shape-2']);

    expect(scope.defaultTarget).toEqual({
      kind: 'layer',
      createLayer: true,
      parentLayerId: null,
      layerName: 'Layer 1',
    });
    expect(scope.availableTargets).toEqual(['layer']);
  });

  it('rejects multi-shape layer targeting when there is no common parent layer', () => {
    const scope = resolveRotoTrackingSelection(createNode(), [], ['shape-1', 'shape-3']);

    expect(scope.defaultTarget).toBeNull();
    expect(scope.availableTargets).toEqual([]);
    expect(scope.reason).toMatch(/share a parent layer/i);
  });

  it('materializes a pending layer target by creating the layer and moving tracked shapes', () => {
    const node = createNode();
    node.paths = node.paths.map((path) =>
      path.id === 'shape-1' || path.id === 'shape-2' ? { ...path, parentLayerId: null } : path,
    );

    const scope = resolveRotoTrackingSelection(node, [], ['shape-1', 'shape-2']);
    expect(scope.defaultTarget).not.toBeNull();

    const materialized = materializeRotoTrackingTarget(
      node,
      scope.sourcePathIds,
      scope.defaultTarget as NonNullable<typeof scope.defaultTarget>,
    );

    expect(materialized.target.kind).toBe('layer');
    if (materialized.target.kind !== 'layer') {
      throw new Error('Expected a layer target');
    }
    const layerId = materialized.target.layerId;

    expect(materialized.node.layers?.find((layer) => layer.id === layerId)).toMatchObject({
      name: 'Layer 1',
      parentLayerId: null,
    });
    expect(
      materialized.node.paths
        .filter((path) => scope.sourcePathIds.includes(path.id))
        .every((path) => path.parentLayerId === layerId),
    ).toBe(true);
  });

  it('projects affine tracking models into a 4x4 matrix', () => {
    expect(projectTrackingModelToMatrix4([2, 3, 4, 5, 6, 7], 'affine')).toEqual([
      [2, 3, 0, 4],
      [5, 6, 0, 7],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ]);
  });

  it('keyframes tracking matrices per frame', () => {
    const matrix = keyframeRotoTrackingMatrix4(createIdentityRotoTrackingMatrix4(), 12, [
      [1, 0, 0, 10],
      [0, 1, 0, 20],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ]);

    expect(Array.isArray(matrix[0][3])).toBe(true);
    expect(Array.isArray(matrix[1][3])).toBe(true);
  });

  it('resolves child shape points through parent and shape tracking matrices', () => {
    const node = createNode();
    node.layers = [
      {
        id: 'layer-root',
        name: 'Root',
        visible: true,
        expanded: true,
        trackingTransform: {
          matrix: projectTrackingModelToMatrix4([10, 20], 'translation'),
          model: 'translation',
          sourcePathIds: ['shape-1'],
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
      },
    ];
    node.paths = [
      {
        id: 'shape-1',
        name: 'Shape 1',
        parentLayerId: 'layer-a',
        shapeType: RotoShapeType.POLYGON,
        points: [{ x: 1, y: 2 }],
        closed: true,
        feather: 0,
        opacity: 100,
        blend: RotoPathBlend.ADD,
        style: { mode: RotoDrawMode.FILL, strokeWidth: 1 },
        trackingTransform: {
          matrix: projectTrackingModelToMatrix4([3, 4], 'translation'),
          model: 'translation',
          sourcePathIds: ['shape-1'],
        },
      },
    ];

    expect(resolveRotoPathPointsAtFrame(node, node.paths[0], 0)).toEqual([{ x: 19, y: 26 }]);
  });

  it('applies layer and shape userTransform to resolved path points by default', () => {
    const node = createNode();
    node.layers = [
      {
        id: 'layer-root',
        name: 'Root',
        visible: true,
        expanded: true,
        trackingTransform: {
          matrix: projectTrackingModelToMatrix4([10, 20], 'translation'),
          model: 'translation',
          sourcePathIds: ['shape-1'],
        },
        userTransform: {
          matrix: projectTrackingModelToMatrix4([2, 0], 'translation'),
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
      },
    ];
    node.paths = [
      {
        id: 'shape-1',
        name: 'Shape 1',
        parentLayerId: 'layer-a',
        shapeType: RotoShapeType.POLYGON,
        points: [{ x: 1, y: 2 }],
        closed: true,
        feather: 0,
        opacity: 100,
        blend: RotoPathBlend.ADD,
        style: { mode: RotoDrawMode.FILL, strokeWidth: 1 },
        trackingTransform: {
          matrix: projectTrackingModelToMatrix4([3, 4], 'translation'),
          model: 'translation',
          sourcePathIds: ['shape-1'],
        },
        userTransform: {
          matrix: projectTrackingModelToMatrix4([7, -3], 'translation'),
          model: 'translation',
          sourcePathIds: [],
        },
      },
    ];

    expect(resolveRotoPathPointsAtFrame(node, node.paths[0], 0)).toEqual([{ x: 28, y: 23 }]);
  });

  it('projects scene points back into path-local base values under parent transforms', () => {
    const node = createNode();
    node.layers = [
      {
        id: 'layer-a',
        name: 'Layer A',
        visible: true,
        expanded: true,
        trackingTransform: {
          matrix: projectTrackingModelToMatrix4([10, 20], 'translation'),
          model: 'translation',
          sourcePathIds: ['shape-1'],
        },
      },
    ];
    node.paths = [
      {
        id: 'shape-1',
        name: 'Shape 1',
        parentLayerId: 'layer-a',
        shapeType: RotoShapeType.POLYGON,
        points: [{ x: 1, y: 2 }],
        trackPoints: [{ x: 4, y: -1 }],
        closed: true,
        feather: 0,
        opacity: 100,
        blend: RotoPathBlend.ADD,
        style: { mode: RotoDrawMode.FILL, strokeWidth: 1 },
      },
    ];

    expect(
      projectScenePointToRotoPathBasePoint(node, node.paths[0], 0, 0, { x: 15, y: 21 }),
    ).toEqual({ x: 1, y: 2 });
  });

  it('projects scene points back into base values through userTransform chains', () => {
    const node = createNode();
    node.layers = [
      {
        id: 'layer-a',
        name: 'Layer A',
        visible: true,
        expanded: true,
        trackingTransform: {
          matrix: projectTrackingModelToMatrix4([10, 20], 'translation'),
          model: 'translation',
          sourcePathIds: ['shape-1'],
        },
        userTransform: {
          matrix: projectTrackingModelToMatrix4([2, 0], 'translation'),
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
        points: [{ x: 1, y: 2 }],
        closed: true,
        feather: 0,
        opacity: 100,
        blend: RotoPathBlend.ADD,
        style: { mode: RotoDrawMode.FILL, strokeWidth: 1 },
        userTransform: {
          matrix: projectTrackingModelToMatrix4([7, -3], 'translation'),
          model: 'translation',
          sourcePathIds: [],
        },
      },
    ];

    expect(
      projectScenePointToRotoPathBasePoint(node, node.paths[0], 0, 0, { x: 20, y: 19 }),
    ).toEqual({ x: 1, y: 2 });
  });

  it('reduces a matrix to the requested stabilization component model', () => {
    const reducedTranslation = reduceRotoTrackingMatrix4ToComponents(
      [
        [1, 0, 0, 10],
        [0, 1, 0, 20],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
      ],
      {
        translation: true,
        rotation: false,
        scale: false,
        affine: false,
        perspective: false,
      },
    );

    expect(reducedTranslation).toEqual([
      [1, 0, 0, 10],
      [0, 1, 0, 20],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ]);
  });

  it('derives user translation from point keyframe centroid deltas', () => {
    const path = {
      id: 'shape-1',
      name: 'Shape 1',
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
    };

    const matrix = deriveUserTranslationFromPoints(path, 0, 5);

    // centroid at frame 0: (20, 10), at frame 5: (30, 30), delta: (10, 20)
    expect(matrix[0][3]).toBe(10);
    expect(matrix[1][3]).toBe(20);
    expect(matrix[0][0]).toBe(1);
    expect(matrix[1][1]).toBe(1);
  });

  it('returns identity when deriving user translation from empty path', () => {
    const path = {
      id: 'shape-1',
      name: 'Shape 1',
      shapeType: RotoShapeType.POLYGON,
      points: [],
      closed: true,
      feather: 0,
      opacity: 100,
      blend: RotoPathBlend.ADD,
      style: { mode: RotoDrawMode.FILL, strokeWidth: 1 },
    };

    const matrix = deriveUserTranslationFromPoints(path, 0, 5);

    expect(matrix).toEqual([
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ]);
  });

  it('includes userTransform in path composite matrix when requested', () => {
    const node = createNode();
    node.layers = [
      {
        id: 'layer-a',
        name: 'Layer A',
        visible: true,
        expanded: true,
        trackingTransform: {
          matrix: projectTrackingModelToMatrix4([10, 0], 'translation'),
          model: 'translation' as const,
          sourcePathIds: ['shape-1'],
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
          matrix: projectTrackingModelToMatrix4([5, 0], 'translation'),
          model: 'translation' as const,
          sourcePathIds: ['shape-1'],
        },
        userTransform: {
          matrix: projectTrackingModelToMatrix4([3, 7], 'translation'),
          model: 'translation' as const,
          sourcePathIds: [],
        },
      },
    ];

    const withoutUser = resolveRotoPathCompositeMatrix(node, node.paths[0], 0);
    const withUser = resolveRotoPathCompositeMatrix(node, node.paths[0], 0, {
      includeUserTransform: true,
    });

    // Without user: layer(10,0) + path(5,0) = (15,0)
    expect(withoutUser[0][3]).toBe(15);
    expect(withoutUser[1][3]).toBe(0);

    // With user: layer(10,0) + path(5,0) + user(3,7) = (18,7)
    expect(withUser[0][3]).toBe(18);
    expect(withUser[1][3]).toBe(7);
  });

  it('includes userTransform in layer composite matrix when requested', () => {
    const node = createNode();
    node.layers = [
      {
        id: 'layer-root',
        name: 'Root',
        visible: true,
        expanded: true,
        trackingTransform: {
          matrix: projectTrackingModelToMatrix4([10, 0], 'translation'),
          model: 'translation' as const,
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
          model: 'translation' as const,
          sourcePathIds: [],
        },
        userTransform: {
          matrix: projectTrackingModelToMatrix4([2, 3], 'translation'),
          model: 'translation' as const,
          sourcePathIds: [],
        },
      },
    ];

    const withoutUser = resolveRotoLayerCompositeMatrix(node, 'layer-a', 0);
    const withUser = resolveRotoLayerCompositeMatrix(node, 'layer-a', 0, {
      includeUserTransform: true,
    });

    // Without user: root(10,0) + layer-a(5,0) = (15,0)
    expect(withoutUser[0][3]).toBe(15);
    expect(withoutUser[1][3]).toBe(0);

    // With user: root(10,0) + layer-a(5,0) + user(2,3) = (17,3)
    expect(withUser[0][3]).toBe(17);
    expect(withUser[1][3]).toBe(3);
  });

  it('includes ancestor layer userTransform values in layer composites when requested', () => {
    const node = createNode();
    node.layers = [
      {
        id: 'layer-root',
        name: 'Root',
        visible: true,
        expanded: true,
        trackingTransform: {
          matrix: projectTrackingModelToMatrix4([10, 0], 'translation'),
          model: 'translation' as const,
          sourcePathIds: [],
        },
        userTransform: {
          matrix: projectTrackingModelToMatrix4([1, 4], 'translation'),
          model: 'translation' as const,
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
          model: 'translation' as const,
          sourcePathIds: [],
        },
        userTransform: {
          matrix: projectTrackingModelToMatrix4([2, 3], 'translation'),
          model: 'translation' as const,
          sourcePathIds: [],
        },
      },
    ];

    const withUser = resolveRotoLayerCompositeMatrix(node, 'layer-a', 0, {
      includeUserTransform: true,
    });
    const parentOnlyWithUser = resolveRotoLayerCompositeMatrix(node, 'layer-a', 0, {
      includeSelf: false,
      includeUserTransform: true,
    });

    expect(withUser[0][3]).toBe(18);
    expect(withUser[1][3]).toBe(7);
    expect(parentOnlyWithUser[0][3]).toBe(11);
    expect(parentOnlyWithUser[1][3]).toBe(4);
  });
});
