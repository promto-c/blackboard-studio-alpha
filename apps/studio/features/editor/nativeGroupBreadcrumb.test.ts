import { describe, expect, it } from 'vitest';
import { NodeType } from '@blackboard/types';
import {
  getRecentNativeGroupBreadcrumbPath,
  type NativeGroupPathItem,
} from './nativeGroupBreadcrumb';

const item = (nodeId: string, flowId: string, name = nodeId): NativeGroupPathItem => ({
  nodeId,
  flowId,
  name,
});

const flows = {
  root: {
    nodes: [{ id: 'group-a', type: NodeType.GROUP, childFlowId: 'flow-a' }],
  },
  'flow-a': {
    nodes: [
      { id: 'group-b', type: NodeType.GROUP, childFlowId: 'flow-b' },
      { id: 'group-d', type: NodeType.GROUP, childFlowId: 'flow-d' },
    ],
  },
  'flow-b': {
    nodes: [{ id: 'group-c', type: NodeType.GROUP, childFlowId: 'flow-c' }],
  },
  'flow-c': {
    nodes: [],
  },
  'flow-d': {
    nodes: [],
  },
};

describe('getRecentNativeGroupBreadcrumbPath', () => {
  it('preserves deeper recent crumbs when the active flow is a parent prefix', () => {
    const rememberedPath = [
      item('group-a', 'flow-a', 'A'),
      item('group-b', 'flow-b', 'B'),
      item('group-c', 'flow-c', 'C'),
    ];
    const activePath = [item('group-a', 'flow-a', 'Renamed A')];

    expect(getRecentNativeGroupBreadcrumbPath(activePath, rememberedPath, flows, 'root')).toEqual([
      item('group-a', 'flow-a', 'Renamed A'),
      item('group-b', 'flow-b', 'B'),
      item('group-c', 'flow-c', 'C'),
    ]);
  });

  it('replaces the remembered branch when navigating into a sibling group', () => {
    const rememberedPath = [
      item('group-a', 'flow-a', 'A'),
      item('group-b', 'flow-b', 'B'),
      item('group-c', 'flow-c', 'C'),
    ];
    const activePath = [item('group-a', 'flow-a', 'A'), item('group-d', 'flow-d', 'D')];

    expect(getRecentNativeGroupBreadcrumbPath(activePath, rememberedPath, flows, 'root')).toEqual(
      activePath,
    );
  });

  it('can clear deeper recent crumbs when the active flow is a parent prefix', () => {
    const rememberedPath = [
      item('group-a', 'flow-a', 'A'),
      item('group-b', 'flow-b', 'B'),
      item('group-c', 'flow-c', 'C'),
    ];
    const activePath = [item('group-a', 'flow-a', 'Renamed A')];

    expect(
      getRecentNativeGroupBreadcrumbPath(activePath, rememberedPath, flows, 'root', {
        preserveRecentPath: false,
      }),
    ).toEqual(activePath);
  });

  it('keeps the recent path while the root flow is active', () => {
    const rememberedPath = [
      item('group-a', 'flow-a', 'A'),
      item('group-b', 'flow-b', 'B'),
      item('group-c', 'flow-c', 'C'),
    ];

    expect(getRecentNativeGroupBreadcrumbPath([], rememberedPath, flows, 'root')).toEqual(
      rememberedPath,
    );
  });

  it('can clear the recent path while the root flow is active', () => {
    const rememberedPath = [
      item('group-a', 'flow-a', 'A'),
      item('group-b', 'flow-b', 'B'),
      item('group-c', 'flow-c', 'C'),
    ];

    expect(
      getRecentNativeGroupBreadcrumbPath([], rememberedPath, flows, 'root', {
        preserveRecentPath: false,
      }),
    ).toEqual([]);
  });
});
