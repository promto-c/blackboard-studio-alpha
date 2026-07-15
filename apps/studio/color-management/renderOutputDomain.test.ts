import { describe, expect, it } from 'vitest';
import { NodeType, type AnyNode, type Flow } from '@blackboard/types';
import { createUserMediaColorManagement } from './media';
import type { NodeRegistryLike } from '@blackboard/renderer';

// Minimal mock registry that provides the outputPorts/mediaDescriptor the tests need.
const mockRegistry = new Map([
  [
    NodeType.EXTRACT_CHANNELS,
    {
      processingDomain: 'scene_linear',
      outputPorts: [
        {
          name: 'output',
          label: 'RGBA',
          processingDomain: 'scene_linear',
          description: '',
        },
        { name: 'a', dataSemantic: 'alpha', channel: 'a', label: 'A', description: '' },
        {
          name: 'r',
          processingDomain: 'data',
          channel: 'r',
          label: 'R',
          description: '',
        },
        {
          name: 'g',
          processingDomain: 'data',
          channel: 'g',
          label: 'G',
          description: '',
        },
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
  it('treats the selected Extract Channels node primary output as normal color', () => {
    const extract = {
      id: 'extract',
      type: NodeType.EXTRACT_CHANNELS,
      name: 'Extract Channels',
      enabled: true,
    } as AnyNode;

    expect(
      resolveRenderOutputDomain({
        nodes: [extract],
        flow: null,
        viewerNodeId: extract.id,
        nodeRegistry: mockRegistry,
      }),
    ).toEqual({ kind: 'color' });
  });

  it('treats a named channel connected to the normal output pipe as sparse RGBA color', () => {
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
      kind: 'color',
      sourceNodeId: 'extract',
      sourcePort: 'a',
    });
  });

  it('keeps a named channel as sparse RGBA through pipe-connected adjustments', () => {
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
      }),
    ).toEqual({
      kind: 'color',
      sourceNodeId: 'extract',
      sourcePort: 'a',
    });
  });

  it('ignores stale node input projections when the canonical edge is absent', () => {
    const extract = {
      id: 'extract',
      type: NodeType.EXTRACT_CHANNELS,
      name: 'Extract Channels',
      enabled: true,
    } as unknown as AnyNode;
    const adjustment = {
      id: 'grade',
      type: NodeType.GRADE,
      name: 'Grade',
      enabled: true,
      inputs: { pipe: extract.id },
      inputSourcePorts: { pipe: 'r' },
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
      }),
    ).toEqual({ kind: 'color' });
  });

  it('does not reinterpret generic technical data as color at the output pipe', () => {
    const dataMedia = {
      id: 'data',
      type: NodeType.MEDIA_SOURCE,
      name: 'Depth',
      enabled: true,
      mediaColorManagement: createUserMediaColorManagement('Raw', { isData: true }),
    } as AnyNode;
    const output = {
      id: 'output',
      type: NodeType.OUTPUT,
      name: 'Output',
      enabled: true,
    } as AnyNode;
    const activeFlow = flow(
      [dataMedia, output],
      [
        {
          id: 'data-output',
          sourceNodeId: dataMedia.id,
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
