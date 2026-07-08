import { describe, expect, it } from 'vitest';
import { NodeType, type AnyNode, type Flow } from '@blackboard/types';
import { createUserMediaColorManagement } from './media';
import type { NodeRegistryLike } from '@blackboard/renderer';

// Minimal mock registry that provides the outputPorts/mediaDescriptor the tests need.
const mockRegistry = new Map([
  [
    NodeType.EXTRACT_CHANNELS,
    {
      processingDomain: 'data',
      outputPorts: [
        { name: 'a', dataSemantic: 'alpha', label: 'A', description: '' },
        { name: 'r', dataSemantic: 'alpha', label: 'R', description: '' },
        { name: 'g', label: 'G', description: '' },
      ],
    },
  ],
  [NodeType.GRADE, { processingDomain: 'scene_linear' }],
  [
    NodeType.MEDIA_SOURCE,
    {
      processingDomain: 'scene_linear',
      mediaDescriptor: {
        isData: (node: any) => node?.mediaColorManagement?.isData === true,
      },
    },
  ],
]) as unknown as NodeRegistryLike;
import {
  getTechnicalOutputChannelName,
  getTechnicalOutputFormatIssue,
  resolveRenderOutputDomain,
} from './renderOutputDomain';

const flow = (nodes: AnyNode[], edges: Flow['edges'], outputNodeId = 'output'): Flow => ({
  id: 'flow',
  name: 'Flow',
  nodes,
  edges,
  stacks: [],
  outputNodeId,
});

describe('render output domain', () => {
  it('resolves a registry-declared alpha output as technical data', () => {
    const extract = {
      id: 'extract',
      type: NodeType.EXTRACT_CHANNELS,
      name: 'Extract Channels',
      enabled: true,
    } as unknown as AnyNode;
    const output = {
      id: 'output',
      type: NodeType.OUTPUT,
      name: 'Output',
      enabled: true,
    } as AnyNode;
    const activeFlow = flow(
      [extract, output],
      [
        {
          id: 'edge',
          sourceNodeId: extract.id,
          sourcePort: 'a',
          targetNodeId: output.id,
          targetPort: 'pipe',
        },
      ],
    );

    expect(
      resolveRenderOutputDomain({
        nodes: activeFlow.nodes,
        flow: activeFlow,
        nodeRegistry: mockRegistry,
      }),
    ).toEqual({
      kind: 'data',
      sourceNodeId: 'extract',
      sourcePort: 'a',
      semantic: 'alpha',
    });
  });

  it('inherits a technical domain through pipe-connected adjustments', () => {
    const extract = {
      id: 'extract',
      type: NodeType.EXTRACT_CHANNELS,
      name: 'Extract Channels',
      enabled: true,
    } as AnyNode;
    const adjustment = {
      id: 'grade',
      type: NodeType.GRADE,
      name: 'Grade',
      enabled: true,
      inputs: { pipe: extract.id },
      inputSourcePorts: { pipe: 'a' },
    } as unknown as AnyNode;
    const output = {
      id: 'output',
      type: NodeType.OUTPUT,
      name: 'Output',
      enabled: true,
    } as AnyNode;
    const activeFlow = flow(
      [extract, adjustment, output],
      [
        {
          id: 'extract-grade',
          sourceNodeId: extract.id,
          sourcePort: 'a',
          targetNodeId: adjustment.id,
          targetPort: 'pipe',
        },
        {
          id: 'grade-output',
          sourceNodeId: adjustment.id,
          sourcePort: 'output',
          targetNodeId: output.id,
          targetPort: 'pipe',
        },
      ],
    );

    expect(
      resolveRenderOutputDomain({
        nodes: activeFlow.nodes,
        flow: activeFlow,
        nodeRegistry: mockRegistry,
      }).kind,
    ).toBe('data');
  });

  it('resolves dynamically tagged media and normal color outputs', () => {
    const dataMedia = {
      id: 'data',
      type: NodeType.MEDIA_SOURCE,
      name: 'Depth',
      enabled: true,
      mediaColorManagement: createUserMediaColorManagement('Raw', { isData: true }),
    } as AnyNode;
    const colorMedia = {
      ...dataMedia,
      id: 'color',
      name: 'Plate',
      mediaColorManagement: createUserMediaColorManagement('ACEScg'),
    } as AnyNode;

    expect(
      resolveRenderOutputDomain({
        nodes: [dataMedia],
        flow: null,
        viewerNodeId: dataMedia.id,
        nodeRegistry: mockRegistry,
      }).kind,
    ).toBe('data');
    expect(
      resolveRenderOutputDomain({
        nodes: [colorMedia],
        flow: null,
        viewerNodeId: colorMedia.id,
        nodeRegistry: mockRegistry,
      }).kind,
    ).toBe('color');
  });

  it('blocks lossy technical output formats while allowing OpenEXR', () => {
    const domain = {
      kind: 'data',
      sourceNodeId: 'extract',
      sourcePort: 'a',
      semantic: 'alpha',
    } as const;

    expect(getTechnicalOutputFormatIssue(domain, 'image/png')).toContain('requires OpenEXR');
    expect(getTechnicalOutputFormatIssue(domain, 'image/x-exr')).toBeNull();
    expect(getTechnicalOutputFormatIssue({ kind: 'color' }, 'image/png')).toBeNull();
    expect(getTechnicalOutputChannelName(domain)).toBe('A');
    expect(
      getTechnicalOutputChannelName({
        kind: 'data',
        sourceNodeId: 'media',
        sourcePort: 'output',
      }),
    ).toBe('Y');
  });
});
