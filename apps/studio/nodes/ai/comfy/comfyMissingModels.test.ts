import type { ComfyWorkflow, ComfyWorkflowControl } from '@blackboard/types';
import { describe, expect, it } from 'vitest';
import { getMissingWorkflowControlOptions } from './comfyMissingModels';

const createMissingModelControl = (inputName: string, value: string): ComfyWorkflowControl => ({
  id: inputName,
  workflowId: 'workflow_a',
  nodeId: 'internal',
  classType: 'CheckpointLoaderSimple',
  inputName,
  label: inputName,
  value,
  defaultValue: value,
  options: ['available.safetensors'],
});

describe('Comfy missing workflow controls', () => {
  it('validates an internal field after the user explicitly shows it', () => {
    const workflow: ComfyWorkflow = {
      id: 'workflow_a',
      name: 'Workflow A',
      createdAt: 1,
      prompt: {},
      defaultControlKeys: ['internal:visible_model'],
    };
    const visibleControl = createMissingModelControl(
      'visible_model',
      'visible-missing.safetensors',
    );
    const hiddenControl = createMissingModelControl('hidden_model', 'hidden-missing.safetensors');

    expect(getMissingWorkflowControlOptions([visibleControl, hiddenControl], workflow)).toEqual([
      expect.objectContaining({ control: visibleControl }),
      expect.objectContaining({ control: hiddenControl }),
    ]);
  });
});
