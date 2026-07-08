import { createAbortError } from './assetPreviewScheduler';
import type { AssetPreviewLease, AssetPreviewResult } from './types';

interface PreviewCacheEntry {
  promise: Promise<AssetPreviewResult>;
  value: AssetPreviewResult | null;
  controller: AbortController;
  references: number;
}

export class AssetPreviewCache {
  private readonly entries = new Map<string, PreviewCacheEntry>();

  constructor(private readonly limit = 96) {}

  acquire(
    key: string,
    load: (signal: AbortSignal) => Promise<AssetPreviewResult>,
    consumerSignal?: AbortSignal,
  ): AssetPreviewLease {
    if (consumerSignal?.aborted) {
      return { promise: Promise.reject(createAbortError()), release: () => undefined };
    }

    let entry = this.entries.get(key);
    if (!entry) {
      const controller = new AbortController();
      entry = {
        controller,
        references: 0,
        value: null,
        promise: Promise.resolve(null as never),
      };
      const createdEntry = entry;
      createdEntry.promise = Promise.resolve()
        .then(() => load(controller.signal))
        .then((value) => {
          createdEntry.value = value;
          this.touch(key, createdEntry);
          this.evict();
          return value;
        })
        .catch((error) => {
          if (this.entries.get(key) === createdEntry) {
            this.entries.delete(key);
          }
          throw error;
        });
      this.entries.set(key, createdEntry);
    } else {
      this.touch(key, entry);
    }
    entry.references += 1;

    let released = false;
    let rejectCancellation: ((reason: unknown) => void) | null = null;
    const cancellation = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject;
    });
    const handleAbort = () => {
      release();
      rejectCancellation?.(createAbortError());
    };
    consumerSignal?.addEventListener('abort', handleAbort, { once: true });

    const release = () => {
      if (released) return;
      released = true;
      consumerSignal?.removeEventListener('abort', handleAbort);
      entry!.references = Math.max(0, entry!.references - 1);
      if (entry!.references === 0 && !entry!.value) {
        entry!.controller.abort();
        if (this.entries.get(key) === entry) {
          this.entries.delete(key);
        }
      }
      this.evict();
    };

    return {
      promise: consumerSignal ? Promise.race([entry.promise, cancellation]) : entry.promise,
      release,
    };
  }

  get size(): number {
    return this.entries.size;
  }

  clearForTests(): void {
    for (const entry of this.entries.values()) {
      entry.controller.abort();
      if (entry.value) URL.revokeObjectURL(entry.value.url);
    }
    this.entries.clear();
  }

  private touch(key: string, entry: PreviewCacheEntry): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  private evict(): void {
    while (this.entries.size > this.limit) {
      const candidate = [...this.entries].find(
        ([, entry]) => entry.references === 0 && entry.value !== null,
      );
      if (!candidate) return;
      const [key, entry] = candidate;
      this.entries.delete(key);
      URL.revokeObjectURL(entry.value!.url);
    }
  }
}

export const assetPreviewCache = new AssetPreviewCache();
