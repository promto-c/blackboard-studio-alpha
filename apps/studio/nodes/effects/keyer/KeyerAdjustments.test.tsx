// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeType, type KeyerNode } from '@blackboard/types';
import { parseUniformsFromGLSL } from '@blackboard/renderer';
import KeyerAdjustments from './KeyerAdjustments';
import { KEYER_SHADER } from './keyerShader';

const mocks = vi.hoisted(() => ({
  setActiveViewportTool: vi.fn(),
  setKeyframe: vi.fn(),
  updateNode: vi.fn(),
}));

vi.mock('@/state/editorContext', () => ({
  useEditorSelector: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ currentFrame: 0, activeViewportTool: null }),
  useEditorActions: () => mocks,
}));

vi.mock('@/state/ocioContext', () => ({
  useOcio: () => ({ colorPickingColorSpace: 'sRGB', workingColorSpace: 'ACEScg' }),
}));

const createNode = (): KeyerNode => ({
  id: 'keyer-1',
  type: NodeType.KEYER,
  name: 'Keyer',
  enabled: true,
  matteOverlayWhileAdjusting: true,
  uniforms: parseUniformsFromGLSL(KEYER_SHADER),
});

describe('KeyerAdjustments', () => {
  beforeEach(() => vi.clearAllMocks());

  it('temporarily shows the matte overlay while refining a range', () => {
    render(<KeyerAdjustments node={createNode()} />);

    fireEvent.keyDown(screen.getByRole('slider', { name: 'Hue low' }), {
      key: 'ArrowRight',
    });

    const previewModes = mocks.updateNode.mock.calls
      .map((call) => call[1]?.uniforms?.u_viewMode?.value)
      .filter((value) => value !== undefined);
    expect(previewModes).toEqual([2, 0]);
    expect(mocks.updateNode.mock.calls.every((call) => call[2] === false)).toBe(true);
  });
});
