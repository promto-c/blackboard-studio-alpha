import type {
  AutomaticMediaColorAssignmentSource,
  AnyNode,
  MediaColorAssignmentEvidence,
  MediaColorAssignmentEvidenceCandidate,
  MediaColorAssignmentSnapshot,
  MediaColorAssignmentSource,
  MediaColorManagement,
  OcioColorSpaceName,
} from '@blackboard/types';
import { ColorManagementDefaults } from './constants';
import type { ColorSpaceInfo } from './types';

export type MediaColorAssignment = {
  sourceColorSpace: OcioColorSpaceName | null;
  assignmentSource: MediaColorAssignmentSource;
  isData?: boolean;
};

export type MediaColorManagedRecord = {
  colorSpace?: OcioColorSpaceName;
  mediaColorManagement?: MediaColorManagement;
};

export type UnassignedMediaColorIssue = {
  nodeId: string;
  nodeName: string;
  sourceName: string;
  assignmentSource: 'unassigned';
};

export type MediaColorAssignmentCandidate = {
  sourceColorSpace?: OcioColorSpaceName | null;
  isData?: boolean;
  detail?: string;
  ruleName?: string;
  isDefaultRule?: boolean;
};

export type MediaColorAssignmentPipeline = {
  user?: MediaColorAssignmentCandidate | null;
  pipeline?: MediaColorAssignmentCandidate | null;
  decoder?: MediaColorAssignmentCandidate | null;
  metadata?: MediaColorAssignmentCandidate | null;
  fileRule?: MediaColorAssignmentCandidate | null;
  pathConvention?: MediaColorAssignmentCandidate | null;
  projectDefault?: MediaColorAssignmentCandidate | null;
};

const MEDIA_COLOR_ASSIGNMENT_STEPS = [
  ['user', 'user'],
  ['pipeline', 'pipeline'],
  ['decoder', 'decoder'],
  ['metadata', 'metadata'],
  ['fileRule', 'file_rule'],
  ['pathConvention', 'path_convention'],
  ['projectDefault', 'project_default'],
] as const satisfies readonly [
  keyof MediaColorAssignmentPipeline,
  Exclude<MediaColorAssignmentSource, 'unassigned'>,
][];

const AUTOMATIC_MEDIA_COLOR_ASSIGNMENT_STEPS = [
  ['decoder', 'decoder'],
  ['metadata', 'metadata'],
  ['fileRule', 'file_rule'],
  ['pathConvention', 'path_convention'],
  ['projectDefault', 'project_default'],
] as const satisfies readonly [
  keyof MediaColorAssignmentPipeline,
  Exclude<AutomaticMediaColorAssignmentSource, 'unassigned'>,
][];

const EXPLICIT_MEDIA_COLOR_ASSIGNMENT_SOURCES = new Set<MediaColorAssignmentSource>([
  'user',
  'pipeline',
]);

const normalizeSourceColorSpace = (
  sourceColorSpace: OcioColorSpaceName | null | undefined,
): OcioColorSpaceName | null => {
  const trimmed = sourceColorSpace?.trim();
  return trimmed ? trimmed : null;
};

const createAssignmentSnapshot = (
  sourceColorSpace: OcioColorSpaceName | null,
  assignmentSource: AutomaticMediaColorAssignmentSource,
  isData = false,
  provenance: Pick<
    MediaColorAssignmentEvidenceCandidate,
    'detail' | 'ruleName' | 'isDefaultRule'
  > = {},
): MediaColorAssignmentSnapshot => ({
  sourceColorSpace,
  assignmentSource,
  isData,
  ...(provenance.detail ? { detail: provenance.detail } : {}),
  ...(provenance.ruleName ? { ruleName: provenance.ruleName } : {}),
  ...(provenance.isDefaultRule !== undefined ? { isDefaultRule: provenance.isDefaultRule } : {}),
});

const collectAutomaticAssignmentCandidates = (
  pipeline: MediaColorAssignmentPipeline,
): MediaColorAssignmentEvidenceCandidate[] =>
  AUTOMATIC_MEDIA_COLOR_ASSIGNMENT_STEPS.flatMap(([key, assignmentSource]) => {
    const candidate = pipeline[key];
    const sourceColorSpace = normalizeSourceColorSpace(candidate?.sourceColorSpace);
    if (!sourceColorSpace) return [];
    return [
      {
        sourceColorSpace,
        assignmentSource,
        isData: candidate?.isData ?? false,
        ...(candidate?.detail?.trim() ? { detail: candidate.detail.trim() } : {}),
        ...(candidate?.ruleName?.trim() ? { ruleName: candidate.ruleName.trim() } : {}),
        ...(candidate?.isDefaultRule !== undefined
          ? { isDefaultRule: candidate.isDefaultRule }
          : {}),
      },
    ];
  });

