import { describe, it, expect } from 'vitest';
import { NodeType, type AnyNode } from '@blackboard/types';

import {
  isStackAdjustmentType,
  isExportAdjustmentType,
  isStackedExportAdjustmentNode,
  hasStackedFlag,
  isNodeStacked,
  participatesInPipeline,
  usesPipelineInput,
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
    expect(isStackAdjustmentType(NodeType.MEDIA_SOURCE)).toBe(false);
    expect(isStackAdjustmentType(NodeType.TEXT)).toBe(false);
    expect(isStackAdjustmentType(NodeType.MERGE)).toBe(false);
    expect(isStackAdjustmentType(NodeType.SCENE)).toBe(false);
    expect(isStackAdjustmentType(NodeType.EXTRACT_CHANNELS)).toBe(false);
    expect(isStackAdjustmentType(NodeType.MERGE_CHANNELS)).toBe(false);
    expect(isStackAdjustmentType(NodeType.NOTE)).toBe(false);
  });
});

describe('pipeline predicates', () => {
  it('keeps channel utilities out of primary pipe topology', () => {
    expect(usesPipelineInput(NodeType.EXTRACT_CHANNELS)).toBe(false);
    expect(usesPipelineInput(NodeType.MERGE_CHANNELS)).toBe(false);
    expect(participatesInPipeline(NodeType.EXTRACT_CHANNELS)).toBe(false);
    expect(participatesInPipeline(NodeType.MERGE_CHANNELS)).toBe(false);
    expect(usesPipelineInput(NodeType.NOTE)).toBe(false);
    expect(participatesInPipeline(NodeType.NOTE)).toBe(false);
  });

  it('keeps normal adjustment nodes in the primary pipeline', () => {
    expect(usesPipelineInput(NodeType.GRADE)).toBe(true);
    expect(participatesInPipeline(NodeType.GRADE)).toBe(true);
  });
});

describe('isExportAdjustmentType', () => {
  it('returns true for export adjustment types', () => {
    expect(isExportAdjustmentType(NodeType.GRADE)).toBe(true);
    expect(isExportAdjustmentType(NodeType.BLUR)).toBe(true);
    expect(isExportAdjustmentType(NodeType.KEYER)).toBe(true);
    expect(isExportAdjustmentType(NodeType.PAINT)).toBe(true);
    expect(isExportAdjustmentType(NodeType.ROTO)).toBe(true);
  });

  it('returns false for non-export stack-only types', () => {
    expect(isExportAdjustmentType(NodeType.WARP)).toBe(true);
    expect(isExportAdjustmentType(NodeType.NOTE)).toBe(false);
  });
});

describe('isStackedExportAdjustmentNode', () => {
  it('treats stacked roto as a pipeline adjustment', () => {
    expect(
      isStackedExportAdjustmentNode({
        id: 'roto',
        type: NodeType.ROTO,
        name: 'Roto',
        enabled: true,
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
        enabled: true,
        stacked: false,
      } as AnyNode),
    ).toBe(false);
  });
});

describe('hasStackedFlag', () => {
  it('returns true when node has stacked property', () => {
    const node = { id: '1', type: NodeType.GRADE, name: 'g', enabled: true, stacked: true };
    expect(hasStackedFlag(node as AnyNode)).toBe(true);
  });

  it('returns false when node has no stacked property', () => {
    const node = {
      id: '1',
      type: NodeType.MEDIA_SOURCE,
      name: 'i',
      enabled: true,
      mediaKind: 'image',
      src: '',
    };
    expect(hasStackedFlag(node as AnyNode)).toBe(false);
  });
});

describe('isNodeStacked', () => {
  it('treats a missing stacked property as unstacked', () => {
    const node = { id: '1', type: NodeType.GRADE, name: 'g', enabled: true } as AnyNode;
    expect(isNodeStacked(node)).toBe(false);
  });

  it('returns the stacked state when present', () => {
    const stackedNode = {
      id: '1',
      type: NodeType.GRADE,
      name: 'g',
      enabled: true,
      stacked: true,
    } as AnyNode;
    const unstackedNode = {
      id: '2',
      type: NodeType.GRADE,
      name: 'g2',
      enabled: true,
      stacked: false,
    } as AnyNode;

    expect(isNodeStacked(stackedNode)).toBe(true);
    expect(isNodeStacked(unstackedNode)).toBe(false);
  });
});
