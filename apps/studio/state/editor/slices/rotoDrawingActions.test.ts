import { describe, expect, it, vi } from 'vitest';
import {
  BlendMode,
  ImageFitMode,
  NodeType,
  RotoDrawMode,
  RotoPathBlend,
  RotoShapeType,
} from '@blackboard/types';
import { getInitialState } from '@/state/editor/initialState';
import { resolveAnimatablePoints } from '@/state/editor/utils';
import { MEDIA_SOURCE_UPSTREAM } from '@/utils/mediaSourceSelection';
import { createRotoDrawingActions } from './rotoDrawingActions';

const {
  createSegmentationMaskBlobMock,
  deleteAssetsMock,
  findContoursMock,
  getSourcePixelDataForFrameMock,
  rasterizeRotoShapeForAnalysisMock,
  resolveSourcePixelSourceMock,
  saveAssetMock,
  separateRotoMaskIntoPartsMock,
} = vi.hoisted(() => ({
  createSegmentationMaskBlobMock: vi.fn(),
  deleteAssetsMock: vi.fn(),
  findContoursMock: vi.fn(),
  getSourcePixelDataForFrameMock: vi.fn(),
  rasterizeRotoShapeForAnalysisMock: vi.fn(),
  resolveSourcePixelSourceMock: vi.fn(),
  saveAssetMock: vi.fn(),
  separateRotoMaskIntoPartsMock: vi.fn(),
}));

vi.mock('@/utils/contour', () => ({
  findContours: findContoursMock,
}));

vi.mock('@/state/editor/services/sourcePixelData', () => ({
  getSourcePixelDataForFrame: getSourcePixelDataForFrameMock,
  resolveSourcePixelSource: resolveSourcePixelSourceMock,
}));

vi.mock('@/services/segmentation/maskProcessing', () => ({
  createSegmentationMaskBlob: createSegmentationMaskBlobMock,
}));

vi.mock('@/utils/rotoPartSeparation', () => ({
  separateRotoMaskIntoParts: separateRotoMaskIntoPartsMock,
  simplifyRotoPartContour: (
    points: { x: number; y: number }[],
    pointTypes?: ('bspline' | 'cardinal' | 'corner')[],
  ) => ({ points, pointTypes }),
}));

vi.mock('@/utils/rotoShapeRaster', () => ({
  getRotoControlOwnershipSamples: (_path: unknown, points: { x: number; y: number }[]) =>
    points.map((point) => [point]),
  rasterizeRotoShapeForAnalysis: rasterizeRotoShapeForAnalysisMock,
  sceneDistanceToRasterDistance: (_raster: unknown, distance: number) => distance,
  scenePointToRasterPoint: (
    raster: {
      width: number;
      height: number;
      sceneBounds: { x: number; y: number; width: number; height: number };
    },
    point: { x: number; y: number },
  ) => ({
    x: ((point.x - raster.sceneBounds.x) / raster.sceneBounds.width) * raster.width,
    y: ((point.y - raster.sceneBounds.y) / raster.sceneBounds.height) * raster.height,
  }),
  rasterPointToScenePoint: (
    raster: {
      width: number;
      height: number;
      sceneBounds: { x: number; y: number; width: number; height: number };
    },
    point: { x: number; y: number },
  ) => ({
    x: raster.sceneBounds.x + (point.x / raster.width) * raster.sceneBounds.width,
    y: raster.sceneBounds.y + (point.y / raster.height) * raster.sceneBounds.height,
  }),
}));

vi.mock('@/state/assetStorage', () => ({
  deleteAssets: deleteAssetsMock,
  saveAsset: saveAssetMock,
}));

type TestState = ReturnType<typeof getInitialState> & { maxFrames: number };

const createHarness = () => {
  const commitMutation = vi.fn();
  let state: TestState = {
    ...getInitialState(),
    maxFrames: 0,
    fps: 24,
    currentFrame: 12,
    selectedNodeId: 'roto-1',
    nodes: [
      {
        id: 'scene-1',
        type: NodeType.SCENE,
        name: 'Scene',
        enabled: true,
        width: 4,
        height: 4,
        bitDepth: 16,
        colorSpace: 'Linear',
        startFrame: 0,
        maxFrames: 0,
        fps: 24,
      },
      {
        id: 'img-1',
        type: NodeType.MEDIA_SOURCE,
        name: 'Plate',
        enabled: true,
        mediaKind: 'image',
        src: 'plate',
        width: 4,
        height: 4,
        opacity: 100,
        operator: BlendMode.OVER,
        colorSpace: 'sRGB',
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.NONE },
      },
      {
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
      },
    ],
  };

  const set = (fn: (prevState: TestState) => Partial<TestState> | TestState) => {
    state = { ...state, ...fn(state) };
  };
  const get = () => state;
  const actions = createRotoDrawingActions(set as never, get as never, {
    commitMutation: commitMutation as never,
  });

  return {
    actions,
    commitMutation,
    getState: () => state,
  };
};