const createAutomaticAssignmentEvidence = (
  pipeline: MediaColorAssignmentPipeline,
): MediaColorAssignmentEvidence => {
  const candidates = collectAutomaticAssignmentCandidates(pipeline);
  const selected = candidates[0];
  return {
    automatic: selected
      ? createAssignmentSnapshot(
          selected.sourceColorSpace,
          selected.assignmentSource,
          selected.isData,
          selected,
        )
      : createAssignmentSnapshot(null, 'unassigned'),
    candidates,
  };
};

export const createUnassignedMediaColorManagement = (
  options: { isData?: boolean } = {},
): MediaColorManagement => ({
  sourceColorSpace: null,
  assignmentSource: 'unassigned',
  isData: options.isData ?? false,
});

export const createMediaColorManagement = (
  assignment: Partial<MediaColorAssignment> = {},
): MediaColorManagement => {
  const sourceColorSpace = normalizeSourceColorSpace(assignment.sourceColorSpace);
  if (!sourceColorSpace) {
    return createUnassignedMediaColorManagement({ isData: assignment.isData });
  }

  return {
    sourceColorSpace,
    assignmentSource: assignment.assignmentSource ?? 'project_default',
    isData: assignment.isData ?? false,
  };
};

export const createAssignedMediaColorManagement = (
  sourceColorSpace: OcioColorSpaceName,
  assignmentSource: Exclude<MediaColorAssignmentSource, 'unassigned'>,
  options: { isData?: boolean } = {},
): MediaColorManagement =>
  createMediaColorManagement({
    sourceColorSpace,
    assignmentSource,
    isData: options.isData,
  });

export const createUserMediaColorManagement = (
  sourceColorSpace: OcioColorSpaceName,
  options: { isData?: boolean; evidence?: MediaColorAssignmentEvidence } = {},
): MediaColorManagement => ({
  ...createAssignedMediaColorManagement(sourceColorSpace, 'user', options),
  ...(options.evidence ? { evidence: options.evidence } : {}),
});

export const createProjectDefaultMediaColorManagement = (
  sourceColorSpace: OcioColorSpaceName = ColorManagementDefaults.TEXTURE_SPACE,
  options: { isData?: boolean } = {},
): MediaColorManagement =>
  createAssignedMediaColorManagement(sourceColorSpace, 'project_default', options);

export const resolveMediaColorAssignmentPipeline = (
  pipeline: MediaColorAssignmentPipeline = {},
): MediaColorManagement => {
  const evidence = createAutomaticAssignmentEvidence(pipeline);
  for (const [key, assignmentSource] of MEDIA_COLOR_ASSIGNMENT_STEPS) {
    const candidate = pipeline[key];
    const sourceColorSpace = normalizeSourceColorSpace(candidate?.sourceColorSpace);
    if (!sourceColorSpace) continue;

    return {
      ...createAssignedMediaColorManagement(sourceColorSpace, assignmentSource, {
        isData: candidate?.isData,
      }),
      evidence,
    };
  }

  return {
    ...createUnassignedMediaColorManagement(),
    evidence,
  };
};

export interface MediaColorAssignmentConflict {
  candidates: MediaColorAssignmentEvidenceCandidate[];
  colorSpaces: OcioColorSpaceName[];
}

export const getMediaColorAssignmentConflict = (
  colorManagement: MediaColorManagement | undefined,
): MediaColorAssignmentConflict | null => {
  const candidates =
    colorManagement?.evidence?.candidates.filter(
      (candidate) => candidate.assignmentSource !== 'project_default',
    ) ?? [];
  const colorSpaces = [...new Set(candidates.map((candidate) => candidate.sourceColorSpace))];
  return colorSpaces.length > 1 ? { candidates, colorSpaces } : null;
};

const getAutomaticAssignmentEvidence = (
  colorManagement: MediaColorManagement | undefined,
): MediaColorAssignmentEvidence => {
  if (colorManagement?.evidence) return colorManagement.evidence;
  if (colorManagement && !isExplicitMediaColorAssignment(colorManagement)) {
    return {
      automatic: createAssignmentSnapshot(
        colorManagement.sourceColorSpace,
        colorManagement.assignmentSource as AutomaticMediaColorAssignmentSource,
        colorManagement.isData,
      ),
      candidates: [],
    };
  }
  return {
    automatic: createAssignmentSnapshot(null, 'unassigned'),
    candidates: [],
  };
};

export const createUserMediaColorManagementOverride = (
  current: MediaColorManagement | undefined,
  sourceColorSpace: OcioColorSpaceName,
  options: { isData?: boolean } = {},
): MediaColorManagement =>
  createUserMediaColorManagement(sourceColorSpace, {
    isData: options.isData,
    evidence: getAutomaticAssignmentEvidence(current),
  });

export const createPipelineMediaColorManagementOverride = (
  current: MediaColorManagement | undefined,
  sourceColorSpace: OcioColorSpaceName,
  options: { isData?: boolean } = {},
): MediaColorManagement => ({
  ...createAssignedMediaColorManagement(sourceColorSpace, 'pipeline', options),
  evidence: getAutomaticAssignmentEvidence(current),
});

