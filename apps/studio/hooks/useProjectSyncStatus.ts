import { useCallback, useEffect, useState } from 'react';
import {
  getProjectSyncStatus,
  subscribeToProjectStorage,
  subscribeToStorageMounts,
  type ProjectSyncStatus,
} from '@blackboard/project-store';

export function useProjectSyncStatus(projectId: string | null, pollIntervalMs = 30_000) {
  const [status, setStatus] = useState<ProjectSyncStatus | null>(null);

  const refresh = useCallback(async () => {
    const nextStatus = projectId ? await getProjectSyncStatus(projectId) : null;
    setStatus(nextStatus);
    return nextStatus;
  }, [projectId]);

  useEffect(() => {
    let active = true;
    const refreshWhileActive = async () => {
      const nextStatus = projectId ? await getProjectSyncStatus(projectId) : null;
      if (active) setStatus(nextStatus);
    };

    void refreshWhileActive();
    const unsubscribeProject = subscribeToProjectStorage(() => void refreshWhileActive());
    const unsubscribeMounts = subscribeToStorageMounts(() => void refreshWhileActive());
    const pollId = projectId
      ? window.setInterval(() => void refreshWhileActive(), pollIntervalMs)
      : undefined;
    const handleFocus = () => void refreshWhileActive();
    window.addEventListener('focus', handleFocus);

    return () => {
      active = false;
      unsubscribeProject();
      unsubscribeMounts();
      if (pollId !== undefined) window.clearInterval(pollId);
      window.removeEventListener('focus', handleFocus);
    };
  }, [pollIntervalMs, projectId]);

  return { status, refresh };
}
