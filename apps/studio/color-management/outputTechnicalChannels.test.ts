import { describe, expect, it } from 'vitest';
import { NodeType, type AnyNode, type Flow, type OutputNode } from '@blackboard/types';
import {
  getConnectedOutputTechnicalChannels,
  getOutputTechnicalChannelPort,
  isOutputTechnicalChannelPort,
} from './outputTechnicalChannels';

describe('output technical channels', () => {
  it('resolves connected channels in the persisted output-slot order', () => {
    const output = {
      id: 'output',
      type: NodeType.OUTPUT,
      name: 'Output',
      enabled: true,
      technicalChannels: [
        { id: 'depth', name: 'Z', semantic: 'depth' },
        { id: 'mask', name: 'mask.Y', semantic: 'mask' },
      ],
    } satisfies OutputNode;
    const flow: Flow = {
      id: 'flow',
      name: 'Flow',
      nodes: [
        { id: 'extract', type: NodeType.EXTRACT_CHANNELS, name: 'Extract', enabled: true },
        output,
      ] as AnyNode[],
      edges: [
        {
          id: 'mask-edge',
          sourceNodeId: 'extract',
          sourcePort: 'a',
          targetNodeId: output.id,
          targetPort: getOutputTechnicalChannelPort('mask'),
        },
        {
          id: 'depth-edge',
          sourceNodeId: 'extract',
          sourcePort: 'r',
          targetNodeId: output.id,
          targetPort: getOutputTechnicalChannelPort('depth'),
        },
      ],
      stacks: [],
      outputNodeId: output.id,
    };

    expect(getConnectedOutputTechnicalChannels(flow)).toEqual([
      {
        id: 'depth',
        name: 'Z',
        semantic: 'depth',
        nodeId: 'extract',
        sourcePort: 'r',
      },
      {
        id: 'mask',
        name: 'mask.Y',
        semantic: 'mask',
        nodeId: 'extract',
        sourcePort: 'a',
      },
    ]);
    expect(isOutputTechnicalChannelPort('technical:depth')).toBe(true);
    expect(isOutputTechnicalChannelPort('pipe')).toBe(false);
  });
});
