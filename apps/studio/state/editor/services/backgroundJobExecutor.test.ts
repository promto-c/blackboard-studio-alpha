import { describe, expect, it, vi } from 'vitest';
import {
  createBackgroundJobProgressUpdate,
  registerBackgroundJobCancelHandler,
  requestRegisteredBackgroundJobCancel,
  shouldRetryBackgroundJobFailure,
  type ExecutableBackgroundJob,
} from './backgroundJobExecutor';

describe('backgroundJobExecutor', () => {
  it('routes cancellation through registered executor handlers', () => {
    const cancel = vi.fn();
    const unregister = registerBackgroundJobCancelHandler('job-1', cancel);

    requestRegisteredBackgroundJobCancel('job-1');
    unregister();
    requestRegisteredBackgroundJobCancel('job-1');

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('normalizes byte progress into percent updates', () => {
    const update = createBackgroundJobProgressUpdate({
      label: 'Downloading weights.onnx',
      loaded: 25,
      total: 100,
      currentFile: { name: 'weights.onnx', loaded: 25, size: 100, index: 0, count: 1 },
    });

    expect(update.progress).toBe(25);
    expect(update.indeterminate).toBe(false);
    expect(update.detail).toBe('Downloading weights.onnx');
    expect(update.progressState?.currentFile?.name).toBe('weights.onnx');
  });

  it('uses typed retry policy phases', () => {
    const comfyJob: ExecutableBackgroundJob = {
      id: 'comfy-1',
      type: 'comfy',
      title: 'Workflow',
      status: 'running',
      attempt: 1,
      source: { promptId: 'prompt-1' },
    };

    expect(shouldRetryBackgroundJobFailure(comfyJob, { phase: 'waiting' })).toBe(true);
    expect(shouldRetryBackgroundJobFailure(comfyJob, { phase: 'applying' })).toBe(false);
  });
});
