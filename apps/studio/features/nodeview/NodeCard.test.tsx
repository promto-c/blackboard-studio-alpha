import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { NodeType, type AnyNode } from '@blackboard/types';
import { createDefaultGrade } from '@/nodes/effects/grade/gradeModel';
import { buildStackInputPorts, InputPortDot, OutputPortDot } from './NodeCard';

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
});
