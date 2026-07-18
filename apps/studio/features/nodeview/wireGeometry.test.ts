import { describe, expect, it } from 'vitest';
import type { FlowEdge } from '@blackboard/types';
import { getInputPortKey, getOutputPortKey } from './nodePortKeys';
import { getWireCutConnectionIds, makePolylinePath, makeWireBezierPath } from './wireGeometry';

const connection: FlowEdge = {
  id: 'source:output->target:pipe',
  sourceNodeId: 'source',
  sourcePort: 'output',
  targetNodeId: 'target',
  targetPort: 'pipe',
};

const positions = new Map([
  [getOutputPortKey('source', 'output'), { x: 0, y: 0 }],
  [getInputPortKey('target', 'pipe'), { x: 100, y: 100 }],
]);

describe('wire cut geometry', () => {
  it('finds a wire crossed by a freehand path', () => {
    const ids = getWireCutConnectionIds(
      [connection],
      positions,
      [
        { x: -20, y: 50 },
        { x: 120, y: 50 },
      ],
      4,
    );

    expect(ids).toEqual(new Set([connection.id]));
  });

  it('does not select a wire that the path misses', () => {
    const ids = getWireCutConnectionIds(
      [connection],
      positions,
      [
        { x: -20, y: 140 },
        { x: 120, y: 140 },
      ],
      4,
    );

    expect(ids.size).toBe(0);
  });

  it('creates stable SVG paths for wires and knife strokes', () => {
    expect(makeWireBezierPath({ x: 0, y: 0 }, { x: 100, y: 100 })).toBe(
      'M 0 0 C 0 40, 100 60, 100 100',
    );
    expect(
      makePolylinePath([
        { x: 4, y: 8 },
        { x: 12, y: 16 },
      ]),
    ).toBe('M 4 8 L 12 16');
  });
});
