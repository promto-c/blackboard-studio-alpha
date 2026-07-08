import { describe, expect, it, vi } from 'vitest';
import { PreviewRenderScheduler } from './assetPreviewScheduler';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('PreviewRenderScheduler', () => {
  it('orders viewer, visible, then prefetch work after the active job', async () => {
    const scheduler = new PreviewRenderScheduler();
    const active = deferred<void>();
    const order: string[] = [];
    const first = scheduler.schedule(() => active.promise, { priority: 'prefetch-thumbnail' });
    const prefetch = scheduler.schedule(async () => order.push('prefetch') as never, {
      priority: 'prefetch-thumbnail',
    });
    const visible = scheduler.schedule(async () => order.push('visible') as never, {
      priority: 'visible-thumbnail',
    });
    const viewer = scheduler.schedule(async () => order.push('viewer') as never, {
      priority: 'viewer',
    });

    active.resolve();
    await Promise.all([first, prefetch, visible, viewer]);
    expect(order).toEqual(['viewer', 'visible', 'prefetch']);
    expect(scheduler.size).toBe(0);
  });

  it('removes canceled queued jobs and continues after failures', async () => {
    const scheduler = new PreviewRenderScheduler();
    const active = deferred<void>();
    const first = scheduler.schedule(() => active.promise, { priority: 'viewer' });
    const controller = new AbortController();
    const canceledRun = vi.fn(async () => undefined);
    const canceled = scheduler.schedule(canceledRun, {
      priority: 'visible-thumbnail',
      signal: controller.signal,
    });
    const failure = scheduler.schedule(
      async () => {
        throw new Error('bad frame');
      },
      { priority: 'visible-thumbnail' },
    );
    const afterFailure = vi.fn(async () => undefined);
    const final = scheduler.schedule(afterFailure, { priority: 'prefetch-thumbnail' });

    controller.abort();
    active.resolve();
    await first;
    await expect(canceled).rejects.toMatchObject({ name: 'AbortError' });
    await expect(failure).rejects.toThrow('bad frame');
    await final;
    expect(canceledRun).not.toHaveBeenCalled();
    expect(afterFailure).toHaveBeenCalledOnce();
    expect(scheduler.size).toBe(0);
  });

  it('discards the result of active work canceled after it starts', async () => {
    const scheduler = new PreviewRenderScheduler();
    const active = deferred<string>();
    const controller = new AbortController();
    const scheduled = scheduler.schedule(() => active.promise, {
      priority: 'viewer',
      signal: controller.signal,
    });
    controller.abort();
    active.resolve('obsolete pixels');
    await expect(scheduled).rejects.toMatchObject({ name: 'AbortError' });
    expect(scheduler.size).toBe(0);
  });
});
