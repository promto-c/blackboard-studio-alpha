import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { NodeType, type AnyNode } from '@blackboard/types';
import { createDefaultGrade } from '@/nodes/effects/grade/gradeModel';
import {
  buildStackInputPorts,
  buildStackOutputPorts,
  InputPortDot,
  OutputPortDot,
} from './NodeCard';

const renderChannelInput = (isConnected: boolean) =>
  renderToStaticMarkup(
    <InputPortDot
      nodeId="merge"
      portName="r"
      label="R"
      isConnected={isConnected}
      isDragTarget={false}
      processingDomain="data"
      color="#c96f78"
      portRef={vi.fn()}
    />,
  );

describe('InputPortDot channel color', () => {
  it('keeps a channel outline but does not fill a disconnected input', () => {
    const markup = renderChannelInput(false);

    expect(markup).toContain('background-color:#1f2937');
    expect(markup).toContain('border-color:#c96f78');
    expect(markup).not.toContain('background-color:#c96f78');
  });

  it('uses a softer channel fill only when the input is connected', () => {
    const markup = renderChannelInput(true);

    expect(markup).toContain('background-color:color-mix(in oklch, #c96f78 70%, #1f2937)');
    expect(markup).toContain('border-color:#c96f78');
    expect(markup).not.toContain('background-color:#c96f78');
  });
});

describe('OutputPortDot channel color', () => {
  it('keeps channel outputs outlined without filling them', () => {
    const markup = renderToStaticMarkup(
      <OutputPortDot portRef={vi.fn()} label="R" processingDomain="data" color="#c96f78" />,
    );

    expect(markup).toContain('background-color:#1f2937');
    expect(markup).toContain('border-color:#c96f78');
    expect(markup).not.toContain('background-color:#c96f78');
  });
});

describe('buildStackInputPorts', () => {
  it('preserves both registry-declared Merge inputs in their declared order', () => {
    const merge = {
      id: 'merge',
      type: NodeType.MERGE,
      name: 'Merge',
      enabled: true,
    } as AnyNode;

    expect(
      buildStackInputPorts([merge]).map(({ portName, label }) => ({ portName, label })),
    ).toEqual([
      { portName: 'source', label: 'Source' },
      { portName: 'pipe', label: 'Main' },
    ]);
  });

  it('shows only the RGBA and alpha inputs for Masked Merge', () => {
    const maskedMerge = {
      id: 'masked-merge',
      type: NodeType.MASKED_MERGE,
      name: 'Masked Merge',
      enabled: true,
    } as AnyNode;

    expect(
      buildStackInputPorts([maskedMerge]).map(({ portName, label }) => ({ portName, label })),
    ).toEqual([
      { portName: 'pipe', label: 'RGBA' },
      { portName: 'mask', label: 'Alpha / Mask' },
    ]);
  });

  it('provides the reserved primary input for pipeline processing nodes', () => {
    const grade = {
      id: 'grade',
      type: NodeType.GRADE,
      name: 'Grade',
      enabled: true,
      grade: createDefaultGrade(),
    } as AnyNode;

    expect(
      buildStackInputPorts([grade]).map(({ portName, label }) => ({ portName, label })),
    ).toEqual([{ portName: 'pipe', label: 'in' }]);
  });

  it('hides only a pipe edge whose source is inside the compact card', () => {
    const base = {
      id: 'base',
      type: NodeType.MEDIA_SOURCE,
      name: 'Base',
      enabled: true,
    } as AnyNode;
    const internal = {
      id: 'internal',
      type: NodeType.GRADE,
      name: 'Internal',
      enabled: true,
      inputs: { pipe: 'base' },
      grade: createDefaultGrade(),
    } as AnyNode;
    const external = { ...internal, id: 'external', inputs: { pipe: 'outside' } } as AnyNode;

    expect(buildStackInputPorts([base, internal])).toEqual([]);
    expect(buildStackInputPorts([base, external])).toEqual([
      expect.objectContaining({ nodeId: 'external', portName: 'pipe' }),
    ]);
  });

  it('exposes output ports only from the final node in a compact card', () => {
    const base = {
      id: 'base',
      type: NodeType.MEDIA_SOURCE,
      name: 'Base',
      enabled: true,
    } as AnyNode;
    const child = {
      id: 'child',
      type: NodeType.GRADE,
      name: 'Child',
      enabled: true,
      grade: createDefaultGrade(),
    } as AnyNode;

    expect(
      buildStackOutputPorts([base, child]).map(({ nodeId, portName }) => [nodeId, portName]),
    ).toEqual([['child', 'output']]);
  });
});
