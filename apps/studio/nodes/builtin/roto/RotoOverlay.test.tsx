// @vitest-environment jsdom

import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NodeType, type RotoNode } from '@blackboard/types';
import RotoOverlay from './RotoOverlay';

vi.hoisted(() => {
  Object.defineProperty(globalThis, '__BLACKBOARD_STUDIO_DESKTOP__', {
    value: false,
    configurable: true,
  });
  if (typeof window !== 'undefined' && !window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
      configurable: true,
    });
  }
});

const createRotoNode = (): RotoNode =>
  ({
    id: 'roto-1',
    type: NodeType.ROTO,
    name: 'Roto',
    enabled: true,
    invert: false,
    layers: [],
    paths: [],
  }) as RotoNode;

/** Build the minimum context needed to render the transform selection bbox. */
const createMinimalProps = (activeTransformHandle: string | null) =>
  ({
    node: createRotoNode(),
    frame: 0,
    zoom: 1,
    pan: { x: 0, y: 0 },
    scene: { width: 1920, height: 1080 },
    activeViewportTool: 'select',
    activeTool: 'select',
    context: {
      viewport: {
        showOverlays: true,
        altPressed: false,
        affineModifierPressed: false,
        mouseScenePos: null,
        viewportSize: { width: 1920, height: 1080 },
        transformInputDataWindowRect: null,
        stabilizationMatrix: null,
        activeViewportTool: 'select',
      },
      roto: {
        interaction: {
          isRotoSelectActive: true,
          rotoTransformSelection: {
            mode: 'paths',
            refs: [],
            points: [],
            bounds: {
              minX: 10,
              minY: 20,
              maxX: 130,
              maxY: 100,
              width: 120,
              height: 80,
              centerX: 70,
              centerY: 60,
            },
          },
          transformIsDegenerate: false,
          activeTransformHandle,
          // Fields below are destructured but only used inside JSX event handlers
          // or conditional branches that won't fire during this test.
          // Providing sensible defaults to avoid runtime errors.
          transformMoveHandleRadius: 7,
          transformRotateHitRadius: 14,
          transformHandleSize: 8,
          transformHandleHitSize: 16,
          transformHandlePositions: [],
          transformRotateHandlePoint: null,
          transformInteractionLabel: null,
          hoveredTransformHandle: null,
          isMoveTransformActive: activeTransformHandle === 'move',
          isMoveTransformHovered: false,
          isRotateTransformActive: activeTransformHandle === 'rotate',
          isRotateTransformHovered: false,
          beginRotoTransformDrag: vi.fn(),
          setHoveredTransformHandle: vi.fn(),
          setHoveredRotoPathId: vi.fn(),
          hoveredRotoPathId: null,
          dragPointState: null,
          hoveredPointInfo: null,
          handlePointMouseDown: vi.fn(),
          beginPointWeightDrag: vi.fn(),
          setSelectedPointWeightMode: vi.fn(),
          setSelectedPointType: vi.fn(),
          setHoveredPointInfo: vi.fn(),
          pointWeightDragState: null,
          pointWeightControlState: null,
          temporalController: null,
          setTemporalControllerValue: vi.fn(),
          commitTemporalController: vi.fn(),
          hoveredSegment: null,
          bsplineDrawingState: null,
          drawingState: null,
          freehandPoints: null,
          isHoveringClosePoint: false,
          marqueeState: null,
        },
        nudgeOverlayState: {
          activeViewportTool: 'select',
          altPressed: false,
          isAdjustingRadius: false,
          nudgeDragState: null,
          radiusAdjustCenter: null,
          radiusAdjustInitialRadius: null,
          mouseScenePos: null,
          nudgeRadius: 50,
          nudgePreviewPoints: [],
        },
        pointWeightMode: 'global',
        selectedLayerIds: [],
        selectedPathIds: [],
        selectedPointRefs: [],
        setSelectedPointRefs: vi.fn(),
        setHierarchySelection: vi.fn(),
        motionCueTargetPathIdSet: new Set(),
        gradientTrailsByPath: new Map(),
        speedHeatSegmentsByPath: new Map(),
        motionBlurCuePathsByPath: new Map(),
        motionCueEnabled: false,
        motionCueMode: 'gradient_trail',
        isDrawing: false,
        drawingPath: null,
        refinement: null,
        refinementSimplifiedPoints: [],
        activeTrackingPoints: null,
      },
      paint: {},
      warp: {},
      spatial: {},
      comfyCrop: {},
      selectedViewportNode: undefined,
    },
  }) as unknown as React.ComponentProps<typeof RotoOverlay>;

describe('RotoOverlay transform selection', () => {
  it('hides the transform bbox while a transform drag is active', () => {
    const inactive = render(
      <svg>
        <RotoOverlay {...createMinimalProps(null)} />
      </svg>,
    );
    expect(inactive.container.querySelectorAll('rect').length).toBeGreaterThan(0);

    inactive.unmount();

    const active = render(
      <svg>
        <RotoOverlay {...createMinimalProps('move')} />
      </svg>,
    );
    expect(active.container.querySelectorAll('rect')).toHaveLength(0);
  });
});
