import { describe, expect, it } from 'vitest';
import {
  NodeType,
  RotoDrawMode,
  RotoPathBlend,
  RotoShapeType,
  type PersistedProjectState,
  type RotoNode,
  type SceneNode,
} from '@blackboard/types';
import { buildFlowFromNodes, ROOT_FLOW_ID } from '@/state/editor/flowModel';
import { summarizeAgentBranchDiff } from './agentBranchDiff';

const scene = (id: string, name: string): SceneNode => ({
  id,
  type: NodeType.SCENE,
  name,
  enabled: true,
  width: 1920,
  height: 1080,
  bitDepth: 16,
  colorSpace: 'Linear',
  startFrame: 0,
  maxFrames: 12,
  fps: 24,
});

const stateWithNodes = (nodes: SceneNode[]): PersistedProjectState => ({
  flows: { [ROOT_FLOW_ID]: buildFlowFromNodes(nodes, ROOT_FLOW_ID, 'Root Flow') },
  rootFlowId: ROOT_FLOW_ID,
  activeFlowId: ROOT_FLOW_ID,
});

const roto = (paths = 0): RotoNode => ({
  id: 'roto-a',
  type: NodeType.ROTO,
  name: 'Roto A',
  enabled: true,
  invert: false,
  paths: Array.from({ length: paths }, (_, index) => ({
    id: `path-${index}`,
    name: `Path ${index + 1}`,
    shapeType: RotoShapeType.POLYGON,
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ],
    closed: true,
    feather: 0,
    opacity: 100,
    blend: RotoPathBlend.ADD,
    style: { mode: RotoDrawMode.FILL, strokeWidth: 2 },
  })),
});

describe('summarizeAgentBranchDiff', () => {
  it('summarizes added and changed nodes', () => {
    const base = stateWithNodes([scene('scene-a', 'Scene A')]);
    const candidate = stateWithNodes([
      { ...scene('scene-a', 'Scene A'), maxFrames: 24 },
      scene('scene-b', 'Scene B'),
    ]);

    const summary = summarizeAgentBranchDiff(base, candidate);

    expect(summary.hasChanges).toBe(true);
    expect(summary.nodeChanges.added).toEqual(['scene-b']);
    expect(summary.nodeChanges.changed).toEqual(['scene-a']);
    expect(summary.items.some((item) => item.includes('Adds 1 node'))).toBe(true);
    expect(summary.items.some((item) => item.includes('Updates 1 node'))).toBe(true);
  });

  it('summarizes domain-specific roto and asset changes', () => {
    const base = {
      flows: {
        [ROOT_FLOW_ID]: buildFlowFromNodes(
          [
            scene('scene-a', 'Scene A'),
            {
              id: 'image-a',
              type: NodeType.MEDIA_SOURCE,
              name: 'Image A',
              enabled: true,
              mediaKind: 'image',
              src: 'asset-a',
            },
            roto(0),
          ] as SceneNode[],
          ROOT_FLOW_ID,
          'Root Flow',
        ),
      },
      rootFlowId: ROOT_FLOW_ID,
      activeFlowId: ROOT_FLOW_ID,
    } as PersistedProjectState;
    const candidate = {
      flows: {
        [ROOT_FLOW_ID]: buildFlowFromNodes(
          [
            scene('scene-a', 'Scene A'),
            {
              id: 'image-a',
              type: NodeType.MEDIA_SOURCE,
              name: 'Image A',
              enabled: true,
              mediaKind: 'image',
              src: 'asset-b',
            },
            roto(1),
          ] as SceneNode[],
          ROOT_FLOW_ID,
          'Root Flow',
        ),
      },
      rootFlowId: ROOT_FLOW_ID,
      activeFlowId: ROOT_FLOW_ID,
    } as PersistedProjectState;

    const summary = summarizeAgentBranchDiff(base, candidate);

    expect(summary.domainChanges.roto).toHaveLength(1);
    expect(summary.domainChanges.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ domain: 'roto', title: 'Roto A roto edit' }),
        expect.objectContaining({ domain: 'assets', severity: 'warning' }),
      ]),
    );
    expect(summary.domainChanges.assets.added).toEqual(['asset-b']);
    expect(summary.domainChanges.assets.removed).toEqual(['asset-a']);
    expect(summary.items.some((item) => item.includes('Changes roto data'))).toBe(true);
    expect(summary.items.some((item) => item.includes('Changes media assets'))).toBe(true);
  });
});
