import { describe, expect, it, vi } from 'vitest';
import { ComfyPromptInputValidationError } from '@/services/comfy/client';
import {
  queueComfyPromptWithInputRecovery,
  type ComfyQueuedInputUpload,
} from './comfyPromptQueueRecovery';

describe('queueComfyPromptWithInputRecovery', () => {
  it('queues without retry when cached inputs are still valid', async () => {
    const inputImages: ComfyQueuedInputUpload[] = [
      { imageName: 'blackboard/input.png', cacheHit: true },
    ];
    const uploadInputs = vi.fn().mockResolvedValue(inputImages);
    const queuePrompt = vi.fn().mockResolvedValue({ promptId: 'prompt-1' });

    await expect(
      queueComfyPromptWithInputRecovery({
        initialPromptId: 'prompt-1',
        uploadInputs,
        createPrompt: (uploads) => ({ uploads }),
        queuePrompt,
        invalidateCachedImage: vi.fn(),
        createPromptId: () => 'prompt-2',
      }),
    ).resolves.toEqual({ queued: { promptId: 'prompt-1' }, inputImages });

    expect(uploadInputs).toHaveBeenCalledOnce();
    expect(queuePrompt).toHaveBeenCalledWith({ uploads: inputImages }, 'prompt-1');
  });

  it('invalidates stale cached inputs, cancels an accepted partial prompt, and retries', async () => {
    const firstInputs: ComfyQueuedInputUpload[] = [
      { imageName: 'blackboard/missing.png', cacheHit: true },
      { imageName: 'blackboard/fresh.png', cacheHit: false },
    ];
    const retryInputs: ComfyQueuedInputUpload[] = [
      { imageName: 'blackboard/reuploaded.png', cacheHit: false },
      { imageName: 'blackboard/fresh.png', cacheHit: false },
    ];
    const uploadInputs = vi
      .fn()
      .mockResolvedValueOnce(firstInputs)
      .mockResolvedValueOnce(retryInputs);
    const queuePrompt = vi
      .fn()
      .mockRejectedValueOnce(
        new ComfyPromptInputValidationError(
          'Prompt outputs failed validation',
          ['blackboard/missing.png'],
          'accepted-partial-prompt',
        ),
      )
      .mockResolvedValueOnce({ promptId: 'retry-prompt' });
    const invalidateCachedImage = vi.fn();
    const cancelAcceptedPrompt = vi.fn().mockResolvedValue(undefined);

    await expect(
      queueComfyPromptWithInputRecovery({
        initialPromptId: 'initial-prompt',
        uploadInputs,
        createPrompt: (uploads) => ({ uploads }),
        queuePrompt,
        invalidateCachedImage,
        cancelAcceptedPrompt,
        createPromptId: () => 'new-prompt',
      }),
    ).resolves.toEqual({ queued: { promptId: 'retry-prompt' }, inputImages: retryInputs });

    expect(cancelAcceptedPrompt).toHaveBeenCalledWith('accepted-partial-prompt');
    expect(invalidateCachedImage).toHaveBeenCalledWith('blackboard/missing.png');
    expect(uploadInputs).toHaveBeenLastCalledWith({
      forceUploadImageNames: new Set(['blackboard/missing.png']),
    });
    expect(queuePrompt).toHaveBeenNthCalledWith(1, { uploads: firstInputs }, 'initial-prompt');
    expect(queuePrompt).toHaveBeenNthCalledWith(2, { uploads: retryInputs }, 'new-prompt');
  });

  it('does not retry validation errors for inputs that did not come from cache', async () => {
    const inputImages: ComfyQueuedInputUpload[] = [
      { imageName: 'blackboard/missing.png', cacheHit: false },
    ];
    const error = new ComfyPromptInputValidationError('Prompt outputs failed validation', [
      'blackboard/missing.png',
    ]);

    await expect(
      queueComfyPromptWithInputRecovery({
        initialPromptId: 'prompt-1',
        uploadInputs: vi.fn().mockResolvedValue(inputImages),
        createPrompt: (uploads) => ({ uploads }),
        queuePrompt: vi.fn().mockRejectedValue(error),
        invalidateCachedImage: vi.fn(),
        createPromptId: () => 'prompt-2',
      }),
    ).rejects.toBe(error);
  });
});