export const resetMediaColorManagementToAutomatic = (
  current: MediaColorManagement | undefined,
): MediaColorManagement => {
  const evidence = getAutomaticAssignmentEvidence(current);
  const { sourceColorSpace, assignmentSource, isData } = evidence.automatic;
  return {
    sourceColorSpace,
    assignmentSource,
    isData,
    evidence,
  };
};

export const getMediaSourceColorSpace = (
  colorManagement: MediaColorManagement | undefined,
): OcioColorSpaceName | undefined => colorManagement?.sourceColorSpace ?? undefined;

export const isDataMediaColorManagement = (
  colorManagement: MediaColorManagement | undefined,
): boolean => colorManagement?.isData === true;

const getNodeMediaReferenceName = (
  node: AnyNode & { sourceFileName?: string; src?: string; frames?: string[] },
): string | null => {
  if (Array.isArray(node.frames) && node.frames.some(Boolean)) {
    return node.sourceFileName?.trim() || node.name;
  }
  if (typeof node.src === 'string' && node.src.trim().length > 0) {
    return node.sourceFileName?.trim() || node.name;
  }
  return null;
};

export const getUnassignedMediaColorIssues = (
  nodes: readonly AnyNode[],
): UnassignedMediaColorIssue[] =>
  nodes.flatMap((node) => {
    if (node.enabled === false || !('mediaColorManagement' in node)) return [];
    const colorManagedNode = node as AnyNode &
      MediaColorManagedRecord & { sourceFileName?: string; src?: string; frames?: string[] };
    const sourceName = getNodeMediaReferenceName(colorManagedNode);
    if (!sourceName) return [];
    if (
      colorManagedNode.mediaColorManagement &&
      colorManagedNode.mediaColorManagement.assignmentSource !== 'unassigned'
    )
      return [];

    return [
      {
        nodeId: colorManagedNode.id,
        nodeName: colorManagedNode.name,
        sourceName,
        assignmentSource: 'unassigned',
      },
    ];
  });

export const formatUnassignedMediaColorIssueMessage = (
  issues: readonly UnassignedMediaColorIssue[],
): string | null => {
  if (issues.length === 0) return null;
  const visibleNames = issues.slice(0, 3).map((issue) => issue.sourceName);
  const remainder = issues.length - visibleNames.length;
  const sourceList = `${visibleNames.join(', ')}${remainder > 0 ? `, +${remainder} more` : ''}`;
  return `Assign source color for ${sourceList} before export.`;
};

export const isExplicitMediaColorAssignment = (
  colorManagement: MediaColorManagement | undefined,
): boolean =>
  !!colorManagement &&
  EXPLICIT_MEDIA_COLOR_ASSIGNMENT_SOURCES.has(colorManagement.assignmentSource);

export const resolveMediaColorManagementForSourceChange = (
  current: MediaColorManagement | undefined,
  automaticAssignment: MediaColorManagement,
): MediaColorManagement => {
  if (!isExplicitMediaColorAssignment(current)) {
    return automaticAssignment;
  }
  return {
    ...current,
    evidence: getAutomaticAssignmentEvidence(automaticAssignment),
  };
};

export type MediaColorManagementSourceChange = {
  colorSpace: OcioColorSpaceName | undefined;
  mediaColorManagement: MediaColorManagement;
};

export const resolveMediaColorManagementSourceChange = (
  current: MediaColorManagement | undefined,
  automaticAssignment: MediaColorManagement,
): MediaColorManagementSourceChange => {
  const mediaColorManagement = resolveMediaColorManagementForSourceChange(
    current,
    automaticAssignment,
  );
  return {
    colorSpace: getMediaSourceColorSpace(mediaColorManagement),
    mediaColorManagement,
  };
};

export const isDataColorSpace = (
  colorSpaces: readonly Pick<ColorSpaceInfo, 'name' | 'canonicalName' | 'isData'>[],
  colorSpaceName: OcioColorSpaceName | null | undefined,
): boolean => {
  const trimmed = colorSpaceName?.trim();
  if (!trimmed) return false;
  return (
    colorSpaces.find(
      (colorSpace) => colorSpace.name === trimmed || colorSpace.canonicalName === trimmed,
    )?.isData ?? false
  );
};

export const applyMediaColorAssignment = <T extends MediaColorManagedRecord>(
  record: T,
  assignment: MediaColorAssignment,
): T => {
  const mediaColorManagement =
    assignment.assignmentSource === 'user' && assignment.sourceColorSpace
      ? createUserMediaColorManagementOverride(
          record.mediaColorManagement,
          assignment.sourceColorSpace,
          {
            isData: assignment.isData,
          },
        )
      : createMediaColorManagement(assignment);
  return {
    ...record,
    mediaColorManagement,
    ...(mediaColorManagement.sourceColorSpace
      ? { colorSpace: mediaColorManagement.sourceColorSpace }
      : {}),
  };
};

export const applyMediaColorAssignmentBatch = <T extends MediaColorManagedRecord>(
  records: readonly T[],
  assignment: MediaColorAssignment,
): T[] => records.map((record) => applyMediaColorAssignment(record, assignment));
