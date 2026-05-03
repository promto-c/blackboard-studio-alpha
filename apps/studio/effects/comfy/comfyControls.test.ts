import { describe, expect, it } from 'vitest';
import {
  applyComfyWorkflowControls,
  createComfyWorkflowControl,
  getComfyWorkflowControlCandidates,
  getComfyWorkflowControlRunMode,
  isPromptLikeComfyTextInput,
  prepareComfyWorkflowControlsForRun,
} from './comfyControls';

describe('Comfy workflow controls', () => {
  it('finds primitive workflow inputs that can be exposed as node controls', () => {
    const workflow = {
      id: 'workflow_a',
      name: 'Workflow A',
      createdAt: 1,
      prompt: {
        '3': {
          class_type: 'KSampler',
          inputs: {
            seed: 123,
            steps: 8,
            cfg: 1.5,
            sampler_name: 'res_multistep',
            latent_image: ['2', 0],
          },
        },
        '7': {
          class_type: 'PreviewImage',
          inputs: {
            enabled: true,
          },
        },
      },
    };

    const candidates = getComfyWorkflowControlCandidates(workflow);

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: '3',
          inputName: 'steps',
          description: 'KSampler · #3 · steps',
          value: 8,
        }),
        expect.objectContaining({
          nodeId: '3',
          inputName: 'seed',
          value: 123,
        }),
        expect.objectContaining({
          nodeId: '7',
          inputName: 'enabled',
          value: true,
        }),
      ]),
    );
    expect(candidates.some((candidate) => candidate.inputName === 'latent_image')).toBe(false);
  });

  it('attaches Comfy combo options to matching control candidates and controls', () => {
    const workflow = {
      id: 'workflow_a',
      name: 'Workflow A',
      createdAt: 1,
      controlOptions: [
        {
          nodeId: '3',
          inputName: 'sampler_name',
          options: ['euler', 'res_multistep'],
        },
      ],
      prompt: {
        '3': {
          class_type: 'KSampler',
          inputs: {
            sampler_name: 'res_multistep',
          },
        },
      },
    };

    const candidate = getComfyWorkflowControlCandidates(workflow).find(
      (entry) => entry.inputName === 'sampler_name',
    );

    expect(candidate?.options).toEqual(['euler', 'res_multistep']);
    expect(createComfyWorkflowControl('workflow_a', candidate!).options).toEqual([
      'euler',
      'res_multistep',
    ]);
  });

  it('marks integer seed controls as randomized by default', () => {
    const workflow = {
      id: 'workflow_a',
      name: 'Workflow A',
      createdAt: 1,
      prompt: {
        '3': {
          class_type: 'KSampler',
          inputs: {
            seed: 123,
          },
        },
      },
    };
    const seedCandidate = getComfyWorkflowControlCandidates(workflow).find(
      (candidate) => candidate.inputName === 'seed',
    );

    expect(seedCandidate).toBeDefined();

    const control = createComfyWorkflowControl('workflow_a', seedCandidate!);

    expect(getComfyWorkflowControlRunMode(control)).toBe('randomize');
    expect(control.randomMin).toBe(0);
    expect(control.randomMax).toBe(999_999_999_999);
  });

  it('applies scoped overrides without mutating the stored workflow prompt', () => {
    const workflow = {
      id: 'workflow_a',
      name: 'Workflow A',
      createdAt: 1,
      prompt: {
        '3': {
          class_type: 'KSampler',
          inputs: {
            steps: 8,
            cfg: 1.5,
          },
        },
      },
    };
    const stepsCandidate = getComfyWorkflowControlCandidates(workflow).find(
      (candidate) => candidate.inputName === 'steps',
    );

    expect(stepsCandidate).toBeDefined();

    const control = {
      ...createComfyWorkflowControl('workflow_a', stepsCandidate!),
      value: 16,
    };
    const prompt = applyComfyWorkflowControls(workflow.prompt, [control], 'workflow_a');

    expect(prompt).toMatchObject({
      '3': {
        inputs: {
          steps: 16,
          cfg: 1.5,
        },
      },
    });
    expect(workflow.prompt['3']).toMatchObject({
      inputs: {
        steps: 8,
      },
    });
  });

  it('prepares random and incrementing numeric controls for a run', () => {
    const randomControl = {
      id: 'seed',
      workflowId: 'workflow_a',
      nodeId: '3',
      classType: 'KSampler',
      inputName: 'seed',
      label: 'Seed',
      value: 10,
      defaultValue: 10,
      min: 1,
      max: 100,
      step: 1,
      runMode: 'randomize' as const,
      randomMin: 7,
      randomMax: 7,
    };
    const incrementControl = {
      id: 'steps',
      workflowId: 'workflow_a',
      nodeId: '3',
      classType: 'KSampler',
      inputName: 'steps',
      label: 'Steps',
      value: 8,
      defaultValue: 8,
      min: 1,
      max: 32,
      step: 1,
      runMode: 'increment' as const,
      incrementStep: 2,
    };

    const prepared = prepareComfyWorkflowControlsForRun(
      [randomControl, incrementControl],
      'workflow_a',
    );

    expect(prepared.changed).toBe(true);
    expect(prepared.promptControls.find((control) => control.id === 'seed')?.value).toBe(7);
    expect(prepared.nextControls.find((control) => control.id === 'seed')?.value).toBe(7);
    expect(prepared.promptControls.find((control) => control.id === 'steps')?.value).toBe(8);
    expect(prepared.nextControls.find((control) => control.id === 'steps')?.value).toBe(10);
  });

  it('keeps legacy random range controls working', () => {
    const randomRangeControl = {
      id: 'seed',
      workflowId: 'workflow_a',
      nodeId: '3',
      classType: 'KSampler',
      inputName: 'seed',
      label: 'Seed',
      value: 10,
      defaultValue: 10,
      min: 1,
      max: 100,
      step: 1,
      runMode: 'randomRange' as const,
      randomMin: 5,
      randomMax: 5,
    };

    const prepared = prepareComfyWorkflowControlsForRun([randomRangeControl], 'workflow_a');

    expect(prepared.changed).toBe(true);
    expect(prepared.promptControls[0]?.value).toBe(5);
    expect(prepared.nextControls[0]?.value).toBe(5);
  });

  it('detects prompt-like comfy text inputs without flagging generic text metadata', () => {
    expect(
      isPromptLikeComfyTextInput({
        inputName: 'text',
        label: 'Text',
        classType: 'CLIPTextEncode',
        description: 'CLIPTextEncode · #6 · text',
      }),
    ).toBe(true);

    expect(
      isPromptLikeComfyTextInput({
        inputName: 'negative_prompt',
        label: 'Negative Prompt',
        classType: 'PromptBuilder',
        description: 'PromptBuilder · #9 · negative_prompt',
      }),
    ).toBe(true);

    expect(
      isPromptLikeComfyTextInput({
        inputName: 'ckpt_name',
        label: 'Checkpoint Name',
        classType: 'CheckpointLoaderSimple',
        description: 'CheckpointLoaderSimple · #3 · ckpt_name',
      }),
    ).toBe(false);

    expect(
      isPromptLikeComfyTextInput({
        inputName: 'metadata_url',
        label: 'Metadata URL',
        classType: 'WebLoader',
        description: 'WebLoader · #4 · metadata_url',
      }),
    ).toBe(false);

    expect(
      isPromptLikeComfyTextInput({
        inputName: 'asset_id',
        label: 'Asset ID',
        classType: 'SaveImageExtended',
        description: 'SaveImageExtended · #10 · asset_id',
      }),
    ).toBe(false);
  });
});
