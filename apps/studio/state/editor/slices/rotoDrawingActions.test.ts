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
import { MEDIA_SOURCE_UPSTREAM } from '@/utils/mediaSourceSelection';
import { createRotoDrawingActions } from './rotoDrawingActions';

const { findContoursMock, getSourcePixelDataForFrameMock, resolveSourcePixelSourceMock } =
  vi.hoisted(() => ({
    findContoursMock: vi.fn(),
    getSourcePixelDataForFrameMock: vi.fn(),
    resolveSourcePixelSourceMock: vi.fn(),
  }));

vi.mock('@/utils/contour', () => ({
  findContours: findContoursMock,
}));

vi.mock('@/state/editor/services/sourcePixelData', () => ({
  getSourcePixelDataForFrame: getSourcePixelDataForFrameMock,
  resolveSourcePixelSource: resolveSourcePixelSourceMock,
}));

type TestState = ReturnType<typeof getInitialState> & { maxFrames: number };

const createHarness = () => {
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
        visible: true,
        width: 4,
        height: 4,
        bitDepth: 16,
        colorSpace: 'Linear',
        maxFrames: 0,
        fps: 24,
      },
      {
        id: 'img-1',
        type: NodeType.IMAGE,
        name: 'Plate',
        visible: true,
        src: 'plate',
        width: 4,
        height: 4,
        opacity: 100,
        operator: BlendMode.OVER,
        colorSpace: 'sRGB',
        transform: { x: 0, y: 0, scale: 1, fitMode: ImageFitMode.NONE },
      },
      {
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
      },
    ],
  };

  const set = (fn: (prevState: TestState) => Partial<TestState> | TestState) => {
    state = { ...state, ...fn(state) };
  };
  const get = () => state;
  const actions = createRotoDrawingActions(set as never, get as never, {
    pushHistory: vi.fn(),
  });

  return {
    actions,
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
});
