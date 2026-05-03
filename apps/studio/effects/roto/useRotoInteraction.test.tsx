// @vitest-environment jsdom

import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  NodeType,
  RotoDrawMode,
  RotoPathBlend,
  RotoShapeType,
  type Point,
  type RotoNode,
  type RotoPath,
} from '@blackboard/types';
import { useRotoInteraction } from './useRotoInteraction';

const createRotoNode = (): RotoNode =>
  ({
    id: 'roto-1',
    type: NodeType.ROTO,
    name: 'Roto',
    visible: true,
    invert: false,
    layers: [],
    paths: [],
  }) as RotoNode;

const createDrawingPath = (): RotoPath =>
  ({
    id: 'path_drawing_1',
    name: 'Shape 1',
    shapeType: RotoShapeType.BSPLINE,
    parentLayerId: null,
    points: [{ x: 10, y: 20 }],
    closed: false,
    feather: 0,
    opacity: 100,
    blend: RotoPathBlend.ADD,
    style: { mode: RotoDrawMode.STROKE, strokeWidth: 2 },
  }) as RotoPath;

const createMouseEvent = () =>
  ({
    button: 0,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    clientX: 100,
    clientY: 120,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  }) as unknown as React.MouseEvent<HTMLDivElement>;

const createAltMouseEvent = (clientPoint: Point = { x: 100, y: 120 }) =>
  ({
    ...createMouseEvent(),
    altKey: true,
    clientX: clientPoint.x,
    clientY: clientPoint.y,
  }) as unknown as React.MouseEvent<HTMLDivElement>;

const createMarqueeMouseEvent = () =>
  ({
    ...createMouseEvent(),
    currentTarget: document.createElement('div'),
    target: null,
  }) as unknown as React.MouseEvent<HTMLDivElement>;

