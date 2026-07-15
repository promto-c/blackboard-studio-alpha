import { describe, expect, it } from 'vitest';
import { NodeType, type PaintNode } from '@blackboard/types';
import {
  collectPaintStampPoints,
  getVisiblePaintStrokes,
  paintCloneOffsetToUv,
  paintPointToRenderSpace,
} from './paintModel';

const createNode = (): PaintNode => ({
  id: 'paint',
  name: 'Paint',
  type: NodeType.PAINT,
  enabled: true,
  strokes: [
    {
      id: 'newer',
      name: 'Newer',
      tool: 'brush',
      visible: true,
      path: { mode: 'polyline', points: [{ x: 10, y: 10 }] },
      size: 20,
      spacing: 20,
      softness: 50,
      opacity: 100,
      color: [2, -0.5, 4],
      channels: 'rgb',
      stackOrder: 2,
    },
    {
      id: 'older',
      name: 'Older',
      tool: 'brush',
      visible: true,
      path: { mode: 'polyline', points: [{ x: 0, y: 0 }] },
      size: 20,
      spacing: 20,
      softness: 50,
      opacity: 100,
      color: [1, 1, 1],
      channels: 'a',
      alpha: 0.25,
      stackOrder: 1,
    },
  ],
  layers: [],
});

describe('paintModel', () => {
  it('adapts DOM-style Paint Y coordinates to bottom-up render space', () => {
    expect(paintPointToRenderSpace({ x: 40, y: 25 })).toEqual({ x: 40, y: -25 });
    expect(paintCloneOffsetToUv({ x: 20, y: 10 }, 200, 100)).toEqual({ x: 0.1, y: -0.1 });
  });

  it('creates evenly spaced stamps while preserving both path endpoints', () => {
    expect(
      collectPaintStampPoints(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        4,
      ),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 8, y: 0 },
      { x: 10, y: 0 },
    ]);
  });

  it('renders hierarchy content back-to-front and preserves HDR stroke values', () => {
    const node = createNode();
    const strokes = getVisiblePaintStrokes(node, 0);
    expect(strokes.map((stroke) => stroke.id)).toEqual(['older', 'newer']);
    expect(strokes[1].color).toEqual([2, -0.5, 4]);
  });
});
