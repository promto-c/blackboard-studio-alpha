import { describe, expect, it, vi } from 'vitest';
import { NodeType, type AnyNode } from '@blackboard/types';
import { buildFlowFromNodes, ROOT_FLOW_ID } from '@/state/editor/flowModel';
import { getInitialState } from '@/state/editor/initialState';
import { createNodeViewActions } from '@/state/editor/slices/nodeViewActions';

type TestState = ReturnType<typeof getInitialState> & { maxFrames: number };

const image = (id: string): AnyNode =>
  ({
    id,
    type: NodeType.MEDIA_SOURCE,
    name: id,
    enabled: true,
    mediaKind: 'image',
    src: '',
  }) as AnyNode;

describe('createNodeViewActions', () => {
  it('writes node positions to the active group flow', () => {
    const rootFlow = buildFlowFromNodes([image('root-node')], ROOT_FLOW_ID, 'Root Flow');
    const childFlow = buildFlowFromNodes([image('child-node')], 'flow-group-1', 'Group');
    let state: TestState = {
      ...getInitialState(),
      maxFrames: 0,
      flows: { [rootFlow.id]: rootFlow, [childFlow.id]: childFlow },
      rootFlowId: rootFlow.id,
      activeFlowId: childFlow.id,
      nodes: [image('child-node')],
      nodePositionsByFlow: {
        [rootFlow.id]: { 'root-node': { x: 10, y: 20 } },
        [childFlow.id]: { 'child-node': { x: 30, y: 40 } },
      },
    };
    const set = (fn: (prevState: TestState) => Partial<TestState> | TestState) => {
      state = { ...state, ...fn(state) };
    };
    const commitMutation = (_input: unknown) => {};
    const actions = createNodeViewActions(set as never, (() => state) as never, {
      commitMutation,
    });

    actions.setNodePosition('child-node', 100, 120);

    expect(state.nodePositionsByFlow[rootFlow.id]).toEqual({ 'root-node': { x: 10, y: 20 } });
    expect(state.nodePositionsByFlow[childFlow.id]).toEqual({
      'child-node': { x: 100, y: 120 },
    });
  });
});
