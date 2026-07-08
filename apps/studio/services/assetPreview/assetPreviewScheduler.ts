import type { PreviewPriority } from './types';

const PRIORITY_ORDER: Record<PreviewPriority, number> = {
  viewer: 0,
  'visible-thumbnail': 1,
  'prefetch-thumbnail': 2,
};

export const createAbortError = (): DOMException =>
  new DOMException('The preview request was canceled.', 'AbortError');

export const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'AbortError';

interface QueuedJob<T> {
  id: number;
  priority: PreviewPriority;
  run: (signal: AbortSignal) => Promise<T>;
  controller: AbortController;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  removeExternalAbortListener?: () => void;
}

export class PreviewRenderScheduler {
  private queue: QueuedJob<unknown>[] = [];
  private running = 0;
  private nextId = 1;

  constructor(private readonly concurrency = 1) {}

  schedule<T>(
    run: (signal: AbortSignal) => Promise<T>,
    options: { priority: PreviewPriority; signal?: AbortSignal },
  ): Promise<T> {
    if (options.signal?.aborted) return Promise.reject(createAbortError());

    return new Promise<T>((resolve, reject) => {
      const controller = new AbortController();
      const job: QueuedJob<T> = {
        id: this.nextId++,
        priority: options.priority,
        run,
        controller,
        resolve,
        reject,
      };
      const handleExternalAbort = () => {
        controller.abort();
        const index = this.queue.indexOf(job as QueuedJob<unknown>);
        if (index >= 0) {
          this.queue.splice(index, 1);
          job.removeExternalAbortListener?.();
          reject(createAbortError());
        }
      };
      if (options.signal) {
        options.signal.addEventListener('abort', handleExternalAbort, { once: true });
        job.removeExternalAbortListener = () =>
          options.signal?.removeEventListener('abort', handleExternalAbort);
      }

      this.queue.push(job as QueuedJob<unknown>);
      this.queue.sort(
        (left, right) =>
          PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority] || left.id - right.id,
      );
      this.drain();
    });
  }

  get size(): number {
    return this.queue.length + this.running;
  }

  cancelQueued(): void {
    const queued = this.queue.splice(0);
    queued.forEach((job) => {
      job.controller.abort();
      job.removeExternalAbortListener?.();
      job.reject(createAbortError());
    });
  }

  resetForTests(): void {
    this.cancelQueued();
  }

  private drain(): void {
    while (this.running < this.concurrency) {
      const job = this.queue.shift();
      if (!job) return;
      if (job.controller.signal.aborted) {
        job.removeExternalAbortListener?.();
        job.reject(createAbortError());
        continue;
      }

      this.running += 1;
      void (async () => {
        try {
          const value = await job.run(job.controller.signal);
          if (job.controller.signal.aborted) {
            throw createAbortError();
          }
          job.removeExternalAbortListener?.();
          this.running -= 1;
          this.drain();
          job.resolve(value);
        } catch (error) {
          job.removeExternalAbortListener?.();
          this.running -= 1;
          this.drain();
          job.reject(error);
        }
      })();
    }
  }
}

export const assetPreviewScheduler = new PreviewRenderScheduler(1);
