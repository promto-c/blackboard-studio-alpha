import { describe, expect, it } from 'vitest';
import { NodeKind, NodeType, type AnyNode, type Flow } from '@blackboard/types';
import {
  buildFlowFromNodes,
  createOutputNode,
  getOrderedNodesFromFlow,
  ROOT_FLOW_ID,
} from '@/state/editor/flowModel';
import { expandGroupNodesForRender } from './groupRenderProjection';

const scene = (): AnyNode =>
  ({
    id: 'scene-1',
    kind: NodeKind.SCENE,
    type: NodeType.SCENE,
    name: 'Scene',
    enabled: true,
  }) as AnyNode;

const image = (id: string): AnyNode =>
  ({
    id,
    kind: NodeKind.EFFECT,
    type: NodeType.MEDIA_SOURCE,
    name: id,
    enabled: true,
    mediaKind: 'image',
    src: '',
  }) as AnyNode;

const blur = (id: string, inputs: Record<string, string> = {}): AnyNode =>
  ({
    id,
    kind: NodeKind.EFFECT,
    type: NodeType.BLUR,
    name: id,
    enabled: true,
    inputs,
  }) as AnyNode;

const grade = (id: string, inputs: Record<string, string> = {}): AnyNode =>
  ({
    id,
    kind: NodeKind.EFFECT,
    type: NodeType.GRADE,
    name: id,
    enabled: true,
    inputs,
  }) as AnyNode;

