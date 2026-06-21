// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComfyWorkflow, ComfyWorkflowInputCandidate } from '@blackboard/types';
import { describe, expect, it, vi } from 'vitest';
import { ComfyWorkflowInputList } from './ComfyWorkflowInputList';

const workflow: ComfyWorkflow = {
  id: 'workflow-a',
  name: 'Workflow A',
  prompt: {},
  createdAt: 1,
};

const topLevelInput: ComfyWorkflowInputCandidate = {
  id: '1:image',
  nodeId: '1',
  nodeType: 'LoadImage',
  inputName: 'image',
  label: 'LoadImage #1',
};

const internalInput: ComfyWorkflowInputCandidate = {
  id: '2:image',
  nodeId: '2',
  nodeType: 'ImageScale',
  inputName: 'image',
  label: 'ImageScale #2',
  scope: 'internal',
};

describe('ComfyWorkflowInputList', () => {
  it('shows internal inputs unchecked and lets the user enable their port', () => {
    const onToggleWorkflowInputCandidate = vi.fn();
    render(
      <ComfyWorkflowInputList
        selectedWorkflow={workflow}
        workflowInputCandidates={[topLevelInput, internalInput]}
        selectedWorkflowInputIdSet={new Set([topLevelInput.id])}
        connectedWorkflowInputs={[
          { candidate: topLevelInput, portName: 'top', sourceNode: null, inputImage: null },
          { candidate: internalInput, portName: 'internal', sourceNode: null, inputImage: null },
        ]}
        onToggleWorkflowInputCandidate={onToggleWorkflowInputCandidate}
        onImportWorkflowInputImage={vi.fn()}
        onClearWorkflowInputImage={vi.fn()}
      />,
    );

    expect(screen.getByText('Internal')).toBeTruthy();
    const toggle = screen.getByRole('button', { name: 'Show ImageScale #2 input port' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(onToggleWorkflowInputCandidate).toHaveBeenCalledWith(internalInput.id);
  });
});
