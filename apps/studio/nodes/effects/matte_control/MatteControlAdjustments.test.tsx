// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeType, type MatteControlNode } from '@blackboard/types';
import { MatteControlAdjustments } from './MatteControlAdjustments';
import { createDefaultMatteControlSettings } from './matteControlModel';

const actions = vi.hoisted(() => ({
  setKeyframe: vi.fn(),
  updateNode: vi.fn(),
}));

vi.mock('@/state/editorContext', () => ({
  useEditorSelector: (selector: (state: { currentFrame: number }) => unknown) =>
    selector({ currentFrame: 10 }),
  useEditorActions: () => actions,
}));

const createNode = (): MatteControlNode => ({
  id: 'matte-control',
  type: NodeType.MATTE_CONTROL,
  name: 'Matte Control',
  enabled: true,
  matteControl: createDefaultMatteControlSettings(),
});

describe('MatteControlAdjustments', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exposes the complete matte-finesse control surface', () => {
    render(<MatteControlAdjustments node={createNode()} />);

    expect(screen.queryByText(/optional Matte input/)).toBeNull();
    expect(screen.queryByText('Matte Combination')).toBeNull();
    expect(screen.getByRole('slider', { name: 'Erode / Dilate' })).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Edge Blur' })).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Clamp low' })).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Clamp high' })).toBeTruthy();

    fireEvent.click(screen.getByRole('switch', { name: 'Invert Matte' }));
    expect(actions.updateNode).toHaveBeenCalledWith(
      'matte-control',
      expect.objectContaining({
        matteControl: expect.objectContaining({ invert: true }),
      }),
      true,
    );
  });
});