describe('useRotoInteraction bspline drawing', () => {
  it('starts a new spline on mouse down without entering new-point drag mode', () => {
    const startDrawingShape = vi.fn();
    const addPointToDrawingShape = vi.fn();
    const node = createRotoNode();

    const { result } = renderHook(() =>
      useRotoInteraction({
        selectedNode: node,
        selectedNodeId: node.id,
        nodes: [node],
        selectedRotoLayerIds: [],
        selectedRotoPathIds: [],
        selectedRotoPointRefs: [],
        zoom: 1,
        visualFrame: 0,
        activeViewportTool: 'bspline',
        altPressed: false,
        shiftPressed: false,
        affineModifierPressed: false,
        mouseScenePos: null,
        isDrawing: false,
        drawingRotoPath: null,
        rotoRefinement: null,
        nudgeRadius: 50,
        rotoPointWeightMode: 'global',
        viewportRef: { current: document.createElement('div') },
        viewportToSceneCentered: (pos) => pos,
        updateNode: vi.fn(),
        pushHistory: vi.fn(),
        setSelectedRotoPathIds: vi.fn(),
        setSelectedRotoSelection: vi.fn(),
        setActiveViewportTool: vi.fn(),
        startDrawingShape,
        addPointToDrawingShape,
        updateDrawingPoint: vi.fn(),
        commitDrawingShape: vi.fn(),
        cancelDrawingShape: vi.fn(),
        addRotoPointToPath: vi.fn(),
        startRotoRefinement: vi.fn(),
        commitRotoRefinement: vi.fn(),
        setPreferences: vi.fn(),
      }),
    );

    act(() => {
      result.current.handleMouseDown(createMouseEvent(), { x: 50, y: 60 }, { x: 50, y: 60 });
    });

    expect(startDrawingShape).toHaveBeenCalledTimes(1);
    expect(addPointToDrawingShape).not.toHaveBeenCalled();
    expect(result.current.dragNewPointIndex).toBeNull();
    expect(result.current.bsplinePreviewPoint).toEqual({ x: 50, y: 60 });
  });

  it('adds follow-up spline points on mouse down without dragging them to mouse up', () => {
    const startDrawingShape = vi.fn();
    const addPointToDrawingShape = vi.fn();
    const node = createRotoNode();

    const { result } = renderHook(() =>
      useRotoInteraction({
        selectedNode: node,
        selectedNodeId: node.id,
        nodes: [node],
        selectedRotoLayerIds: [],
        selectedRotoPathIds: [],
        selectedRotoPointRefs: [],
        zoom: 1,
        visualFrame: 0,
        activeViewportTool: 'bspline',
        altPressed: false,
        shiftPressed: false,
        affineModifierPressed: false,
        mouseScenePos: null,
        isDrawing: true,
        drawingRotoPath: createDrawingPath(),
        rotoRefinement: null,
        nudgeRadius: 50,
        rotoPointWeightMode: 'global',
        viewportRef: { current: document.createElement('div') },
        viewportToSceneCentered: (pos) => pos,
        updateNode: vi.fn(),
        pushHistory: vi.fn(),
        setSelectedRotoPathIds: vi.fn(),
        setSelectedRotoSelection: vi.fn(),
        setActiveViewportTool: vi.fn(),
        startDrawingShape,
        addPointToDrawingShape,
        updateDrawingPoint: vi.fn(),
        commitDrawingShape: vi.fn(),
        cancelDrawingShape: vi.fn(),
        addRotoPointToPath: vi.fn(),
        startRotoRefinement: vi.fn(),
        commitRotoRefinement: vi.fn(),
        setPreferences: vi.fn(),
      }),
    );

    act(() => {
      result.current.handleMouseDown(createMouseEvent(), { x: 70, y: 80 }, { x: 70, y: 80 });
    });

    expect(startDrawingShape).not.toHaveBeenCalled();
    expect(addPointToDrawingShape).toHaveBeenCalledTimes(1);
    expect(result.current.dragNewPointIndex).toBeNull();
    expect(result.current.bsplinePreviewPoint).toEqual({ x: 70, y: 80 });
  });

  it('starts Alt weight-handle drags on selected points and updates the whole selection', () => {
    const updateNode = vi.fn();
    const node = {
      ...createRotoNode(),
      paths: [
        {
          ...createDrawingPath(),
          id: 'shape-1',
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 20, y: 10 },
            { x: 30, y: 0 },
          ],
        },
      ],
    } as RotoNode;

    const { result } = renderHook(() =>
      useRotoInteraction({
        selectedNode: node,
        selectedNodeId: node.id,
        nodes: [node],
        selectedRotoLayerIds: [],
        selectedRotoPathIds: ['shape-1'],
        selectedRotoPointRefs: [
          { pathId: 'shape-1', pointIndex: 1 },
          { pathId: 'shape-1', pointIndex: 2 },
        ],
        zoom: 1,
        visualFrame: 0,
        activeViewportTool: 'select',
        altPressed: true,
        shiftPressed: false,
        affineModifierPressed: false,
        mouseScenePos: null,
        isDrawing: false,
        drawingRotoPath: null,
        rotoRefinement: null,
        nudgeRadius: 50,
        rotoPointWeightMode: 'global',
        viewportRef: {
          current: {
            getBoundingClientRect: () => ({ left: 0, top: 0 }),
          } as unknown as HTMLDivElement,
        },
        viewportToSceneCentered: (pos) => pos,
        updateNode,
        pushHistory: vi.fn(),
        setSelectedRotoPathIds: vi.fn(),
        setSelectedRotoSelection: vi.fn(),
        setActiveViewportTool: vi.fn(),
        startDrawingShape: vi.fn(),
        addPointToDrawingShape: vi.fn(),
        updateDrawingPoint: vi.fn(),
        commitDrawingShape: vi.fn(),
        cancelDrawingShape: vi.fn(),
        addRotoPointToPath: vi.fn(),
        startRotoRefinement: vi.fn(),
        commitRotoRefinement: vi.fn(),
        setPreferences: vi.fn(),
      }),
    );

    act(() => {
      result.current.beginPointWeightDrag(createAltMouseEvent({ x: 10, y: 0 }), 'shape-1', 1, {
        x: 0,
        y: -1,
      });
    });

    expect(result.current.pointWeightDragState?.pointIndices).toEqual([1, 2]);
    expect(result.current.pointWeightControlState).toEqual({
      pathId: 'shape-1',
      pointIndex: 1,
      pointIndices: [1, 2],
    });

    act(() => {
      result.current.handleMouseMove(
        createAltMouseEvent({ x: 10, y: -10 }),
        { x: 10, y: -10 },
        {
          x: 10,
          y: -10,
        },
      );
    });

    expect(updateNode).toHaveBeenCalledTimes(1);
    expect(updateNode).toHaveBeenLastCalledWith(
      node.id,
      expect.objectContaining({
        paths: [
          expect.objectContaining({
            id: 'shape-1',
            pointWeights: [1, 2, 2, 1],
          }),
        ],
      }),
      false,
    );
  });

  it('falls back to the interacted point when no roto points are selected', () => {
    const updateNode = vi.fn();
    const node = {
      ...createRotoNode(),
      paths: [
        {
          ...createDrawingPath(),
          id: 'shape-1',
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 20, y: 10 },
            { x: 30, y: 0 },
          ],
        },
      ],
    } as RotoNode;

    const { result } = renderHook(() =>
      useRotoInteraction({
        selectedNode: node,
        selectedNodeId: node.id,
        nodes: [node],
        selectedRotoLayerIds: [],
        selectedRotoPathIds: ['shape-1'],
        selectedRotoPointRefs: [],
        zoom: 1,
        visualFrame: 0,
        activeViewportTool: 'select',
        altPressed: true,
        shiftPressed: false,
        affineModifierPressed: false,
        mouseScenePos: null,
        isDrawing: false,
        drawingRotoPath: null,
        rotoRefinement: null,
        nudgeRadius: 50,
        rotoPointWeightMode: 'global',
        viewportRef: {
          current: {
            getBoundingClientRect: () => ({ left: 0, top: 0 }),
          } as unknown as HTMLDivElement,
        },
        viewportToSceneCentered: (pos) => pos,
        updateNode,
        pushHistory: vi.fn(),
        setSelectedRotoPathIds: vi.fn(),
        setSelectedRotoSelection: vi.fn(),
        setActiveViewportTool: vi.fn(),
        startDrawingShape: vi.fn(),
        addPointToDrawingShape: vi.fn(),
        updateDrawingPoint: vi.fn(),
        commitDrawingShape: vi.fn(),
        cancelDrawingShape: vi.fn(),
        addRotoPointToPath: vi.fn(),
        startRotoRefinement: vi.fn(),
        commitRotoRefinement: vi.fn(),
        setPreferences: vi.fn(),
      }),
    );

    act(() => {
      result.current.beginPointWeightDrag(createAltMouseEvent({ x: 20, y: 10 }), 'shape-1', 2, {
        x: 0,
        y: -1,
      });
    });

    expect(result.current.pointWeightDragState?.pointIndices).toEqual([2]);
    expect(result.current.pointWeightControlState).toEqual({
      pathId: 'shape-1',
      pointIndex: 2,
      pointIndices: [2],
    });

    act(() => {
      result.current.handleMouseMove(
        createAltMouseEvent({ x: 20, y: 0 }),
        { x: 20, y: 0 },
        {
          x: 20,
          y: 0,
        },
      );
    });

    expect(updateNode).toHaveBeenCalledTimes(1);
    expect(updateNode).toHaveBeenLastCalledWith(
      node.id,
      expect.objectContaining({
        paths: [
          expect.objectContaining({
            id: 'shape-1',
            pointWeights: [1, 1, 2, 1],
          }),
        ],
      }),
      false,
    );
  });
});

