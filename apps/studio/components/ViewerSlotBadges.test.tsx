import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ViewerSlotBadges } from './ViewerSlotBadges';

describe('ViewerSlotBadges', () => {
  it('distinguishes the lower Compare slot as the base', () => {
    const markup = renderToStaticMarkup(
      <>
        <ViewerSlotBadges
          nodeId="node-a"
          viewerNodeId="node-a"
          viewerSlots={{ 1: 'node-a', 2: 'node-b' }}
          compareViewerSlots={new Set([1, 2])}
        />
        <ViewerSlotBadges
          nodeId="node-b"
          viewerNodeId="node-a"
          viewerSlots={{ 1: 'node-a', 2: 'node-b' }}
          compareViewerSlots={new Set([1, 2])}
        />
      </>,
    );

    expect(markup.match(/data-viewer-slot-state="base"/g)).toHaveLength(1);
    expect(markup.match(/data-viewer-slot-state="comparison"/g)).toHaveLength(1);
    expect(markup).toContain('Viewer Slot 1 · Compare Base');
    expect(markup).toContain('Viewer Slot 2 · Comparison');
  });
});
