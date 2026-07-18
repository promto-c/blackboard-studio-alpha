import { describe, expect, it } from 'vitest';
import {
  NodeType,
  type AnyNode,
  type Flow,
  type PersistedProjectState,
  type SceneNode,
} from '@blackboard/types';
import { buildFlowFromNodes } from '@/state/editor/flowModel';
import { connectDefaultPipeline } from './pipelineGraph';
import { resolveAgentRenderPreviewTarget } from './agentRenderPreview';

const scene: SceneNode = {
  id: 'scene-1',
  type: NodeType.SCENE,
  name: 'Scene',
  enabled: true,
  width: 1920,
  height: 1080,
  bitDepth: 16,
  colorSpace: 'sRGB',
  startFrame: 0,
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

const grade = (id: string): AnyNode =>
  ({ id, type: NodeType.GRADE, name: id, enabled: true, stacked: true }) as unknown as AnyNode;

const flowWithNodes = (nodes: AnyNode[]) =>
  connectDefaultPipeline(buildFlowFromNodes(nodes, 'flow-1', 'Main'), nodes);

const stateWithFlow = (flow: Flow): PersistedProjectState =>
  ({
    flows: { [flow.id]: flow },
    rootFlowId: flow.id,
    activeFlowId: flow.id,
    currentFrame: 12,
  }) as unknown as PersistedProjectState;

describe('agentRenderPreview', () => {
  it('resolves the requested node stack from a project snapshot', () => {
    const flow = flowWithNodes([scene, image('plate'), grade('look'), image('overlay')]);
    const target = resolveAgentRenderPreviewTarget(stateWithFlow(flow), { nodeId: 'look' });

    expect(target?.sceneNode).toMatchObject(scene);
    expect(target?.node.id).toBe('look');
    expect(target?.renderNodes.map((node) => node.id)).toEqual(['plate', 'look']);
  });

  it('falls back to the first renderable stack when the requested node is unavailable', () => {
    const flow = flowWithNodes([scene, image('plate'), image('overlay')]);
    const target = resolveAgentRenderPreviewTarget(stateWithFlow(flow), { nodeId: 'missing' });

    expect(target?.node.id).toBe('plate');
    expect(target?.renderNodes.map((node) => node.id)).toEqual(['plate']);
  });
});
