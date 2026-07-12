import { describe, expect, it } from 'vitest';
import {
  NodeType,
  OCIO_PROJECT_WORKING_SPACE,
  OCIO_TEXTURE_COLOR_SPACE,
  type AnyNode,
} from '@blackboard/types';
import { canConnectNodeProcessingDomains } from './nodeProcessingDomains';
import { createDefaultGrade } from '@/nodes/effects/grade/gradeModel';

const node = (id: string, type: AnyNode['type']): AnyNode =>
  ({
    id,
    type,
    name: id,
    enabled: true,
    ...(type === NodeType.GRADE ? { grade: createDefaultGrade() } : {}),
    ...(type === NodeType.OCIO_COLOR_SPACE
      ? {
          sourceColorSpace: OCIO_TEXTURE_COLOR_SPACE,
          destinationColorSpace: OCIO_PROJECT_WORKING_SPACE,
        }
      : {}),
  }) as AnyNode;

describe('node processing-domain connections', () => {
  it('blocks technical channels from scene-linear effect pipes', () => {
    const nodes = [node('extract', NodeType.EXTRACT_CHANNELS), node('grade', NodeType.GRADE)];
    expect(
      canConnectNodeProcessingDomains({
        nodes,
        sourceNodeId: 'extract',
        sourcePortName: 'r',
        targetNodeId: 'grade',
        targetPortName: 'pipe',
      }),
    ).toBe(false);
  });

  it('allows generic technical channels into typed technical inputs', () => {
    const nodes = [node('extract', NodeType.EXTRACT_CHANNELS), node('bokeh', NodeType.BOKEH_BLUR)];
    expect(
      canConnectNodeProcessingDomains({
        nodes,
        sourceNodeId: 'extract',
        sourcePortName: 'r',
        targetNodeId: 'bokeh',
        targetPortName: 'depth',
      }),
    ).toBe(true);
  });

  it('allows scene-linear image pipes', () => {
    const nodes = [node('media', NodeType.MEDIA_SOURCE), node('grade', NodeType.GRADE)];
    expect(
      canConnectNodeProcessingDomains({
        nodes,
        sourceNodeId: 'media',
        sourcePortName: 'output',
        targetNodeId: 'grade',
        targetPortName: 'pipe',
      }),
    ).toBe(true);
  });

  it('allows Color Space Transform to reinterpret a color-domain input', () => {
    const nodes = [node('media', NodeType.MEDIA_SOURCE), node('cst', NodeType.OCIO_COLOR_SPACE)];
    expect(
      canConnectNodeProcessingDomains({
        nodes,
        sourceNodeId: 'media',
        sourcePortName: 'output',
        targetNodeId: 'cst',
        targetPortName: 'pipe',
      }),
    ).toBe(true);

    nodes[0] = node('extract', NodeType.EXTRACT_CHANNELS);
    expect(
      canConnectNodeProcessingDomains({
        nodes,
        sourceNodeId: 'extract',
        sourcePortName: 'r',
        targetNodeId: 'cst',
        targetPortName: 'pipe',
      }),
    ).toBe(false);
  });

  it('treats Roto as a scene-linear RGBA effect', () => {
    const nodes = [node('media', NodeType.MEDIA_SOURCE), node('roto', NodeType.ROTO)];

    expect(
      canConnectNodeProcessingDomains({
        nodes,
        sourceNodeId: 'media',
        sourcePortName: 'output',
        targetNodeId: 'roto',
        targetPortName: 'pipe',
      }),
    ).toBe(true);
  });
});
