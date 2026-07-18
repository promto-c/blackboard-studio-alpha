import { describe, expect, it } from 'vitest';
import type { ComfyWorkflowInputCandidate } from '@blackboard/types';
import {
  getComfyWorkflowInputAlphaMode,
  getComfyWorkflowInputPortPresentation,
} from './comfyInputs';
import { getComfyWorkflowMediaInputKind } from '@/utils/comfyUtils';

const candidate = (inputName: string, inputType?: string): ComfyWorkflowInputCandidate => ({
  id: `1:${inputName}`,
  nodeId: '1',
  nodeType: 'WorkflowInput',
  inputName,
  inputType,
  label: inputName,
});

describe('Comfy workflow input semantics', () => {
  it('recognizes MASK socket metadata as a mask even when the socket has a custom name', () => {
    expect(getComfyWorkflowMediaInputKind(candidate('foreground_matte', 'MASK'))).toBe('mask');
  });

  it('recognizes legacy alpha candidates without persisted socket metadata', () => {
    expect(getComfyWorkflowMediaInputKind(candidate('alpha'))).toBe('mask');
  });

  it('always preserves alpha when rendering a Comfy mask input', () => {
    expect(getComfyWorkflowInputAlphaMode(candidate('alpha', 'MASK'), 'opaque')).toBe('preserve');
    expect(getComfyWorkflowInputAlphaMode(candidate('image', 'IMAGE'), 'opaque')).toBe('opaque');
  });

  it('presents a Comfy alpha socket as an alpha-domain mask port in Studio', () => {
    expect(getComfyWorkflowInputPortPresentation(candidate('alpha', 'MASK'))).toEqual({
      label: 'Alpha / Mask',
      type: 'mask',
      dataSemantic: 'mask',
      channel: 'a',
      processingDomain: 'alpha',
      color: '#9da5b2',
    });
  });
});
