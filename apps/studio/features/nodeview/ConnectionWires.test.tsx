import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import ConnectionWires from './ConnectionWires';
import { getInputPortKey, getOutputPortKey } from './nodePortKeys';

const connection = {
  id: 'edge_extract_r_merge_g',
  sourceNodeId: 'extract',
  sourcePort: 'r',
  targetNodeId: 'merge',
  targetPort: 'g',
};

const positions = new Map([
  [getOutputPortKey('extract', 'r'), { x: 40, y: 20 }],
  [getInputPortKey('merge', 'g'), { x: 120, y: 180 }],
]);

const renderWires = (
  targetColor: string,
  states: {
    highlightedConnectionKeys?: ReadonlySet<string>;
    flowingConnectionKeys?: ReadonlySet<string>;
  } = {},
) =>
  renderToStaticMarkup(
    <ConnectionWires
      connections={[connection]}
      portPositions={positions}
      selectedConnection={null}
      onSelectConnection={vi.fn()}
      dragPreview={null}
      portColors={
        new Map([
          [getOutputPortKey('extract', 'r'), '#c96f78'],
          [getInputPortKey('merge', 'g'), targetColor],
        ])
      }
      {...states}
    />,
  );

describe('ConnectionWires channel colors', () => {
  it('uses a directional gradient when source and target channel colors differ', () => {
    const markup = renderWires('#70ad87');

    expect(markup).toContain('<linearGradient');
    expect(markup).toContain('gradientUnits="userSpaceOnUse"');
    expect(markup).toContain('stop-color="#c96f78"');
    expect(markup).toContain('stop-color="#70ad87"');
    expect(markup).toContain('stroke="url(#');
  });

  it('uses one solid color for matching channels', () => {
    const markup = renderWires('#c96f78');

    expect(markup).not.toContain('<linearGradient');
    expect(markup).toContain('stroke="#c96f78"');
  });

  it('marks selected-node upstream wires for emphasis', () => {
    const markup = renderWires('#70ad87', {
      highlightedConnectionKeys: new Set([connection.id]),
    });

    expect(markup).toContain('data-upstream-highlighted="true"');
    expect(markup).toContain('stroke-width="2.25"');
  });

  it('uses a softened accent for ordinary upstream wires', () => {
    const markup = renderToStaticMarkup(
      <ConnectionWires
        connections={[connection]}
        portPositions={positions}
        selectedConnection={null}
        onSelectConnection={vi.fn()}
        dragPreview={null}
        portColors={new Map()}
        highlightedConnectionKeys={new Set([connection.id])}
      />,
    );

    expect(markup).toContain(
      'stroke="color-mix(in oklch, rgb(var(--color-primary-400)) 42%, #555)"',
    );
  });

  it('adds a directional animated dash overlay to the active viewer path', () => {
    const markup = renderWires('#70ad87', {
      flowingConnectionKeys: new Set([connection.id]),
    });

    expect(markup).toContain('data-view-flowing="true"');
    expect(markup).toContain('data-view-flow-path="true"');
    expect(markup).toContain('class="node-view-flow-wire"');
    expect(markup).toContain('stroke="url(#');
    expect(markup).toContain('stroke="rgb(var(--color-primary-300))"');
    expect(markup).toContain('stroke-dasharray="6 9"');
  });

  it('keeps the normal wire color beneath flow dashes when also highlighted', () => {
    const connectionKey = connection.id;
    const markup = renderToStaticMarkup(
      <ConnectionWires
        connections={[connection]}
        portPositions={positions}
        selectedConnection={null}
        onSelectConnection={vi.fn()}
        dragPreview={null}
        portColors={new Map()}
        highlightedConnectionKeys={new Set([connectionKey])}
        flowingConnectionKeys={new Set([connectionKey])}
      />,
    );

    expect(markup).toContain('stroke="#555"');
    expect(markup).toContain('stroke="rgb(var(--color-primary-300))"');
  });
});
