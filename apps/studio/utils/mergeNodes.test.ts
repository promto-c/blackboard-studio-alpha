import { describe, it, expect, vi } from 'vitest';

// Suppress Google GenAI import that effectRegistry pulls in transitively.
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(),
  Modality: {},
  Type: {},
}));

import { NodeType, type AnyNode } from '@blackboard/types';
import {
  buildMergeModel,
  getMergeNodeId,
  getMergeSourceNodeId,
  isMergeNodeId,
  resolveMergeSourceStack,
  MERGE_NODE_PREFIX,
} from '@/utils/mergeNodes';

// ---------------------------------------------------------------------------
// Minimal node factory
// ---------------------------------------------------------------------------

const img = (id: string): AnyNode =>
  ({ id, type: NodeType.IMAGE, name: id, visible: true }) as AnyNode;

const grade = (id: string): AnyNode =>
  ({ id, type: NodeType.GRADE, name: id, visible: true, stacked: true }) as AnyNode;

const merge = (id: string): AnyNode =>
  ({ id, type: NodeType.MERGE, name: id, visible: true }) as AnyNode;

// ---------------------------------------------------------------------------
// getMergeNodeId / getMergeSourceNodeId / isMergeNodeId
// ---------------------------------------------------------------------------

describe('getMergeNodeId', () => {
  it('prefixes the node id with the merge prefix', () => {
    expect(getMergeNodeId('abc')).toBe(`${MERGE_NODE_PREFIX}abc`);
  });
});

describe('getMergeSourceNodeId', () => {
  it('strips the merge prefix to recover the source node id', () => {
    expect(getMergeSourceNodeId(`${MERGE_NODE_PREFIX}abc`)).toBe('abc');
  });

  it('is the inverse of getMergeNodeId', () => {
    const original = 'my-node-id';
    expect(getMergeSourceNodeId(getMergeNodeId(original))).toBe(original);
  });
});

describe('isMergeNodeId', () => {
  it('returns true for a properly prefixed merge id', () => {
    expect(isMergeNodeId(getMergeNodeId('abc'))).toBe(true);
  });

  it('returns false for a plain node id', () => {
    expect(isMergeNodeId('abc')).toBe(false);
  });

  it('returns false for null and undefined', () => {
    expect(isMergeNodeId(null)).toBe(false);
    expect(isMergeNodeId(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildMergeModel
// ---------------------------------------------------------------------------

describe('buildMergeModel – single source stack', () => {
  it('produces no merge chain when there is only one source stack', () => {
    const stacks = [[img('i1')]];
    const model = buildMergeModel(stacks);
    expect(model.chain).toBeNull();
    expect(model.mergeNodes).toHaveLength(0);
  });

  it('marks the single source stack with sourceOrder 0 and isMergeSource false', () => {
    const stacks = [[img('i1')]];
    const model = buildMergeModel(stacks);
    const info = model.info.get('i1')!;
    expect(info.sourceOrder).toBe(0);
    expect(info.isMergeSource).toBe(false);
    expect(info.mergeId).toBeNull();
  });
});

describe('buildMergeModel – two source stacks', () => {
  it('creates a merge chain with the first stack as anchor', () => {
    const stacks = [[img('i1')], [img('i2')]];
    const model = buildMergeModel(stacks);
    expect(model.chain).not.toBeNull();
    expect(model.chain!.anchorStackId).toBe('i1');
    expect(model.chain!.sourceStackIds).toEqual(['i1', 'i2']);
  });

  it('marks the first source stack as non-merge-source and the second as merge source', () => {
    const stacks = [[img('i1')], [img('i2')]];
    const model = buildMergeModel(stacks);
    expect(model.info.get('i1')!.isMergeSource).toBe(false);
    expect(model.info.get('i2')!.isMergeSource).toBe(true);
  });

  it('creates a merge node entry for the second stack', () => {
    const stacks = [[img('i1')], [img('i2')]];
    const model = buildMergeModel(stacks);
    expect(model.mergeNodes).toHaveLength(1);
    const merge = model.mergeNodes[0];
    expect(merge.mergeId).toBe(getMergeNodeId('i2'));
    expect(merge.anchorStackId).toBe('i1');
    expect(merge.sourceOrder).toBe(1);
  });

  it('does not count detached source stacks as merge sources', () => {
    const detachedSource = { ...img('i2'), detachedFromPipe: true } as AnyNode;
    const stacks = [[img('i1')], [detachedSource], [img('i3')]];
    const model = buildMergeModel(stacks);

    expect(model.chain!.sourceStackIds).toEqual(['i1', 'i3']);
    expect(model.info.get('i2')!.isMergeSource).toBe(false);
    expect(model.info.get('i3')!.isMergeSource).toBe(true);
    expect(model.mergeNodes.map((entry) => entry.mergeId)).toEqual([getMergeNodeId('i3')]);
  });
});

describe('buildMergeModel – three source stacks', () => {
  it('creates merge nodes for second and third stacks', () => {
    const stacks = [[img('i1')], [img('i2')], [img('i3')]];
    const model = buildMergeModel(stacks);
    expect(model.mergeNodes).toHaveLength(2);
    expect(model.mergeNodes.map((m) => m.sourceOrder)).toEqual([1, 2]);
  });
});

describe('buildMergeModel – stacks with adjustments', () => {
  it('uses the base (first) node of each stack as the stack id', () => {
    const stacks = [[img('i1'), grade('g1')], [img('i2')]];
    const model = buildMergeModel(stacks);
    expect(model.info.has('i1')).toBe(true);
    expect(model.info.has('i2')).toBe(true);
    // grade node is not an independent stack entry
    expect(model.info.has('g1')).toBe(false);
  });
});

describe('buildMergeModel – non-source stacks (e.g. grade-only stacks)', () => {
  it('does not count non-source stacks as merge sources', () => {
    // A grade node with stacked:false acts as a standalone (non-source) stack
    const gradeNode = {
      id: 'g_standalone',
      type: NodeType.GRADE,
      name: 'G',
      visible: true,
    } as AnyNode;
    const stacks = [[img('i1')], [gradeNode]];
    const model = buildMergeModel(stacks);
    // Only one source stack → no chain
    expect(model.chain).toBeNull();
    const gradeInfo = model.info.get('g_standalone')!;
    expect(gradeInfo.isMergeSource).toBe(false);
  });

  it('does not count real merge nodes as source stacks', () => {
    const stacks = [[img('i1')], [merge('m1')], [img('i2')]];
    const model = buildMergeModel(stacks);

    expect(model.chain!.sourceStackIds).toEqual(['i1', 'i2']);
    expect(model.info.get('m1')!.isMergeSource).toBe(false);
    expect(model.info.get('i2')!.isMergeSource).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveMergeSourceStack
// ---------------------------------------------------------------------------

describe('resolveMergeSourceStack', () => {
  it('returns the correct source stack for a valid merge id', () => {
    const stacks = [[img('i1')], [img('i2')]];
    const result = resolveMergeSourceStack(getMergeNodeId('i2'), stacks);
    expect(result).not.toBeNull();
    expect(result![0].id).toBe('i2');
  });

  it('returns null for a non-merge-source stack id', () => {
    const stacks = [[img('i1')], [img('i2')]];
    // i1 is the anchor (sourceOrder 0, isMergeSource false)
    expect(resolveMergeSourceStack(getMergeNodeId('i1'), stacks)).toBeNull();
  });

  it('returns null for an unknown node id', () => {
    const stacks = [[img('i1')]];
    expect(resolveMergeSourceStack(getMergeNodeId('unknown'), stacks)).toBeNull();
  });
});