describe('useRotoInteraction rectangle drawing', () => {
  it('commits rectangles as closed b-spline paths with corner points', () => {
    const updateNode = vi.fn();
    const setSelectedRotoPathIds = vi.fn();
    const setActiveViewportTool = vi.fn();
    const node = createRotoNode();

    const { result } = renderHook(() =>
      useRotoInteraction({
        selectedNode: node,
        selectedNodeId: node.id,
        nodes: [node],
        selectedRotoLayerIds: [],
        selectedRotoPathIds: [],
        selectedRotoPointRefs: [],
        zoom: 1,
        visualFrame: 12,
        activeViewportTool: 'rectangle',
        altPressed: false,
        shiftPressed: false,
        affineModifierPressed: false,
        mouseScenePos: null,
        isDrawing: false,
        drawingRotoPath: null,
        rotoRefinement: null,
        nudgeRadius: 50,
        rotoPointWeightMode: 'global',
        viewportRef: { current: document.createElement('div') },
        viewportToSceneCentered: (pos) => pos,
        updateNode,
        pushHistory: vi.fn(),
        setSelectedRotoPathIds,
        setSelectedRotoSelection: vi.fn(),
        setActiveViewportTool,
        startDrawingShape: vi.fn(),
        addPointToDrawingShape: vi.fn(),
        updateDrawingPoint: vi.fn(),
        commitDrawingShape: vi.fn(),
        cancelDrawingShape: vi.fn(),
        addRotoPointToPath: vi.fn(),
        startRotoRefinement: vi.fn(),
        commitRotoRefinement: vi.fn(),
        setPreferences: vi.fn(),
      }),
    );

    act(() => {
      result.current.handleMouseDown(createMouseEvent(), { x: 30, y: 50 }, { x: 30, y: 50 });
    });

    act(() => {
      result.current.handleMouseMove(createMouseEvent(), { x: 10, y: 20 }, { x: 10, y: 20 });
    });

    act(() => {
      result.current.handleMouseUp(createMouseEvent());
    });

    expect(updateNode).toHaveBeenCalledWith(
      node.id,
      expect.objectContaining({ paths: expect.any(Array) }),
      true,
    );

    const committedPath = updateNode.mock.calls[0][1].paths[0] as RotoPath;
    expect(committedPath.shapeType).toBe(RotoShapeType.BSPLINE);
    expect(committedPath.closed).toBe(true);
    expect(committedPath.pointTypes).toEqual(['corner', 'corner', 'corner', 'corner']);
    expect(committedPath.style).toEqual({ mode: RotoDrawMode.FILL, strokeWidth: 2 });
    expect(committedPath.points).toEqual([
      { x: [{ frame: 12, value: 10 }], y: [{ frame: 12, value: 20 }] },
      { x: [{ frame: 12, value: 30 }], y: [{ frame: 12, value: 20 }] },
      { x: [{ frame: 12, value: 30 }], y: [{ frame: 12, value: 50 }] },
      { x: [{ frame: 12, value: 10 }], y: [{ frame: 12, value: 50 }] },
    ]);
    expect(setSelectedRotoPathIds).toHaveBeenCalledWith([committedPath.id]);
    expect(setActiveViewportTool).toHaveBeenCalledWith('select');
  });
});

