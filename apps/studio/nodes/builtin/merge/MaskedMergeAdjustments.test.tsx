// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlphaMergeOperation, NodeType, type MaskedMergeNode } from '@blackboard/types';
import { MaskedMergeAdjustments } from './MaskedMergeAdjustments';

const actions = vi.hoisted(() => ({
  setKeyframe: vi.fn(),
  updateNode: vi.fn(),
}));

vi.mock('@/state/editorContext', () => ({
  useEditorSelector: (selector: (state: { currentFrame: number }) => unknown) =>
    selector({ currentFrame: 10 }),
  useEditorActions: () => actions,
}));

const node: MaskedMergeNode = {
  id: 'masked-merge',
  type: NodeType.MASKED_MERGE,
  name: 'Masked Merge',
  enabled: true,
  mix: 100,
  alphaOperation: AlphaMergeOperation.REPLACE,
};

describe('MaskedMergeAdjustments', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exposes alpha-only operations with a full default mix', () => {
    render(<MaskedMergeAdjustments node={node} />);

    const mix = screen.getByRole('slider', { name: 'Mix' });
    expect(mix.getAttribute('value')).toBe('100');
    expect(screen.getByText(/RGB always comes from the RGBA input/)).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(screen.getByRole('radio', { name: 'Replace' }).getAttribute('aria-checked')).toBe(
      'true',
    );

    fireEvent.input(mix, { target: { value: '45' } });
    expect(actions.setKeyframe).toHaveBeenCalledWith(node.id, 'mix', 45, true);

    fireEvent.click(screen.getByRole('radio', { name: 'Intersect' }));
    expect(actions.updateNode).toHaveBeenCalledWith(
      node.id,
      { alphaOperation: AlphaMergeOperation.INTERSECT },
      true,
    );
  });

  it('uses and persists canonical defaults when stale node data has no alpha props', () => {
    const staleNode = {
      id: node.id,
      type: node.type,
      name: node.name,
      enabled: true,
    } as MaskedMergeNode;
    render(<MaskedMergeAdjustments node={staleNode} />);

    const mix = screen.getByRole('slider', { name: 'Mix' });
    expect(mix.getAttribute('value')).toBe('100');
    expect(screen.getByRole('radio', { name: 'Replace' }).getAttribute('aria-checked')).toBe(
      'true',
    );

    fireEvent.input(mix, { target: { value: '60' } });
    expect(actions.updateNode).toHaveBeenCalledWith(node.id, { mix: 60 }, true);
  });
});
