export interface ComfyPromptRef {
  promptId: string;
  endpoint: string;
}

export class ComfyRunCoordinator {
  private readonly queues = new Map<string, Promise<void>>();

  private readonly latestPromptByEndpoint = new Map<string, ComfyPromptRef>();

  createClientId(): string {
    return `blackboard_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  async enqueue<T>(queueKey: string, task: () => Promise<T>): Promise<T> {
    const previousRun = this.queues.get(queueKey) ?? Promise.resolve();
    let releaseRun!: () => void;
    const currentRun = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    const queueTail = previousRun.catch(() => undefined).then(() => currentRun);
    this.queues.set(queueKey, queueTail);

    await previousRun.catch(() => undefined);

    try {
      return await task();
    } finally {
      releaseRun();
      if (this.queues.get(queueKey) === queueTail) {
        this.queues.delete(queueKey);
      }
    }
  }

  setLatestPrompt(endpoint: string, prompt: ComfyPromptRef): void {
    this.latestPromptByEndpoint.set(endpoint, prompt);
  }

  getLatestPrompt(endpoint: string): ComfyPromptRef | undefined {
    return this.latestPromptByEndpoint.get(endpoint);
  }
}

export const defaultComfyRunCoordinator = new ComfyRunCoordinator();