describe('createRotoDrawingActions', () => {
  it('traces from the shared upstream source selection path', async () => {
    const { actions, getState } = createHarness();

    resolveSourcePixelSourceMock.mockReturnValue({
      kind: 'upstream',
      nodes: getState().nodes.slice(0, 2),
      sceneNode: getState().nodes[0],
    });
    getSourcePixelDataForFrameMock.mockResolvedValue({
      data: new Uint8ClampedArray(4 * 4 * 4),
      width: 4,
      height: 4,
    });
    findContoursMock.mockReturnValue([
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ],
    ]);

    await actions.traceNodeContour('roto-1', MEDIA_SOURCE_UPSTREAM, 'alpha', 0.5);

    expect(resolveSourcePixelSourceMock).toHaveBeenCalledWith(
      getState().nodes,
      'roto-1',
      MEDIA_SOURCE_UPSTREAM,
      getState().colorManagement,
    );
    expect(getSourcePixelDataForFrameMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'upstream' }),
      12,
      24,
    );
    expect(getState().rotoRefinement).toMatchObject({
      name: 'Trace Upstream Result',
      closed: true,
      epsilon: 2,
      originalPoints: [
        { x: -2, y: -2 },
        { x: 2, y: -2 },
        { x: 2, y: 2 },
        { x: -2, y: 2 },
      ],
    });
  });

  it('stores an accepted segmentation mask with editable contour provenance', async () => {
    const { actions, commitMutation } = createHarness();
    const maskBlob = new Blob(['mask'], { type: 'image/png' });
    createSegmentationMaskBlobMock.mockResolvedValue(maskBlob);
    saveAssetMock.mockResolvedValue('asset-mask-1');

    const pathId = await actions.commitRotoSegmentationMask({
      rotoNodeId: 'roto-1',
      name: 'Person',
      sourceId: 'img-1',
      sourceFrame: 12,
      modelId: 'onnx-community/sam3-tracker-ONNX',
      modelVariant: 'q4',
      width: 4,
      height: 4,
      score: 0.91,
      points: [{ x: 0, y: 0, label: 'include' }],
      box: { x1: -2, y1: -2, x2: 2, y2: 2 },
      cleanup: { threshold: 0, removeSpecks: 64, fillHoles: 64 },
      mask: new Uint8Array(16).fill(255),
      contour: [
        { x: -2, y: -2 },
        { x: 0, y: -2 },
        { x: 2, y: -2 },
        { x: 2, y: 0 },
        { x: 2, y: 2 },
        { x: 0, y: 2 },
        { x: -2, y: 2 },
        { x: -2, y: 0 },
        { x: -2, y: -2 },
      ],
      epsilon: 0.25,
    });

    expect(pathId).toMatch(/^path_/);
    expect(saveAssetMock).toHaveBeenCalledWith(maskBlob, { fileName: 'person.png' });
    const mutation = commitMutation.mock.calls[0]?.[0];
    const rotoNode = mutation.patch.nodes.find((node: { id: string }) => node.id === 'roto-1');
    expect(rotoNode.paths[0]).toMatchObject({
      id: pathId,
      name: 'Person',
      shapeType: RotoShapeType.BSPLINE,
      originalPoints: expect.any(Array),
      sourceMask: {
        kind: 'segmentation',
        modelId: 'onnx-community/sam3-tracker-ONNX',
        modelVariant: 'q4',
        sourceId: 'img-1',
        sourceFrame: 12,
        maskAssetId: 'asset-mask-1',
        confidence: 0.91,
      },
    });
  });

  it('separates any closed vector shape without reading or saving mask assets', async () => {
    const { actions, commitMutation, getState } = createHarness();
    const rotoNode = getState().nodes.find((node) => node.id === 'roto-1');
    if (!rotoNode || rotoNode.type !== NodeType.ROTO) throw new Error('Missing Roto node');
    rotoNode.paths[0] = {
      ...rotoNode.paths[0],
      name: 'Hand',
      shapeType: RotoShapeType.BSPLINE,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ],
      pointTypes: ['bspline', 'cardinal', 'bspline'],
      epsilon: 0.25,
    };

    const sourceMask = new Uint8Array(16).fill(255);
    rasterizeRotoShapeForAnalysisMock.mockReturnValue({
      mask: sourceMask,
      width: 4,
      height: 4,
      sceneBounds: { x: -2, y: -2, width: 4, height: 4 },
    });
    separateRotoMaskIntoPartsMock.mockReturnValue({
      width: 4,
      height: 4,
      sourceMask,
      parts: [
        {
          index: 0,
          seed: { x: 1, y: 2 },
          mask: sourceMask,
          contour: [
            { x: 0, y: 0 },
            { x: 2, y: 0 },
            { x: 2, y: 2 },
            { x: 2, y: 4 },
            { x: 0, y: 4 },
          ],
          editableContour: [
            { x: 2, y: 2 },
            { x: 3, y: 2 },
            { x: 2, y: 3 },
            { x: 0, y: 4 },
          ],
          editablePointTypes: ['bspline', 'cardinal', 'bspline', 'cardinal'],
          editablePointOrigins: ['source', 'source', 'source', 'overlap'],
          seamPointCounts: [2],
          corePixelCount: 8,
          pixelCount: 10,
        },
        {
          index: 1,
          seed: { x: 3, y: 2 },
          mask: sourceMask,
          contour: [
            { x: 2, y: 0 },
            { x: 4, y: 0 },
            { x: 4, y: 4 },
            { x: 2, y: 4 },
          ],
          editableContour: [
            { x: 2, y: 0 },
            { x: 4, y: 0 },
            { x: 4, y: 4 },
            { x: 2, y: 4 },
          ],
          editablePointTypes: ['cardinal', 'cardinal', 'cardinal', 'cardinal'],
          editablePointOrigins: ['overlap', 'overlap', 'overlap', 'overlap'],
          seamPointCounts: [2],
          corePixelCount: 8,
          pixelCount: 10,
        },
      ],
    });
    createSegmentationMaskBlobMock.mockClear();
    saveAssetMock.mockClear();

    const pathIds = await actions.separateRotoShapeParts('roto-1', 'shape-1', {
      partCount: 'auto',
      overlap: 3,
      branchReach: 2.5,
    });

    expect(pathIds).toHaveLength(2);
    const mutation = commitMutation.mock.calls.at(-1)?.[0];
    const nextRoto = mutation.patch.nodes.find((node: { id: string }) => node.id === 'roto-1');
    expect(nextRoto.layers[0]).toMatchObject({ name: 'Hand Parts', visible: true, expanded: true });
    expect(nextRoto.paths.slice(0, 2)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Hand · Part 1',
          parentLayerId: nextRoto.layers[0].id,
        }),
        expect.objectContaining({
          name: 'Hand · Part 2',
        }),
      ]),
    );
    expect(nextRoto.paths.find((path: { id: string }) => path.id === 'shape-1').visible).toBe(
      false,
    );
    const firstPart = nextRoto.paths.find(
      (path: { name: string }) => path.name === 'Hand · Part 1',
    );
    expect(nextRoto.paths.slice(0, 2).every((part: object) => !('sourceMask' in part))).toBe(true);
    expect(firstPart.points.length).toBeLessThan(firstPart.originalPoints.length);
    expect(firstPart.pointTypes).toEqual(['bspline', 'cardinal', 'bspline', 'cardinal']);
    expect(firstPart.pointTypes).not.toContain('corner');
    const resolvedPartPoints = resolveAnimatablePoints(firstPart.points, 12);
    expect(resolvedPartPoints).toEqual(
      expect.arrayContaining([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ]),
    );
    expect(mutation.patch.hierarchySelections['roto-1']).toEqual({
      layerIds: [nextRoto.layers[0].id],
      itemIds: [],
    });
    expect(rasterizeRotoShapeForAnalysisMock).toHaveBeenCalledWith(
      rotoNode,
      expect.objectContaining({ id: 'shape-1' }),
      12,
      expect.objectContaining({ id: 'scene-1' }),
    );
    expect('sourceMask' in rasterizeRotoShapeForAnalysisMock.mock.calls[0][1]).toBe(false);
    expect(createSegmentationMaskBlobMock).not.toHaveBeenCalled();
    expect(saveAssetMock).not.toHaveBeenCalled();
    expect(separateRotoMaskIntoPartsMock).toHaveBeenCalledWith(
      sourceMask,
      4,
      4,
      {
        partCount: 'auto',
        overlap: 3,
        branchReach: 2.5,
      },
      {
        points: [
          { x: 2, y: 2 },
          { x: 3, y: 2 },
          { x: 2, y: 3 },
        ],
        pointTypes: ['bspline', 'cardinal', 'bspline'],
        ownershipSamples: [[{ x: 2, y: 2 }], [{ x: 3, y: 2 }], [{ x: 2, y: 3 }]],
      },
    );
  });
});
