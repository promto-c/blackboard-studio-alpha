import { describe, expect, it } from 'vitest';
import { NodeType, type AnyNode } from '@blackboard/types';
import { resolveVisibleGraphNodeId } from './nodeViewState';

describe('node view state', () => {
  it('maps a selected stack child to the card that owns its external ports', () => {
    const base = { id: 'plate', type: NodeType.MEDIA_SOURCE } as AnyNode;
    const child = { id: 'grade', type: NodeType.GRADE } as AnyNode;

    expect(resolveVisibleGraphNodeId(child.id, [[base, child]])).toBe(base.id);
    expect(resolveVisibleGraphNodeId('output', [[base, child]])).toBe('output');
  });
});
