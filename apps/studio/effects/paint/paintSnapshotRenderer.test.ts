import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createStudioRendererMock } = vi.hoisted(() => ({
  createStudioRendererMock: vi.fn(),
}));

vi.mock('@blackboard/renderer', () => ({
  createStudioRenderer: createStudioRendererMock,
}));

import {
  resetSharedPaintSnapshotRendererForTests,
  withSharedPaintSnapshotRenderer,
} from './paintSnapshotRenderer';

describe('paintSnapshotRenderer', () => {
  beforeEach(() => {
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({})),
    });
  });

  afterEach(() => {
    resetSharedPaintSnapshotRendererForTests();
    createStudioRendererMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('reuses a single renderer across snapshot requests', async () => {
    const renderer = { dispose: vi.fn() } as unknown;
    createStudioRendererMock.mockReturnValue(renderer);

    const seenRenderers: unknown[] = [];

    await withSharedPaintSnapshotRenderer(async (sharedRenderer) => {
      seenRenderers.push(sharedRenderer);
      return null;
    });
    await withSharedPaintSnapshotRenderer(async (sharedRenderer) => {
      seenRenderers.push(sharedRenderer);
      return null;
    });

    expect(createStudioRendererMock).toHaveBeenCalledTimes(1);
    expect(seenRenderers).toEqual([renderer, renderer]);
  });

  it('serializes snapshot work on the shared renderer', async () => {
    const renderer = { dispose: vi.fn() } as unknown;
    createStudioRendererMock.mockReturnValue(renderer);

    const events: string[] = [];
    let releaseFirstRender!: () => void;

    const firstRender = withSharedPaintSnapshotRenderer(async (sharedRenderer) => {
      events.push(`first:${(sharedRenderer as unknown) === renderer ? 'shared' : 'unexpected'}`);
      await new Promise<void>((resolve) => {
        releaseFirstRender = () => {
          events.push('first:release');
          resolve();
        };
      });
      events.push('first:done');
      return null;
    });

    const secondRender = withSharedPaintSnapshotRenderer(async (sharedRenderer) => {
      events.push(`second:${(sharedRenderer as unknown) === renderer ? 'shared' : 'unexpected'}`);
      return null;
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(events).toEqual(['first:shared']);

    releaseFirstRender();
    await Promise.all([firstRender, secondRender]);

    expect(events).toEqual(['first:shared', 'first:release', 'first:done', 'second:shared']);
    expect(createStudioRendererMock).toHaveBeenCalledTimes(1);
  });
});
