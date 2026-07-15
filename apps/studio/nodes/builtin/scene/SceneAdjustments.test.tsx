// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeType, type SceneNode } from '@blackboard/types';
import SceneAdjustments from './SceneAdjustments';

const mocks = vi.hoisted(() => ({
  openPreferences: vi.fn(),
  updateNode: vi.fn(),
}));

vi.mock('@/state/editorContext', () => ({
  useEditorActions: () => ({
    updateNode: mocks.updateNode,
  }),
}));

vi.mock('@/features/projects/preferencesNavigation', () => ({
  usePreferencesNavigation: () => ({
    openPreferences: mocks.openPreferences,
  }),
}));

vi.mock('@/components/OcioColorSpaceDropdown', () => ({
  OcioColorSpaceDropdown: () => <div data-testid="working-space-dropdown" />,
}));

const sceneNode: SceneNode = {
  id: 'scene-1',
  type: NodeType.SCENE,
  name: 'Scene',
  enabled: true,
  width: 1920,
  height: 1080,
  bitDepth: 16,
  colorSpace: 'ACEScg',
  startFrame: 0,
  maxFrames: 120,
  fps: 24,
};

describe('SceneAdjustments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens project Color preferences from the working-space property', () => {
    render(<SceneAdjustments node={sceneNode} />);

    const settingsAction = screen.getByLabelText('Open project color settings');

    expect(
      screen.getByTestId('working-space-dropdown').closest('.bb-split-control'),
    ).not.toBeNull();

    fireEvent.click(settingsAction);
    expect(mocks.openPreferences).toHaveBeenCalledWith({
      section: 'colorManagement',
      colorScope: 'project',
    });
  });

  it('edits the absolute scene frame range', () => {
    render(<SceneAdjustments node={{ ...sceneNode, startFrame: 1001, maxFrames: 1240 }} />);

    const startInput = screen.getByRole('spinbutton', { name: 'Timeline start frame' });
    const endInput = screen.getByRole('spinbutton', { name: 'Timeline end frame' });

    fireEvent.focus(startInput);
    fireEvent.change(startInput, { target: { value: '1002' } });
    fireEvent.blur(startInput);
    expect(mocks.updateNode).toHaveBeenCalledWith('scene-1', { startFrame: 1002 }, true);

    fireEvent.focus(endInput);
    fireEvent.change(endInput, { target: { value: '1250' } });
    fireEvent.blur(endInput);
    expect(mocks.updateNode).toHaveBeenCalledWith('scene-1', { maxFrames: 1250 }, true);
  });
});
