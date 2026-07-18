// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { NodeType, type AnyNode } from '@blackboard/types';
import {
  isGraphCanvasBackgroundTarget,
  resolveVisibleGraphNodeId,
  shouldCancelWireCutGesture,
} from './nodeViewState';

describe('node view state', () => {
  it('maps a selected stack child to the card that owns its external ports', () => {
    const base = { id: 'plate', type: NodeType.MEDIA_SOURCE } as AnyNode;
    const child = { id: 'grade', type: NodeType.GRADE } as AnyNode;

    expect(resolveVisibleGraphNodeId(child.id, [[base, child]])).toBe(base.id);
    expect(resolveVisibleGraphNodeId('output', [[base, child]])).toBe('output');
  });

  it('distinguishes empty canvas targets from graph interactions', () => {
    const canvas = document.createElement('div');
    const emptyContent = document.createElement('div');
    const node = document.createElement('div');
    const nodeControl = document.createElement('span');
    const wire = document.createElementNS('http://www.w3.org/2000/svg', 'path');

    canvas.append(emptyContent, node, wire);
    node.dataset.graphNode = 'true';
    node.append(nodeControl);
    wire.dataset.connectionWire = 'true';

    expect(isGraphCanvasBackgroundTarget(canvas)).toBe(true);
    expect(isGraphCanvasBackgroundTarget(emptyContent)).toBe(true);
    expect(isGraphCanvasBackgroundTarget(nodeControl)).toBe(false);
    expect(isGraphCanvasBackgroundTarget(wire)).toBe(false);
  });

  it('cancels a wire cut when its held modifier is released', () => {
    expect(
      shouldCancelWireCutGesture({
        type: 'keyup',
        key: 'Control',
        ctrlKey: false,
        metaKey: false,
      }),
    ).toBe(true);
    expect(
      shouldCancelWireCutGesture({
        type: 'keyup',
        key: 'Shift',
        ctrlKey: true,
        metaKey: false,
      }),
    ).toBe(false);
  });
});