describe('useRotoInteraction temporal controller', () => {
  it('shows a Shift controller between neighboring roto keyframes and commits a sampled key', () => {
    const updateNode = vi.fn();
    const pushHistory = vi.fn();
    const animatedPath = {
      ...createDrawingPath(),
      id: 'shape-1',
      points: [
        {
          x: [
            { frame: 0, value: 0 },
            { frame: 10, value: 10 },
          ],
          y: [
            { frame: 0, value: 0 },
            { frame: 10, value: 0 },
          ],
        },
        {
          x: [
            { frame: 0, value: 10 },
            { frame: 10, value: 20 },
          ],
          y: [
            { frame: 0, value: 0 },
            { frame: 10, value: 0 },
          ],
        },
      ],
    } as RotoPath;
    const node = { ...createRotoNode(), paths: [animatedPath] } as RotoNode;

    const { result } = renderHook(() =>
      useRotoInteraction({
        selectedNode: node,
        selectedNodeId: node.id,
        nodes: [node],
        selectedRotoLayerIds: [],
        selectedRotoPathIds: ['shape-1'],
        selectedRotoPointRefs: [],
        zoom: 1,
        visualFrame: 5,
        activeViewportTool: 'select',
        altPressed: false,
        shiftPressed: true,
        affineModifierPressed: false,
        mouseScenePos: null,
        isDrawing: false,
        drawingRotoPath: null,
        rotoRefinement: null,
        nudgeRadius: 50,
        rotoPointWeightMode: 'global',
        viewportRef: { current: document.createElement('div') },
        viewportToSceneCentered: (pos) => pos,
        updateNode,
        pushHistory,
        setSelectedRotoPathIds: vi.fn(),
        setSelectedRotoSelection: vi.fn(),
        setActiveViewportTool: vi.fn(),
        startDrawingShape: vi.fn(),
        addPointToDrawingShape: vi.fn(),
        updateDrawingPoint: vi.fn(),
        commitDrawingShape: vi.fn(),
        cancelDrawingShape: vi.fn(),
        addRotoPointToPath: vi.fn(),
        startRotoRefinement: vi.fn(),
        commitRotoRefinement: vi.fn(),
        setPreferences: vi.fn(),
      }),
    );

    expect(result.current.temporalController?.prevFrame).toBe(0);
    expect(result.current.temporalController?.nextFrame).toBe(10);
    expect(result.current.temporalController?.value).toBe(0.5);
    expect(result.current.temporalController?.paths[0].previewPoints[0]).toEqual({ x: 5, y: 0 });

    act(() => {
      result.current.commitTemporalController(0.25);
    });

    const committedPath = updateNode.mock.calls[0][1].paths[0] as RotoPath;
    expect(committedPath.points[0].x).toEqual(
      expect.arrayContaining([expect.objectContaining({ frame: 5, value: 2.5 })]),
    );
    expect(committedPath.points[1].x).toEqual(
      expect.arrayContaining([expect.objectContaining({ frame: 5, value: 12.5 })]),
    );
    expect(pushHistory).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Set Roto Temporal Keyframe' }),
    );
  });

  it('keeps the current shape unchanged at the Shift controller default value', () => {
    const updateNode = vi.fn();
    const pushHistory = vi.fn();
    const animatedPath = {
      ...createDrawingPath(),
      id: 'shape-1',
      points: [
        {
          x: [
            { frame: 0, value: 0 },
            { frame: 10, value: 10 },
          ],
          y: [
            { frame: 0, value: 0 },
            { frame: 10, value: 0 },
          ],
        },
      ],
      trackingTransform: {
        model: 'affine',
        sourcePathIds: [],
        matrix: [
          [
            [
              { frame: 0, value: 1 },
              { frame: 10, value: 2 },
            ],
            0,
            0,
            0,
          ],
          [0, 1, 0, 0],
          [0, 0, 1, 0],
          [0, 0, 0, 1],
        ],
      },
    } as RotoPath;
    const node = { ...createRotoNode(), paths: [animatedPath] } as RotoNode;

    const { result } = renderHook(() =>
      useRotoInteraction({
        selectedNode: node,
        selectedNodeId: node.id,
        nodes: [node],
        selectedRotoLayerIds: [],
        selectedRotoPathIds: ['shape-1'],
        selectedRotoPointRefs: [],
        zoom: 1,
        visualFrame: 5,
        activeViewportTool: 'select',
        altPressed: false,
        shiftPressed: true,
        affineModifierPressed: false,
        mouseScenePos: null,
        isDrawing: false,
        drawingRotoPath: null,
        rotoRefinement: null,
        nudgeRadius: 50,
        rotoPointWeightMode: 'global',
        viewportRef: { current: document.createElement('div') },
        viewportToSceneCentered: (pos) => pos,
        updateNode,
        pushHistory,
        setSelectedRotoPathIds: vi.fn(),
        setSelectedRotoSelection: vi.fn(),
        setActiveViewportTool: vi.fn(),
        startDrawingShape: vi.fn(),
        addPointToDrawingShape: vi.fn(),
        updateDrawingPoint: vi.fn(),
        commitDrawingShape: vi.fn(),
        cancelDrawingShape: vi.fn(),
        addRotoPointToPath: vi.fn(),
        startRotoRefinement: vi.fn(),
        commitRotoRefinement: vi.fn(),
        setPreferences: vi.fn(),
      }),
    );

    const controllerPath = result.current.temporalController?.paths[0];
    expect(controllerPath?.oldPoints[0].x).toBeCloseTo(7.5);
    expect(controllerPath?.previewPoints[0]).toEqual(controllerPath?.oldPoints[0]);

    act(() => {
      result.current.commitTemporalController(result.current.temporalController?.defaultValue ?? 0);
    });

    const committedPath = updateNode.mock.calls[0][1].paths[0] as RotoPath;
    const committedKey = (
      committedPath.points[0].x as Exclude<(typeof committedPath.points)[0]['x'], number>
    ).find((keyframe) => keyframe.frame === 5);
    expect(committedKey?.value).toBeCloseTo(5);
  });

  it('uses a linear three-key base and releases toward prev-next sampling', () => {
    const updateNode = vi.fn();
    const keyedPath = {
      ...createDrawingPath(),
      id: 'shape-1',
      points: [
        {
          x: [
            { frame: 0, value: 0 },
            { frame: 5, value: 20 },
            { frame: 10, value: 10 },
          ],
          y: [
            { frame: 0, value: 0 },
            { frame: 10, value: 0 },
          ],
        },
      ],
    } as RotoPath;
    const node = { ...createRotoNode(), paths: [keyedPath] } as RotoNode;

    const { result } = renderHook(() =>
      useRotoInteraction({
        selectedNode: node,
        selectedNodeId: node.id,
        nodes: [node],
        selectedRotoLayerIds: [],
        selectedRotoPathIds: ['shape-1'],
        selectedRotoPointRefs: [],
        zoom: 1,
        visualFrame: 5,
        activeViewportTool: 'select',
        altPressed: false,
        shiftPressed: true,
        affineModifierPressed: false,
        mouseScenePos: null,
        isDrawing: false,
        drawingRotoPath: null,
        rotoRefinement: null,
        nudgeRadius: 50,
        rotoPointWeightMode: 'global',
        viewportRef: { current: document.createElement('div') },
        viewportToSceneCentered: (pos) => pos,
        updateNode,
        pushHistory: vi.fn(),
        setSelectedRotoPathIds: vi.fn(),
        setSelectedRotoSelection: vi.fn(),
        setActiveViewportTool: vi.fn(),
        startDrawingShape: vi.fn(),
        addPointToDrawingShape: vi.fn(),
        updateDrawingPoint: vi.fn(),
        commitDrawingShape: vi.fn(),
        cancelDrawingShape: vi.fn(),
        addRotoPointToPath: vi.fn(),
        startRotoRefinement: vi.fn(),
        commitRotoRefinement: vi.fn(),
        setPreferences: vi.fn(),
      }),
    );

    expect(result.current.temporalController?.hasCurrentKeyframe).toBe(true);
    expect(result.current.temporalController?.value).toBe(0.5);
    expect(result.current.temporalController?.mixValue).toBe(0);
    expect(result.current.temporalController?.paths[0].oldPoints[0]).toEqual({ x: 20, y: 0 });
    expect(result.current.temporalController?.paths[0].previewPoints[0]).toEqual({
      x: 20,
      y: 0,
    });

    act(() => {
      result.current.setTemporalControllerValue({ time: 0.25, mix: 0 });
    });

    expect(result.current.temporalController?.paths[0].previewPoints[0].x).toBeCloseTo(10);

    act(() => {
      result.current.setTemporalControllerValue({ time: 0.25, mix: 1 });
    });

    expect(result.current.temporalController?.paths[0].previewPoints[0].x).toBeCloseTo(2.5);

    act(() => {
      result.current.setTemporalControllerValue({ time: 0.5, mix: 1 });
    });

    expect(result.current.temporalController?.paths[0].previewPoints[0]).toEqual({
      x: 5,
      y: 0,
    });

    act(() => {
      result.current.commitTemporalController({ time: 0.5, mix: 1 });
    });

    const committedPath = updateNode.mock.calls[0][1].paths[0] as RotoPath;
    const committedKey = (
      committedPath.points[0].x as Exclude<(typeof committedPath.points)[0]['x'], number>
    ).find((keyframe) => keyframe.frame === 5);
    expect(committedKey?.value).toBeCloseTo(5);
  });
});

