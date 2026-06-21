// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ComfyWorkflowOutputCandidate } from '@blackboard/types';
import { getComfyControlKey } from '../comfyControls';
import { ComfyWorkflowOutputPicker } from './ComfyWorkflowOutputPicker';

const candidate: ComfyWorkflowOutputCandidate = {
  id: '88:0',
  nodeId: '88',
  nodeType: 'ImageToSplat',
  kind: 'synthetic',
  outputIndex: 0,
  outputName: 'splat',
  outputType: 'SPLAT',
  label: 'ImageToSplat #88 splat',
  previewNodeId: 'save',
  syntheticOutputFormat: 'model_3d',
  syntheticOutputNodes: [
    {
      id: 'serialize',
      nodeType: 'SplatToFile3D',
      inputs: { splat: ['88', 0], format: 'spz' },
    },
    {
      id: 'save',
      nodeType: 'SaveGLB',
      inputs: { mesh: ['serialize', 0], filename_prefix: 'blackboard/3d/88_0' },
    },
  ],
};

describe('ComfyWorkflowOutputPicker 3D formats', () => {
  it('edits the synthetic splat serializer format from the output card', () => {
    const onUpdateWorkflowOutputField = vi.fn();
    render(
      <ComfyWorkflowOutputPicker
        workflowOutputCandidates={[candidate]}
        workflowControls={[]}
        controlCandidates={[
          {
            key: getComfyControlKey('serialize', 'format'),
            nodeId: 'serialize',
            classType: 'SplatToFile3D',
            inputName: 'format',
            label: 'Format',
            description: '',
            value: 'spz',
            options: ['ply', 'ksplat', 'spz'],
            defaultVisible: true,
          },
        ]}
        selectedWorkflowOutputIds={[candidate.id]}
        selectedWorkflowOutputIdSet={new Set([candidate.id])}
        hasNoSelectedWorkflowOutputs={false}
        onSelectAllWorkflowOutputs={vi.fn()}
        onToggleWorkflowOutputCandidate={vi.fn()}
        onUpdateWorkflowOutputField={onUpdateWorkflowOutputField}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /workflow output/i }));
    fireEvent.click(screen.getByTitle('SplatToFile3D: set Format'));
    fireEvent.click(screen.getByRole('button', { name: 'ply' }));

    expect(onUpdateWorkflowOutputField).toHaveBeenCalledWith(
      candidate,
      'serialize',
      'format',
      'ply',
    );
  });

  it('keeps internal outputs available as unchecked options', () => {
    const internalCandidate: ComfyWorkflowOutputCandidate = {
      id: '88_57',
      nodeId: '88_57',
      nodeType: 'PreviewImage',
      kind: 'existing',
      outputIndex: 0,
      outputName: 'images',
      outputType: 'IMAGE',
      label: 'PreviewImage #88_57',
      previewNodeId: '88_57',
      scope: 'internal',
    };
    const onToggleWorkflowOutputCandidate = vi.fn();

    render(
      <ComfyWorkflowOutputPicker
        workflowOutputCandidates={[candidate, internalCandidate]}
        workflowControls={[]}
        controlCandidates={[]}
        selectedWorkflowOutputIds={[candidate.id]}
        selectedWorkflowOutputIdSet={new Set([candidate.id])}
        hasNoSelectedWorkflowOutputs={false}
        onSelectAllWorkflowOutputs={vi.fn()}
        onToggleWorkflowOutputCandidate={onToggleWorkflowOutputCandidate}
        onUpdateWorkflowOutputField={vi.fn()}
      />,
    );

    expect(screen.getByText('Internal output')).toBeTruthy();
    const toggle = screen.getByRole('button', { name: /PreviewImage #88_57/i });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(onToggleWorkflowOutputCandidate).toHaveBeenCalledWith(internalCandidate.id);
  });
});
