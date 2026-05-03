import { describe, it, expect, vi } from 'vitest';

// Suppress Google GenAI import that effectRegistry pulls in transitively.
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(),
  Modality: {},
  Type: {},
}));

import { NodeType, type AnyNode } from '@blackboard/types';
import { buildNodeStacks } from '@/utils/nodeStacks';

// ---------------------------------------------------------------------------
// Minimal node factories – only the fields that matter for stack logic.
// ---------------------------------------------------------------------------

const img = (id: string): AnyNode =>
  ({ id, type: NodeType.IMAGE, name: id, visible: true }) as AnyNode;

const grade = (id: string, stacked = true): AnyNode =>
  ({ id, type: NodeType.GRADE, name: id, visible: true, stacked }) as AnyNode;

const blur = (id: string, stacked = true): AnyNode =>
  ({ id, type: NodeType.BLUR, name: id, visible: true, stacked }) as AnyNode;

const scene = (id: string): AnyNode =>
  ({ id, type: NodeType.SCENE, name: id, visible: true }) as AnyNode;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildNodeStacks', () => {
  it('returns an empty array for an empty node list', () => {
    expect(buildNodeStacks([])).toEqual([]);
  });

  it('returns an empty array when only a scene node is present', () => {
    expect(buildNodeStacks([scene('s1')])).toEqual([]);
  });

  it('groups a single image node into a single stack', () => {
    const stacks = buildNodeStacks([img('i1')]);
    expect(stacks).toHaveLength(1);
    expect(stacks[0]).toHaveLength(1);
    expect(stacks[0][0].id).toBe('i1');
  });

  it('groups a stacked adjustment node into the preceding image stack', () => {
    const stacks = buildNodeStacks([img('i1'), grade('g1')]);
    expect(stacks).toHaveLength(1);
    expect(stacks[0].map((n) => n.id)).toEqual(['i1', 'g1']);
  });

  it('groups multiple stacked adjustments into the same stack', () => {
    const stacks = buildNodeStacks([img('i1'), grade('g1'), blur('b1')]);
    expect(stacks).toHaveLength(1);
    expect(stacks[0].map((n) => n.id)).toEqual(['i1', 'g1', 'b1']);
  });

  it('creates a new stack for each unstacked source node', () => {
    const stacks = buildNodeStacks([img('i1'), img('i2')]);
    expect(stacks).toHaveLength(2);
    expect(stacks[0][0].id).toBe('i1');
    expect(stacks[1][0].id).toBe('i2');
  });

  it('terminates a stack when an unstacked source node follows adjustments', () => {
    const stacks = buildNodeStacks([img('i1'), grade('g1'), img('i2')]);
    expect(stacks).toHaveLength(2);
    expect(stacks[0].map((n) => n.id)).toEqual(['i1', 'g1']);
    expect(stacks[1].map((n) => n.id)).toEqual(['i2']);
  });

  it('excludes scene nodes from all stacks', () => {
    const stacks = buildNodeStacks([scene('s1'), img('i1'), scene('s2')]);
    expect(stacks).toHaveLength(1);
    expect(stacks[0][0].id).toBe('i1');
  });

  it('does not merge an unstacked grade into the preceding stack', () => {
    const stacks = buildNodeStacks([img('i1'), grade('g_unstacked', false)]);
    expect(stacks).toHaveLength(2);
    expect(stacks[0].map((n) => n.id)).toEqual(['i1']);
    expect(stacks[1].map((n) => n.id)).toEqual(['g_unstacked']);
  });
});
