import type { HistoryEntry } from '@blackboard/types';

/**
 * Check whether a history entry has been explicitly marked as a checkpoint
 * by the user (or auto-checkpointed). A checkpoint entry has a non-empty
 * `checkpointLabel` string.
 */
export const isCheckpointEntry = (entry: HistoryEntry): boolean =>
  typeof entry.checkpointLabel === 'string' && entry.checkpointLabel.trim().length > 0;
