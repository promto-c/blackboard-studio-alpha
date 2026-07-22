import { Badge } from '@blackboard/ui';
import type { ProjectStorageMode } from '@blackboard/types';

interface ProjectStorageBadgeProps {
  mode: ProjectStorageMode;
  mountId: string;
  mountName?: string;
  connected?: boolean;
}

export default function ProjectStorageBadge({
  mode,
  mountId,
  mountName,
  connected,
}: ProjectStorageBadgeProps) {
  const isBrowserClone = mode === 'local-clone';
  const location = mountName ?? mountId;
  const connectionStatus = connected === false ? 'Mount unavailable' : 'Mount connected';
  const behavior = isBrowserClone
    ? 'Edits stay in this browser until you pull or push a snapshot.'
    : 'Edits autosave directly to this mount.';

  return (
    <Badge
      size="sm"
      variant={connected === false ? 'warning' : 'accent'}
      shrink
      className="max-w-[8rem]"
      title={`${isBrowserClone ? 'Browser working copy' : 'Direct mounted project'}\nMount: ${location}\n${connectionStatus}\n${behavior}\nMount ID: ${mountId}`}
    >
      {isBrowserClone ? 'Browser clone' : 'Direct mount'}
    </Badge>
  );
}
