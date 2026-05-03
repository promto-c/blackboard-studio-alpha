import { describe, expect, it } from 'vitest';
import {
  AnyNode,
  BlendMode,
  ImageFitMode,
  NodeType,
  ViewerSlotAssignments,
} from '@blackboard/types';
import { OUTPUT_NODE_ID } from '@/state/editor/flowModel';
import { getMergeNodeId } from '@/utils/mergeNodes';
import {
  assignViewerSlotToNode,
  getViewerRenderNodes,
  getViewerTargetLabel,
  sanitizeActiveViewerSlot,
  sanitizeViewerNodeId,
  sanitizeViewerSlots,
} from '@/utils/viewerSlots';

const SCENE_NODE: AnyNode = {
  id: 'scene',
  type: NodeType.SCENE,
  name: 'Scene',
  visible: true,
  width: 1920,
  height: 1080,
  bitDepth: 16,
  colorSpace: 'Linear',
  maxFrames: 0,
  fps: 30,
};

const IMAGE_A: AnyNode = {
  id: 'img_a',
  type: NodeType.IMAGE,
  name: 'Image A',
  visible: true,
  src: 'a',
  width: 1920,
  height: 1080,
  opacity: 100,
  operator: BlendMode.OVER,
  colorSpace: 'sRGB',
  transform: { x: 0, y: 0, scale: 1, fitMode: ImageFitMode.NONE },
};

const IMAGE_B: AnyNode = {
  id: 'img_b',
  type: NodeType.IMAGE,
  name: 'Image B',
  visible: true,
  src: 'b',
  width: 1920,
  height: 1080,
  opacity: 100,
  operator: BlendMode.OVER,
  colorSpace: 'sRGB',
  transform: { x: 0, y: 0, scale: 1, fitMode: ImageFitMode.NONE },
};

const IMAGE_C: AnyNode = {
  id: 'img_c',
  type: NodeType.IMAGE,
  name: 'Image C',
  visible: true,
  src: 'c',
  width: 1920,
  height: 1080,
  opacity: 100,
  operator: BlendMode.OVER,
  colorSpace: 'sRGB',
  transform: { x: 0, y: 0, scale: 1, fitMode: ImageFitMode.NONE },
};

const GRADE_B: AnyNode = {
  id: 'grade_b',
  type: NodeType.GRADE,
  name: 'Grade B',
  visible: true,
  stacked: true,
  grade: {
    brightness: 0,
    contrast: 1,
    saturation: 1,
    gain: 1,
    gamma: 1,
  },
};

const NODES = [SCENE_NODE, IMAGE_A, IMAGE_B, GRADE_B, IMAGE_C];

describe('viewerSlots utils', () => {
  it('returns full node list when no viewer node is set', () => {
    expect(getViewerRenderNodes(NODES, null)).toEqual(NODES);
  });

  it('returns full node list when viewer node cannot be found', () => {
    expect(getViewerRenderNodes(NODES, 'missing')).toEqual(NODES);
  });

  it('truncates nodes at the active viewer node', () => {
    expect(getViewerRenderNodes(NODES, 'img_a')).toEqual([SCENE_NODE, IMAGE_A]);
  });

  it('treats output viewer target as full node list', () => {
    expect(getViewerRenderNodes(NODES, OUTPUT_NODE_ID)).toEqual(NODES);
  });

  it('resolves merge viewer target to the merge source position', () => {
    expect(getViewerRenderNodes(NODES, getMergeNodeId('img_b'))).toEqual([
      SCENE_NODE,
      IMAGE_A,
      IMAGE_B,
      GRADE_B,
    ]);
  });

  it('sanitizes slot assignments for missing nodes', () => {
    const slots: ViewerSlotAssignments = { 1: 'img_a', 2: 'missing', 3: 'img_b' };
    expect(sanitizeViewerSlots(slots, NODES)).toEqual({ 1: 'img_a', 3: 'img_b' });
  });

  it('keeps output and valid merge targets while dropping invalid merge targets', () => {
    const slots: ViewerSlotAssignments = {
      1: OUTPUT_NODE_ID,
      2: getMergeNodeId('img_b'),
      3: getMergeNodeId('img_a'),
    };
    expect(sanitizeViewerSlots(slots, NODES)).toEqual({
      1: OUTPUT_NODE_ID,
      2: getMergeNodeId('img_b'),
    });
  });

  it('keeps only one slot per node when sanitizing duplicates', () => {
    const slots: ViewerSlotAssignments = { 1: 'img_a', 2: 'img_a', 3: 'img_b' };
    expect(sanitizeViewerSlots(slots, NODES)).toEqual({ 1: 'img_a', 3: 'img_b' });
  });

  it('reassigns a node to a new slot by removing its old slot', () => {
    const slots: ViewerSlotAssignments = { 1: 'img_a', 2: 'img_b' };
    expect(assignViewerSlotToNode(slots, 4, 'img_a')).toEqual({ 2: 'img_b', 4: 'img_a' });
  });

  it('clears invalid active slot and invalid viewer node', () => {
    const slots: ViewerSlotAssignments = { 1: 'img_a' };
    const viewerNodeId = sanitizeViewerNodeId('img_b', NODES);
    const activeViewerSlot = sanitizeActiveViewerSlot(1, slots, viewerNodeId);
    expect(viewerNodeId).toBe('img_b');
    expect(activeViewerSlot).toBeNull();
  });

  it('accepts output and valid merge as viewer node targets', () => {
    expect(sanitizeViewerNodeId(OUTPUT_NODE_ID, NODES)).toBe(OUTPUT_NODE_ID);
    expect(sanitizeViewerNodeId(getMergeNodeId('img_b'), NODES)).toBe(getMergeNodeId('img_b'));
    expect(sanitizeViewerNodeId(getMergeNodeId('img_a'), NODES)).toBeNull();
  });

  it('formats labels for output and merge viewer targets', () => {
    expect(getViewerTargetLabel(null, NODES)).toBe('Output');
    expect(getViewerTargetLabel(OUTPUT_NODE_ID, NODES)).toBe('Output');
    expect(getViewerTargetLabel(getMergeNodeId('img_b'), NODES)).toBe('Merge (Image B)');
  });
});
