// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { NodeType, type KeyerNode } from '@blackboard/types';
import { KEYER_SAMPLE_TOOL_ID } from './keyerModel';
import { KeyerSampleOverlay } from './KeyerSampleOverlay';
import { setKeyerSampleDrag } from './keyerSampleDragStore';

const node = {
  id: 'keyer-1',
  type: NodeType.KEYER,
  name: 'Keyer',
  enabled: true,
  matteOverlayWhileAdjusting: true,
  uniforms: {},
} as KeyerNode;

describe('KeyerSampleOverlay', () => {
  afterEach(() => act(() => setKeyerSampleDrag(null)));

  it('uses the viewport scene Y coordinates directly', () => {
    setKeyerSampleDrag({
      nodeId: node.id,
      start: { x: -20, y: -30 },
      current: { x: 40, y: 10 },
    });
    const { container } = render(
      <svg>
        <KeyerSampleOverlay
          node={node}
          frame={0}
          zoom={1}
          pan={{ x: 0, y: 0 }}
          scene={{ width: 100, height: 100 }}
          activeTool={KEYER_SAMPLE_TOOL_ID}
        />
      </svg>,
    );

    expect(container.querySelector('rect')?.getAttribute('y')).toBe('-30');
    expect(container.querySelector('circle')?.getAttribute('cy')).toBe('-30');
  });
});
