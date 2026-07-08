import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  createBackgroundJob,
  loadPersistedBackgroundJobs,
  updateBackgroundJobById,
  type BackgroundJob,
} from './backgroundJobs';

const createStorage = (initial: Record<string, string> = {}) => {
  const store = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
  };
};

const STORAGE_KEY = 'blackboard-studio-background-jobs';

describe('backgroundJobs', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('applies durable defaults from the job spec', () => {
    const job = createBackgroundJob({
      type: 'onnx-download',
      title: 'Download model',
      status: 'queued',
    });

    expect(job.specVersion).toBe(1);
    expect(job.progress).toBe(0);
    expect(job.indeterminate).toBe(false);
    expect(job.cancellable).toBe(true);
    expect(job.attempt).toBe(0);
    expect(job.maxAttempts).toBe(3);
  });

  it('clamps progress updates', () => {
    const job = createBackgroundJob({
      id: 'render-1',
      type: 'render',
      title: 'Render',
      status: 'running',
    });

    const [updated] = updateBackgroundJobById([job], 'render-1', { progress: 250 });

    expect(updated.progress).toBe(100);
  });

  it('keeps persisted Comfy prompts resumable after reload', () => {
    const storage = createStorage({
      [STORAGE_KEY]: JSON.stringify([
        {
          id: 'comfy-1',
          type: 'comfy',
          title: 'Workflow',
          status: 'running',
          progress: 35,
          source: { promptId: 'prompt-1', nodeId: 'node-1' },
          startedAt: 10,
          updatedAt: 20,
        },
      ]),
    });
    vi.stubGlobal('localStorage', storage);

    const [job] = loadPersistedBackgroundJobs();

    expect(job.status).toBe('running');
    expect(job.detail).toBe('Reconnecting to ComfyUI...');
    expect(job.source?.restoredFromStorage).toBe(true);
    expect(job.cancellable).toBe(true);
  });

  it('marks non-resumable active jobs as interrupted after reload', () => {
    const storedJob: BackgroundJob = {
      id: 'render-1',
      type: 'render',
      title: 'Render',
      status: 'running',
      startedAt: 10,
      updatedAt: 20,
    };
    const storage = createStorage({ [STORAGE_KEY]: JSON.stringify([storedJob]) });
    vi.stubGlobal('localStorage', storage);

    const [job] = loadPersistedBackgroundJobs();

    expect(job.status).toBe('error');
    expect(job.error).toBe('Interrupted by app reload');
    expect(job.detail).toBe('Interrupted when the app was reloaded.');
    expect(job.completedAt).toBeDefined();
  });

  it('restores ONNX downloads only when restart payload is durable', () => {
    const storage = createStorage({
      [STORAGE_KEY]: JSON.stringify([
        {
          id: 'onnx-1',
          type: 'onnx-download',
          title: 'Download model',
          status: 'running',
          source: {
            modelId: 'generic:owner/repo:model.onnx',
            url: 'https://huggingface.co/owner/repo/resolve/main/model.onnx',
          },
          payload: {
            variant: {
              id: 'variant-1',
              label: 'Model',
              repoName: 'owner/repo',
              filePath: 'model.onnx',
            },
          },
          startedAt: 10,
          updatedAt: 20,
        },
      ]),
    });
    vi.stubGlobal('localStorage', storage);

    const [job] = loadPersistedBackgroundJobs();

    expect(job.status).toBe('queued');
    expect(job.detail).toBe('Ready to restart ONNX download');
    expect(job.source?.restoredFromStorage).toBe(true);
    expect(job.payload).toBeDefined();
  });
});
