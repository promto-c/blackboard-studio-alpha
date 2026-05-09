import { describe, it, expect, vi } from 'vitest';
import { NodeType, type AnyNode } from '@blackboard/types';

// Mock the Google GenAI module to prevent API key errors during import of
// effectRegistry (which transitively pulls in ai.ts via editorContext).
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(),
  Modality: {},
  Type: {},
}));

import {
  isStackAdjustmentType,
  isExportAdjustmentType,
  isStackedExportAdjustmentNode,
  hasStackedFlag,
  isNodeStacked,
  isLoopingTimelineNode,
} from '@/utils/nodePredicates';

describe('isStackAdjustmentType', () => {
  it('returns true for adjustment node types', () => {
    expect(isStackAdjustmentType(NodeType.GRADE)).toBe(true);
    expect(isStackAdjustmentType(NodeType.BLUR)).toBe(true);
    expect(isStackAdjustmentType(NodeType.CUSTOM_SHADER)).toBe(true);
    expect(isStackAdjustmentType(NodeType.ROTO)).toBe(true);
    expect(isStackAdjustmentType(NodeType.PAINT)).toBe(true);
    expect(isStackAdjustmentType(NodeType.WARP)).toBe(true);
  });

  it('returns false for non-adjustment node types', () => {
    expect(isStackAdjustmentType(NodeType.IMAGE)).toBe(false);
    expect(isStackAdjustmentType(NodeType.VIDEO)).toBe(false);
    expect(isStackAdjustmentType(NodeType.TEXT)).toBe(false);
    expect(isStackAdjustmentType(NodeType.MERGE)).toBe(false);
    expect(isStackAdjustmentType(NodeType.SCENE)).toBe(false);
  });
});

describe('isExportAdjustmentType', () => {
  it('returns true for export adjustment types', () => {
    expect(isExportAdjustmentType(NodeType.GRADE)).toBe(true);
    expect(isExportAdjustmentType(NodeType.BLUR)).toBe(true);
    expect(isExportAdjustmentType(NodeType.CHROMA_KEY)).toBe(true);
    expect(isExportAdjustmentType(NodeType.PAINT)).toBe(true);
    expect(isExportAdjustmentType(NodeType.ROTO)).toBe(true);
  });

  it('returns false for non-export stack-only types', () => {
    expect(isExportAdjustmentType(NodeType.WARP)).toBe(false);
  });
});

describe('isStackedExportAdjustmentNode', () => {
  it('treats stacked roto as a pipeline adjustment', () => {
    expect(
      isStackedExportAdjustmentNode({
        id: 'roto',
        type: NodeType.ROTO,
        name: 'Roto',
        visible: true,
        stacked: true,
      } as AnyNode),
    ).toBe(true);
  });

  it('treats unstacked roto as a global export adjustment', () => {
    expect(
      isStackedExportAdjustmentNode({
        id: 'roto',
        type: NodeType.ROTO,
        name: 'Roto',
        visible: true,
        stacked: false,
      } as AnyNode),
    ).toBe(false);
  });
});

describe('hasStackedFlag', () => {
  it('returns true when node has stacked property', () => {
    const node = { id: '1', type: NodeType.GRADE, name: 'g', visible: true, stacked: true };
    expect(hasStackedFlag(node as any)).toBe(true);
  });

  it('returns false when node has no stacked property', () => {
    const node = { id: '1', type: NodeType.IMAGE, name: 'i', visible: true };
    expect(hasStackedFlag(node as any)).toBe(false);
  });
});

describe('isNodeStacked', () => {
  it('treats a missing stacked property as unstacked', () => {
    const node = { id: '1', type: NodeType.GRADE, name: 'g', visible: true } as AnyNode;
    expect(isNodeStacked(node)).toBe(false);
  });

  it('returns the stacked state when present', () => {
    const stackedNode = {
      id: '1',
      type: NodeType.GRADE,
      name: 'g',
      visible: true,
      stacked: true,
    } as AnyNode;
    const unstackedNode = {
      id: '2',
      type: NodeType.GRADE,
      name: 'g2',
      visible: true,
      stacked: false,
    } as AnyNode;

    expect(isNodeStacked(stackedNode)).toBe(true);
    expect(isNodeStacked(unstackedNode)).toBe(false);
  });
});

describe('isLoopingTimelineNode', () => {
  it('returns true for video with loop', () => {
    const node = { id: '1', type: NodeType.VIDEO, name: 'v', visible: true, loop: true };
    expect(isLoopingTimelineNode(node as any)).toBe(true);
  });

  it('returns false for video without loop', () => {
    const node = { id: '1', type: NodeType.VIDEO, name: 'v', visible: true, loop: false };
    expect(isLoopingTimelineNode(node as any)).toBe(false);
  });

  it('returns false for non-video/sequence types', () => {
    const node = { id: '1', type: NodeType.IMAGE, name: 'i', visible: true };
    expect(isLoopingTimelineNode(node as any)).toBe(false);
  });
});
