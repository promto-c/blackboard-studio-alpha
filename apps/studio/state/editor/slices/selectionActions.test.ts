import { describe, expect, it } from 'vitest';
import { NodeType, type AnyNode } from '@blackboard/types';
import {
  buildFlowFromNodes,
  createOutputNode,
  OUTPUT_NODE_ID,
  ROOT_FLOW_ID,
} from '@/state/editor/flowModel';
import { createSelectionActions } from '@/state/editor/slices/selectionActions';

type TestState = {
  flows: Record<string, ReturnType<typeof buildFlowFromNodes>>;
  rootFlowId: string | null;
  activeFlowId: string | null;
  selectedNodeId: string | null;
  selectedNodeIds: string[];
};

const image = (id: string): AnyNode =>
  ({
    id,
    type: NodeType.MEDIA_SOURCE,
    name: id,
    enabled: true,
    mediaKind: 'image',
    src: '',
  }) as AnyNode;

const createHarness = (state: TestState) => {
  let currentState = state;
  const set = (fn: (prevState: TestState) => Partial<TestState> | TestState) => {
    currentState = { ...currentState, ...fn(currentState) };
  };
  const get = () => currentState;
  const actions = createSelectionActions(set as never, get as never);

  return {
    actions,
    getState: () => currentState,
  };
};

describe('createSelectionActions', () => {
  it('allows the active group output node in multi-selection', () => {
    const rootFlow = buildFlowFromNodes([image('root-image')], ROOT_FLOW_ID, 'Root Flow');
    const groupFlow = buildFlowFromNodes(
      [image('group-image'), createOutputNode()],
      'flow-group-1',
      'Group',
    );
    const { actions, getState } = createHarness({
      flows: {
        [ROOT_FLOW_ID]: rootFlow,
        [groupFlow.id]: groupFlow,
      },
      rootFlowId: ROOT_FLOW_ID,
      activeFlowId: groupFlow.id,
      selectedNodeId: null,
      selectedNodeIds: [],
    });

    actions.selectNodes(['group-image', OUTPUT_NODE_ID]);

    expect(getState().selectedNodeIds).toEqual(['group-image', OUTPUT_NODE_ID]);
  });

  it('drops output from multi-selection when the active flow has no output node', () => {
    const flowWithoutOutput = {
      id: 'flow-empty',
      name: 'Empty',
      nodes: [image('group-image')],
      edges: [],
      stacks: [],
      outputNodeId: OUTPUT_NODE_ID,
    };
    const { actions, getState } = createHarness({
      flows: {
        [flowWithoutOutput.id]: flowWithoutOutput,
      },
      rootFlowId: ROOT_FLOW_ID,
      activeFlowId: flowWithoutOutput.id,
      selectedNodeId: null,
      selectedNodeIds: [],
    });

    actions.selectNodes(['group-image', OUTPUT_NODE_ID]);

    expect(getState().selectedNodeIds).toEqual(['group-image']);
  });
});
