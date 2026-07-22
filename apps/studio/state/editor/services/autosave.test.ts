import { describe, expect, it, vi } from 'vitest';
import type { EditorState } from '@/state/editor/slices/types';
import { createProjectAutosave } from './autosave';

describe('project autosave flushing', () => {
  it('does not create a new saved revision when no autosave is pending', async () => {
    const getSnapshot = vi.fn<() => EditorState>();
    const autosave = createProjectAutosave(getSnapshot);

    await autosave.flush();

    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it('flushes a pending autosave exactly once', async () => {
    const getSnapshot = vi.fn(
      () =>
        ({
          projectId: null,
        }) as EditorState,
    );
    const autosave = createProjectAutosave(getSnapshot, undefined, undefined, 10_000);

    autosave();
    await autosave.flush();
    await autosave.flush();

    expect(getSnapshot).toHaveBeenCalledTimes(1);
  });
});