describe('expandGroupNodesForRender', () => {
  it('expands group children and rewires external input proxies to parent sources', () => {
    const entryNodeId = 'input_mask_in';
    const groupNode = {
      id: 'group-1',
      kind: NodeKind.GROUP,
      type: NodeType.GROUP,
      name: 'Blur Group',
      enabled: true,
      childFlowId: 'child-flow',
      outputNodeId: 'blur-1',
      externalInputs: [
        {
          id: 'mask_in',
          label: 'Mask',
          entryNodeId,
          targetNodeId: 'blur-1',
          targetPort: 'mask',
        },
      ],
      inputs: { mask_in: 'source' },
    } as AnyNode;
    const entryNode = {
      id: entryNodeId,
      kind: NodeKind.INPUT,
      type: NodeType.INPUT,
      name: 'Mask',
      enabled: true,
      groupNodeId: 'group-1',
      externalInputId: 'mask_in',
    } as AnyNode;
    const rootFlow = buildFlowFromNodes(
      [scene(), image('source'), groupNode, grade('grade-1', { matte: 'group-1' })],
      ROOT_FLOW_ID,
      'Root Flow',
    );
    const childFlow: Flow = {
      ...buildFlowFromNodes([entryNode, blur('blur-1', { mask: entryNodeId })], 'child-flow'),
      nodes: [entryNode, blur('blur-1'), createOutputNode()],
    };
    const flows = {
      [rootFlow.id]: rootFlow,
      [childFlow.id]: childFlow,
    };

    const projected = expandGroupNodesForRender(getOrderedNodesFromFlow(rootFlow), flows);

    expect(projected.map((node) => node.id)).toEqual(['scene-1', 'source', 'blur-1', 'grade-1']);
    expect(projected.find((node) => node.id === 'blur-1')?.inputs).toEqual({ mask: 'source' });
    expect(projected.find((node) => node.id === 'grade-1')?.inputs).toEqual({ matte: 'blur-1' });
  });

  it('keeps standalone input nodes so the node type can be reused outside groups', () => {
    const standaloneInput = {
      id: 'input-root',
      kind: NodeKind.INPUT,
      type: NodeType.INPUT,
      name: 'Input',
      enabled: true,
    } as AnyNode;

    const projected = expandGroupNodesForRender([scene(), standaloneInput, blur('blur-1')], {});

    expect(projected.map((node) => node.id)).toEqual(['scene-1', 'input-root', 'blur-1']);
  });

  it('resolves entry input nodes when rendering from inside a child flow', () => {
    const entryNodeId = 'input_mask_in';
    const groupNode = {
      id: 'group-1',
      kind: NodeKind.GROUP,
      type: NodeType.GROUP,
      name: 'Blur Group',
      enabled: true,
      childFlowId: 'child-flow',
      outputNodeId: 'blur-1',
      externalInputs: [
        {
          id: 'mask_in',
          label: 'Mask',
          entryNodeId,
          targetNodeId: 'blur-1',
          targetPort: 'mask',
        },
      ],
      inputs: { mask_in: 'source' },
    } as AnyNode;
    const entryNode = {
      id: entryNodeId,
      kind: NodeKind.INPUT,
      type: NodeType.INPUT,
      name: 'Mask',
      enabled: true,
      groupNodeId: 'group-1',
      externalInputId: 'mask_in',
    } as AnyNode;
    const rootFlow = buildFlowFromNodes([scene(), image('source'), groupNode], ROOT_FLOW_ID);
    const childFlow = buildFlowFromNodes(
      [entryNode, blur('blur-1', { mask: entryNodeId })],
      'child-flow',
    );
    const flows = {
      [rootFlow.id]: rootFlow,
      [childFlow.id]: childFlow,
    };

    const projected = expandGroupNodesForRender(getOrderedNodesFromFlow(childFlow), flows);

    expect(projected.map((node) => node.id)).toEqual(['scene-1', 'source', 'blur-1']);
    expect(projected.find((node) => node.id === 'blur-1')?.inputs).toEqual({ mask: 'source' });
  });

  it('resolves entry input nodes to the full upstream root pipeline', () => {
    const entryNodeId = 'input_matte_in';
    const groupNode = {
      id: 'group-1',
      kind: NodeKind.GROUP,
      type: NodeType.GROUP,
      name: 'Blur Group',
      enabled: true,
      childFlowId: 'child-flow',
      outputNodeId: 'blur-1',
      externalInputs: [
        {
          id: 'matte_in',
          label: 'Matte',
          entryNodeId,
          targetNodeId: 'blur-1',
          targetPort: 'mask',
        },
      ],
      inputs: { matte_in: 'grade-1' },
    } as AnyNode;
    const entryNode = {
      id: entryNodeId,
      kind: NodeKind.INPUT,
      type: NodeType.INPUT,
      name: 'Matte',
      enabled: true,
      groupNodeId: 'group-1',
      externalInputId: 'matte_in',
    } as AnyNode;
    const rootFlow = buildFlowFromNodes(
      [scene(), image('source'), grade('grade-1', { pipe: 'source' }), groupNode],
      ROOT_FLOW_ID,
    );
    const childFlow = buildFlowFromNodes(
      [entryNode, blur('blur-1', { mask: entryNodeId })],
      'child-flow',
    );
    const flows = {
      [rootFlow.id]: rootFlow,
      [childFlow.id]: childFlow,
    };

    const projected = expandGroupNodesForRender(getOrderedNodesFromFlow(childFlow), flows);

    expect(projected.map((node) => node.id)).toEqual(['scene-1', 'source', 'grade-1', 'blur-1']);
    expect(projected.find((node) => node.id === 'blur-1')?.inputs).toEqual({ mask: 'grade-1' });
  });

  it('does not duplicate shared upstream nodes for multiple entry inputs', () => {
    const sourceEntryId = 'input_source_in';
    const gradeEntryId = 'input_grade_in';
    const groupNode = {
      id: 'group-1',
      kind: NodeKind.GROUP,
      type: NodeType.GROUP,
      name: 'Blur Group',
      enabled: true,
      childFlowId: 'child-flow',
      outputNodeId: 'blur-1',
      externalInputs: [
        {
          id: 'source_in',
          label: 'Source',
          entryNodeId: sourceEntryId,
          targetNodeId: 'blur-1',
          targetPort: 'mask',
        },
        {
          id: 'grade_in',
          label: 'Grade',
          entryNodeId: gradeEntryId,
          targetNodeId: 'blur-1',
          targetPort: 'matte',
        },
      ],
      inputs: { source_in: 'source', grade_in: 'grade-1' },
    } as AnyNode;
    const sourceEntryNode = {
      id: sourceEntryId,
      kind: NodeKind.INPUT,
      type: NodeType.INPUT,
      name: 'Source',
      enabled: true,
      groupNodeId: 'group-1',
      externalInputId: 'source_in',
    } as AnyNode;
    const gradeEntryNode = {
      id: gradeEntryId,
      kind: NodeKind.INPUT,
      type: NodeType.INPUT,
      name: 'Grade',
      enabled: true,
      groupNodeId: 'group-1',
      externalInputId: 'grade_in',
    } as AnyNode;
    const rootFlow = buildFlowFromNodes(
      [scene(), image('source'), grade('grade-1'), groupNode],
      ROOT_FLOW_ID,
    );
    const childFlow = buildFlowFromNodes(
      [
        sourceEntryNode,
        gradeEntryNode,
        blur('blur-1', { mask: sourceEntryId, matte: gradeEntryId }),
      ],
      'child-flow',
    );
    const flows = {
      [rootFlow.id]: rootFlow,
      [childFlow.id]: childFlow,
    };

    const projected = expandGroupNodesForRender(getOrderedNodesFromFlow(childFlow), flows);

    expect(projected.map((node) => node.id)).toEqual(['scene-1', 'source', 'grade-1', 'blur-1']);
  });

  it('omits unresolved exposed group inputs from render projection', () => {
    const entryNodeId = 'input_mask_in';
    const groupNode = {
      id: 'group-1',
      kind: NodeKind.GROUP,
      type: NodeType.GROUP,
      name: 'Blur Group',
      enabled: true,
      childFlowId: 'child-flow',
      outputNodeId: 'blur-1',
      externalInputs: [
        {
          id: 'mask_in',
          label: 'Mask',
          entryNodeId,
          targetNodeId: 'blur-1',
          targetPort: 'mask',
        },
      ],
    } as AnyNode;
    const entryNode = {
      id: entryNodeId,
      kind: NodeKind.INPUT,
      type: NodeType.INPUT,
      name: 'Mask',
      enabled: true,
      groupNodeId: 'group-1',
      externalInputId: 'mask_in',
    } as AnyNode;
    const rootFlow = buildFlowFromNodes([scene(), groupNode], ROOT_FLOW_ID);
    const childFlow = buildFlowFromNodes(
      [entryNode, blur('blur-1', { mask: entryNodeId })],
      'child-flow',
    );
    const flows = {
      [rootFlow.id]: rootFlow,
      [childFlow.id]: childFlow,
    };

    const projected = expandGroupNodesForRender(getOrderedNodesFromFlow(rootFlow), flows);

    expect(projected.map((node) => node.id)).toEqual(['scene-1', 'blur-1']);
    expect(projected.find((node) => node.id === 'blur-1')?.inputs).toBeUndefined();
  });

  it('resolves group outputs through nested expanded groups', () => {
    const outerEntryId = 'input_outer_mask';
    const innerEntryId = 'input_inner_mask';
    const innerGroup = {
      id: 'inner-group',
      kind: NodeKind.GROUP,
      type: NodeType.GROUP,
      name: 'Inner Group',
      enabled: true,
      childFlowId: 'inner-flow',
      outputNodeId: 'blur-1',
      externalInputs: [
        {
          id: 'inner_mask',
          label: 'Mask',
          entryNodeId: innerEntryId,
          targetNodeId: 'blur-1',
          targetPort: 'mask',
        },
      ],
      inputs: { inner_mask: outerEntryId },
    } as AnyNode;
    const outerGroup = {
      id: 'outer-group',
      kind: NodeKind.GROUP,
      type: NodeType.GROUP,
      name: 'Outer Group',
      enabled: true,
      childFlowId: 'outer-flow',
      outputNodeId: 'inner-group',
      externalInputs: [
        {
          id: 'outer_mask',
          label: 'Mask',
          entryNodeId: outerEntryId,
          targetNodeId: 'inner-group',
          targetPort: 'inner_mask',
        },
      ],
      inputs: { outer_mask: 'source' },
    } as AnyNode;
    const outerEntry = {
      id: outerEntryId,
      kind: NodeKind.INPUT,
      type: NodeType.INPUT,
      name: 'Outer Mask',
      enabled: true,
      groupNodeId: 'outer-group',
      externalInputId: 'outer_mask',
    } as AnyNode;
    const innerEntry = {
      id: innerEntryId,
      kind: NodeKind.INPUT,
      type: NodeType.INPUT,
      name: 'Inner Mask',
      enabled: true,
      groupNodeId: 'inner-group',
      externalInputId: 'inner_mask',
    } as AnyNode;
    const rootFlow = buildFlowFromNodes(
      [scene(), image('source'), outerGroup, grade('grade-1', { matte: 'outer-group' })],
      ROOT_FLOW_ID,
      'Root Flow',
    );
    const outerFlow = buildFlowFromNodes([outerEntry, innerGroup], 'outer-flow');
    const innerFlow = buildFlowFromNodes(
      [innerEntry, blur('blur-1', { mask: innerEntryId })],
      'inner-flow',
    );
    const flows = {
      [rootFlow.id]: rootFlow,
      [outerFlow.id]: outerFlow,
      [innerFlow.id]: innerFlow,
    };

    const projected = expandGroupNodesForRender(getOrderedNodesFromFlow(rootFlow), flows);

    expect(projected.map((node) => node.id)).toEqual(['scene-1', 'source', 'blur-1', 'grade-1']);
    expect(projected.find((node) => node.id === 'blur-1')?.inputs).toEqual({ mask: 'source' });
    expect(projected.find((node) => node.id === 'grade-1')?.inputs).toEqual({ matte: 'blur-1' });
  });
});
