// @vitest-environment jsdom

import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NodeType, type RotoNode } from '@blackboard/types';
import type { RotoTransformSelection } from '@/features/viewport/viewportOverlayTypes';
import RotoOverlay from './RotoOverlay';

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

const createTransformSelection = (): RotoTransformSelection => ({
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
});

const createProps = (activeTransformHandle: string | null = null) =>
  ({
    node: createRotoNode(),
    frame: 0,
    zoom: 1,
    selectedRotoPathIds: [],
    selectedRotoPointRefs: [],
    setSelectedRotoPathIds: vi.fn(),
    isRotoSelectActive: true,
    activeViewportTool: 'select',
    altPressed: false,
    nudge: {
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
    rotoTransformSelection: createTransformSelection(),
    transformIsDegenerate: false,
    transformMoveHandleRadius: 7,
    transformRotateHitRadius: 14,
    transformHandleSize: 8,
    transformHandleHitSize: 16,
    transformHandlePositions: [],
    transformRotateHandlePoint: null,
    transformInteractionLabel: null,
    activeTransformHandle,
    hoveredTransformHandle: null,
    affineModifierPressed: false,
    isMoveTransformActive: activeTransformHandle === 'move',
    isMoveTransformHovered: false,
    isRotateTransformActive: activeTransformHandle === 'rotate',
    isRotateTransformHovered: false,
    beginRotoTransformDrag: vi.fn(),
    setHoveredTransformHandle: vi.fn(),
    hoveredRotoPathId: null,
    setHoveredRotoPathId: vi.fn(),
    dragPointState: null,
    hoveredPointInfo: null,
    handlePointMouseDown: vi.fn(),
    beginPointWeightDrag: vi.fn(),
    setSelectedPointWeightMode: vi.fn(),
    setSelectedPointType: vi.fn(),
    setHoveredPointInfo: vi.fn(),
    pointWeightDragState: null,
    pointWeightControlState: null,
    rotoPointWeightMode: 'global',
    temporalController: null,
    onTemporalControllerChange: vi.fn(),
    onTemporalControllerCommit: vi.fn(),
    motionCueTargetPathIdSet: new Set<string>(),
    rotoMotionCueEnabled: false,
    rotoMotionCueMode: 'gradient_trail',
    gradientTrailsByPath: new Map(),
    speedHeatSegmentsByPath: new Map(),
    motionBlurCuePathsByPath: new Map(),
    hoveredSegment: null,
    rotoRefinement: null,
    refinementSimplifiedPoints: [],
    isDrawing: false,
    drawingRotoPath: null,
    bsplineDrawingState: null,
    drawingState: null,
    freehandPoints: null,
    isHoveringClosePoint: false,
    marqueeState: null,
    activeTrackingPoints: null,
    stabilizationMatrix: null,
  }) as any;

describe('RotoOverlay transform selection', () => {
  it('hides the transform bbox while a transform drag is active', () => {
    const inactive = render(
      <svg>
        <RotoOverlay {...createProps(null)} />
      </svg>,
    );
    expect(inactive.container.querySelectorAll('rect').length).toBeGreaterThan(0);

    inactive.unmount();

    const active = render(
      <svg>
        <RotoOverlay {...createProps('move')} />
      </svg>,
    );
    expect(active.container.querySelectorAll('rect')).toHaveLength(0);
  });
});
