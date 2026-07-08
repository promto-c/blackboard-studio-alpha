import React from 'react';
import * as Icons from '@blackboard/icons';
import type { AnyNode, MediaColorAssignmentSource, MediaColorManagement } from '@blackboard/types';
import { OcioColorSpaceDropdown } from './OcioColorSpaceDropdown';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import { useOcio } from '@/state/ocioContext';
import {
  applyMediaColorAssignment,
  getMediaColorAssignmentConflict,
  getMediaSourceColorSpace,
  isDataColorSpace,
  isDataMediaColorManagement,
  isExplicitMediaColorAssignment,
  resetMediaColorManagementToAutomatic,
  type MediaColorManagedRecord,
} from '@/color-management';

type AssignableMediaNode = AnyNode & MediaColorManagedRecord;

export interface MediaColorManagementControlsProps {
  value: MediaColorManagement | undefined;
  onChange: (value: MediaColorManagement) => void;
  batchCount?: number;
}

const ASSIGNMENT_SOURCE_LABELS: Record<MediaColorAssignmentSource, string> = {
  user: 'Manual',
  pipeline: 'Pipeline',
  decoder: 'Decoder output',
  metadata: 'Metadata',
  file_rule: 'OCIO file rule',
  path_convention: 'Path convention',
  project_default: 'Project default',
  unassigned: 'Unassigned',
};

const isAssignableMediaNode = (node: AnyNode): node is AssignableMediaNode =>
  'mediaColorManagement' in node;

const getTransformPath = (
  colorManagement: MediaColorManagement | undefined,
  workingColorSpace: string,
): string => {
  const sourceColorSpace = getMediaSourceColorSpace(colorManagement);
  if (!sourceColorSpace) return 'Blocked until assigned';
  if (isDataMediaColorManagement(colorManagement)) return 'Data bypass';
  if (sourceColorSpace === workingColorSpace) return `${workingColorSpace} (no transform)`;
  return `${sourceColorSpace} -> ${workingColorSpace}`;
};

export function MediaColorManagementControls({
  value,
  onChange,
  batchCount = 1,
}: MediaColorManagementControlsProps) {
  const ocio = useOcio();
  const colorManagement = value;
  const sourceColorSpace = getMediaSourceColorSpace(colorManagement);
  const conflict = getMediaColorAssignmentConflict(colorManagement);

  const handleColorSpaceChange = (sourceColorSpace: string) => {
    onChange(
      applyMediaColorAssignment(
        { mediaColorManagement: colorManagement },
        {
          sourceColorSpace,
          assignmentSource: 'user',
          isData: isDataColorSpace(ocio.colorSpaces, sourceColorSpace),
        },
      ).mediaColorManagement!,
    );
  };

  const handleReset = () => {
    onChange(resetMediaColorManagementToAutomatic(colorManagement));
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3 text-[11px]">
          <span className="text-gray-500">Assignment</span>
          <span className="text-right text-gray-300">
            {ASSIGNMENT_SOURCE_LABELS[colorManagement?.assignmentSource ?? 'unassigned']}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 text-[11px]">
          <span className="text-gray-500">Data</span>
          <span className="text-right text-gray-300">
            {isDataMediaColorManagement(colorManagement) ? 'Yes - RGB bypassed' : 'No'}
          </span>
        </div>
        <div className="flex items-start justify-between gap-3 text-[11px]">
          <span className="shrink-0 text-gray-500">Transform</span>
          <span className="min-w-0 break-words text-right font-mono text-gray-300">
            {getTransformPath(colorManagement, ocio.workingColorSpace)}
          </span>
        </div>
      </div>

      {conflict ? (
        <div className="rounded border border-amber-400/20 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-5 text-amber-100">
          Automatic sources disagree: {conflict.colorSpaces.join(', ')}
        </div>
      ) : null}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs font-medium text-gray-400">Input Color Space</label>
          {isExplicitMediaColorAssignment(colorManagement) ? (
            <button
              type="button"
              onClick={handleReset}
              title="Reset to current automatic assignment"
              className="inline-flex h-7 w-7 items-center justify-center rounded text-gray-400 transition hover:bg-white/10 hover:text-gray-100"
            >
              <Icons.Reset className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        <OcioColorSpaceDropdown
          value={sourceColorSpace}
          onChange={handleColorSpaceChange}
          includeData
        />
        {batchCount > 1 ? (
          <p className="text-[10px] text-gray-500">
            Changes apply to {batchCount} selected media sources.
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function MediaColorManagementInspector({ node }: { node: AssignableMediaNode }) {
  const nodes = useEditorSelector((state) => state.nodes);
  const selectedNodeIds = useEditorSelector((state) => state.selectedNodeIds ?? []);
  const { batchUpdateNodes } = useEditorActions();
  const selectedMediaNodeIds = React.useMemo(() => {
    if (!selectedNodeIds.includes(node.id)) return [node.id];
    const selectedIdSet = new Set(selectedNodeIds);
    return nodes
      .filter((candidate) => selectedIdSet.has(candidate.id) && isAssignableMediaNode(candidate))
      .map((candidate) => candidate.id);
  }, [node.id, nodes, selectedNodeIds]);

  const updateSelectedMedia = (nextValue: MediaColorManagement): void => {
    batchUpdateNodes(
      selectedMediaNodeIds,
      (target) => {
        if (!isAssignableMediaNode(target)) return {};
        const mediaColorManagement =
          nextValue.assignmentSource === 'user' && nextValue.sourceColorSpace
            ? applyMediaColorAssignment(target, {
                sourceColorSpace: nextValue.sourceColorSpace,
                assignmentSource: 'user',
                isData: nextValue.isData,
              }).mediaColorManagement!
            : resetMediaColorManagementToAutomatic(target.mediaColorManagement);
        return {
          colorSpace: getMediaSourceColorSpace(mediaColorManagement),
          mediaColorManagement,
        };
      },
      true,
    );
  };

  return (
    <MediaColorManagementControls
      value={node.mediaColorManagement}
      onChange={updateSelectedMedia}
      batchCount={selectedMediaNodeIds.length}
    />
  );
}