describe('useRotoInteraction marquee selection', () => {
  it('selects points across multiple selected shapes on the second marquee drag', () => {
    const setSelectedRotoPathIds = vi.fn();
    const setSelectedRotoSelection = vi.fn();
    const node = {
      ...createRotoNode(),
      paths: [
        {
          ...createDrawingPath(),
          id: 'shape-1',
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
          ],
          closed: true,
          shapeType: RotoShapeType.POLYGON,
        },
        {
          ...createDrawingPath(),
          id: 'shape-2',
          points: [
            { x: 30, y: 0 },
            { x: 40, y: 0 },
            { x: 40, y: 10 },
            { x: 30, y: 10 },
          ],
          closed: true,
          shapeType: RotoShapeType.POLYGON,
        },
      ],
    } as RotoNode;

    const { result } = renderHook(() =>
      useRotoInteraction({
        selectedNode: node,
        selectedNodeId: node.id,
        nodes: [node],
        selectedRotoLayerIds: [],
        selectedRotoPathIds: ['shape-1', 'shape-2'],
        selectedRotoPointRefs: [],
        zoom: 1,
        visualFrame: 0,
        activeViewportTool: 'select',
        altPressed: false,
        shiftPressed: false,
        affineModifierPressed: false,
        mouseScenePos: null,
        isDrawing: false,
        drawingRotoPath: null,
        rotoRefinement: null,
        nudgeRadius: 50,
        rotoPointWeightMode: 'global',
        viewportRef: { current: document.createElement('div') },
        viewportToSceneCentered: (pos) => pos,
        updateNode: vi.fn(),
        pushHistory: vi.fn(),
        setSelectedRotoPathIds,
        setSelectedRotoSelection,
        setActiveViewportTool: vi.fn(),
        startDrawingShape: vi.fn(),
        addPointToDrawingShape: vi.fn(),
        updateDrawingPoint: vi.fn(),
        commitDrawingShape: vi.fn(),
        cancelDrawingShape: vi.fn(),
        addRotoPointToPath: vi.fn(),
        startRotoRefinement: vi.fn(),
        commitRotoRefinement: vi.fn(),
        setPreferences: vi.fn(),
      }),
    );

    act(() => {
      const event = createMarqueeMouseEvent();
      event.target = event.currentTarget;
      result.current.handleMouseDown(event, { x: -1, y: -1 }, { x: -1, y: -1 });
    });

    act(() => {
      result.current.handleMouseMove(createMouseEvent(), { x: 41, y: 11 }, { x: 41, y: 11 });
    });

    act(() => {
      result.current.handleMouseUp(createMouseEvent());
    });

    expect(setSelectedRotoSelection).toHaveBeenCalledWith({
      layerIds: [],
      pathIds: ['shape-1', 'shape-2'],
      pointRefs: [
        { pathId: 'shape-1', pointIndex: 0 },
        { pathId: 'shape-1', pointIndex: 1 },
        { pathId: 'shape-1', pointIndex: 2 },
        { pathId: 'shape-1', pointIndex: 3 },
        { pathId: 'shape-2', pointIndex: 0 },
        { pathId: 'shape-2', pointIndex: 1 },
        { pathId: 'shape-2', pointIndex: 2 },
        { pathId: 'shape-2', pointIndex: 3 },
      ],
    });
    expect(setSelectedRotoPathIds).not.toHaveBeenCalled();
  });
});
