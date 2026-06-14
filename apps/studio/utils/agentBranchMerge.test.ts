import { describe, expect, it } from 'vitest';
import {
  NodeType,
  type AnyNode,
  type PersistedProjectState,
  type SceneNode,
} from '@blackboard/types';
import { buildFlowFromNodes, ROOT_FLOW_ID } from '@/state/editor/flowModel';
import { cherryPickAgentNodeChanges } from './agentBranchMerge';

const scene: SceneNode = {
  id: 'scene',
  type: NodeType.SCENE,
  name: 'Scene',
  enabled: true,
  width: 1920,
  height: 1080,
  bitDepth: 16,
  colorSpace: 'Linear',
  maxFrames: 120,
  fps: 24,
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

const grade = (id: string, brightness: number): AnyNode =>
  ({
    id,
    type: NodeType.GRADE,
    name: id,
    enabled: true,
    grade: {
      brightness,
      contrast: 1,
      saturation: 1,
      gain: 1,
      gamma: 1,
      lift: 0,
    },
    inputs: { pipe: 'plate' },
  }) as AnyNode;

const stateWithNodes = (
  nodes: AnyNode[],
  positions: Record<string, { x: number; y: number }> = {},
): PersistedProjectState => ({
  flows: { [ROOT_FLOW_ID]: buildFlowFromNodes(nodes, ROOT_FLOW_ID, 'Root Flow') },
  rootFlowId: ROOT_FLOW_ID,
  activeFlowId: ROOT_FLOW_ID,
  nodePositionsByFlow: { [ROOT_FLOW_ID]: positions },
});

describe('agentBranchMerge', () => {
  it('cherry-picks added and updated nodes without deleting parent-only nodes', () => {
    const parent = stateWithNodes([scene, image('plate'), image('parent-only'), grade('look', 0)], {
      look: { x: 1, y: 1 },
    });
    const branch = stateWithNodes(
      [scene, image('plate'), grade('look', 0.25), image('agent-extra')],
      {
        look: { x: 10, y: 20 },
        'agent-extra': { x: 30, y: 40 },
      },
    );

    const result = cherryPickAgentNodeChanges(parent, branch);
    const mergedNodes = result.state.flows![ROOT_FLOW_ID].nodes;

    expect(result.appliedNodeIds).toEqual(['look', 'agent-extra']);
    expect(mergedNodes.map((node) => node.id)).toContain('parent-only');
    expect(mergedNodes.map((node) => node.id)).toContain('agent-extra');
    const lookNode = mergedNodes.find((node) => node.id === 'look') as AnyNode & {
      grade?: { brightness: number };
    };
    expect(lookNode.grade?.brightness).toBe(0.25);
    expect(result.state.nodePositionsByFlow?.[ROOT_FLOW_ID]?.look).toEqual({ x: 10, y: 20 });
  });
});
