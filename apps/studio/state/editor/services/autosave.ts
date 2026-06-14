import type { EditorState } from '@/state/editor/slices/types';
import {
  SCHEMA_VERSION,
  getProjectBranchStorageId,
  getProjectIndex,
  saveProject,
  saveProjectIndex,
  touchProjectBranch,
} from '@/state/persist';
import { buildPersistedProjectState } from '@/state/editor/projectSnapshots';

type DebouncedAsyncFunction = (() => void) & { flush: () => Promise<void> };

const debounceAsync = (task: () => Promise<void>, waitMs: number): DebouncedAsyncFunction => {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const debounced = (() => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      timeout = null;
      void task();
    }, waitMs);
  }) as DebouncedAsyncFunction;

  debounced.flush = async () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
    await task();
  };

  return debounced;
};

export const createProjectAutosave = (
  getSnapshot: () => EditorState,
  getReopenHistoryLimit?: () => number,
  getAutoCheckpointEnabled?: () => boolean,
  waitMs = 500,
): DebouncedAsyncFunction => {
  return debounceAsync(async () => {
    const snapshot = getSnapshot();
    const { projectId, activeProjectBranchId, thumbnail } = snapshot;

    if (!projectId) {
      return;
    }

    const timestamp = Date.now();
    const persistedState = buildPersistedProjectState(snapshot, {
      maxHistoryEntries: getReopenHistoryLimit?.(),
      checkpointLatestHistoryEntry: getAutoCheckpointEnabled?.(),
    });
    await saveProject(getProjectBranchStorageId(projectId, activeProjectBranchId), persistedState);
    touchProjectBranch(projectId, activeProjectBranchId, timestamp);

    const index = getProjectIndex();
    const nextIndex = index.map((entry) =>
      entry.id === projectId
        ? {
            ...entry,
            lastModified: timestamp,
            thumbnail: thumbnail ?? undefined,
            thumbnailAssetId: snapshot.thumbnailAssetId ?? entry.thumbnailAssetId,
            schemaVersion: SCHEMA_VERSION,
          }
        : entry,
    );
    saveProjectIndex(nextIndex);
  }, waitMs);
};
