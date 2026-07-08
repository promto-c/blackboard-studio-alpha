import type { GeneratedOutput } from '@blackboard/types';
import { getTagValue, type GalleryEntry } from '@blackboard/project-store';
import { MAIN_PROJECT_BRANCH_ID } from '@/state/projectBranches';

export interface ComfyGalleryOutputDeleteScope {
  projectId: string;
  branchId: string | null | undefined;
  nodeId: string;
}

const getOutputAssetIds = (output: Pick<GeneratedOutput, 'src' | 'frames'>): Set<string> =>
  new Set([output.src, ...(output.frames ?? [])].filter((assetId): assetId is string => !!assetId));

const getEntryBranchId = (entry: GalleryEntry): string =>
  getTagValue(entry.tags, 'branch:') ?? MAIN_PROJECT_BRANCH_ID;

export const galleryEntryMatchesComfyOutput = (
  entry: GalleryEntry,
  output: GeneratedOutput,
  scope: ComfyGalleryOutputDeleteScope,
): boolean => {
  if (entry.source !== 'Comfy') return false;
  if (entry.deletedAt) return false;
  if (getTagValue(entry.tags, 'project:') !== scope.projectId) return false;
  if (getEntryBranchId(entry) !== (scope.branchId || MAIN_PROJECT_BRANCH_ID)) return false;
  if (getTagValue(entry.tags, 'node:') !== scope.nodeId) return false;
  if (entry.outputId && entry.outputId === output.id) return true;
  return getOutputAssetIds(output).has(entry.assetId);
};

export const getComfyGalleryEntriesForOutputDelete = ({
  entries,
  outputs,
  scope,
}: {
  entries: readonly GalleryEntry[];
  outputs: readonly GeneratedOutput[];
  scope: ComfyGalleryOutputDeleteScope;
}): GalleryEntry[] => {
  if (outputs.length === 0) return [];
  return entries.filter((entry) =>
    outputs.some((output) => galleryEntryMatchesComfyOutput(entry, output, scope)),
  );
};
