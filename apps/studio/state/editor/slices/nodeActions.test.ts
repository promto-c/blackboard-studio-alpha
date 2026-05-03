import { describe, expect, it, vi } from 'vitest';
import { NodeType } from '@blackboard/types';
import type { AnyNode } from '@blackboard/types';
import { createNodeActions } from '@/state/editor/slices/nodeActions';

type TestState = {
  nodes: AnyNode[];
  currentFrame: number;
  selectedNodeId: string | null;
};

const createHarness = (node: AnyNode, currentFrame = 24) => {
  let state: TestState = {
    nodes: [node],
    currentFrame,
    selectedNodeId: node.id,
  };

  const set = (fn: (prevState: TestState) => Partial<TestState> | TestState) => {
    state = { ...state, ...fn(state) };
  };
  const get = () => state;
  const pushHistory = vi.fn();
  const actions = createNodeActions(set as never, get as never, {
    pushHistory,
    debouncedSave: vi.fn(),
  });

  return {
    actions,
    pushHistory,
  };
};

describe('createNodeActions history frame targeting', () => {
  it('pushes the affected target frame when setting a keyframe off the playhead', () => {
    const node = {
      id: 'node-1',
      type: NodeType.GRADE,
      name: 'Grade 1',
      visible: true,
      opacity: 0.5,
    } as unknown as AnyNode;
    const { actions, pushHistory } = createHarness(node, 12);

    actions.setKeyframe(node.id, 'opacity', 0.75, true, 48, true);

    expect(pushHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Set Keyframe',
        state: expect.objectContaining({
          currentFrame: 48,
          selectedNodeId: node.id,
        }),
      }),
    );
  });

  it('pushes the moved keyframe frame when updating a keyframe position', () => {
    const node = {
      id: 'node-1',
      type: NodeType.GRADE,
      name: 'Grade 1',
      visible: true,
      opacity: [{ frame: 12, value: 0.5 }],
    } as unknown as AnyNode;
    const { actions, pushHistory } = createHarness(node, 12);

    actions.updateKeyframe(node.id, 'opacity', 12, { frame: 36 }, true);

    expect(pushHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Update Keyframe',
        state: expect.objectContaining({
          currentFrame: 36,
          selectedNodeId: node.id,
        }),
      }),
    );
  });
});
