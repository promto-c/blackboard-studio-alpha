import { describe, expect, it } from 'vitest';
import { NodeType, type AnyNode } from '@blackboard/types';
import {
  isNodeStacked,
  isStackableNode,
  participatesInPipeline,
  usesPipelineInput,
} from '@/utils/nodePredicates';

const node = (type: string, props: Record<string, unknown> = {}): AnyNode =>
  ({ id: type, type, name: type, enabled: true, ...props }) as AnyNode;

describe('isStackableNode', () => {
  it('allows every unary node, independent of renderer category', () => {
    expect(isStackableNode(node(NodeType.GRADE))).toBe(true);
    expect(isStackableNode(node(NodeType.PREMULTIPLY))).toBe(true);
    expect(isStackableNode(node(NodeType.UNPREMULTIPLY))).toBe(true);
    expect(isStackableNode(node(NodeType.EXTRACT_CHANNELS))).toBe(true);
  });

  it('rejects nodes with zero or multiple effective inputs', () => {
    expect(isStackableNode(node(NodeType.MEDIA_SOURCE))).toBe(false);
    expect(isStackableNode(node(NodeType.NOTE))).toBe(false);
    expect(isStackableNode(node(NodeType.MERGE))).toBe(false);
    expect(isStackableNode(node(NodeType.BOKEH_BLUR))).toBe(false);
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
    expect(usesPipelineInput(NodeType.PREMULTIPLY)).toBe(true);
    expect(participatesInPipeline(NodeType.PREMULTIPLY)).toBe(true);
    expect(usesPipelineInput(NodeType.UNPREMULTIPLY)).toBe(true);
    expect(participatesInPipeline(NodeType.UNPREMULTIPLY)).toBe(true);
  });
});

describe('isNodeStacked', () => {
  it('treats presentation metadata as a strict transient boolean', () => {
    expect(isNodeStacked(node(NodeType.GRADE))).toBe(false);
    expect(isNodeStacked(node(NodeType.GRADE, { stacked: true }))).toBe(true);
    expect(isNodeStacked(node(NodeType.GRADE, { stacked: false }))).toBe(false);
  });
});
