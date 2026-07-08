import { describe, expect, it } from 'vitest';
import { NodeType, type AnyNode } from '@blackboard/types';
import {
  applyMediaColorAssignmentBatch,
  createPipelineMediaColorManagementOverride,
  createProjectDefaultMediaColorManagement,
  createUnassignedMediaColorManagement,
  createUserMediaColorManagement,
  createUserMediaColorManagementOverride,
  formatUnassignedMediaColorIssueMessage,
  getMediaColorAssignmentConflict,
  getUnassignedMediaColorIssues,
  isExplicitMediaColorAssignment,
  isDataColorSpace,
  resolveMediaColorManagementForSourceChange,
  resolveMediaColorManagementSourceChange,
  resolveMediaColorAssignmentPipeline,
  resetMediaColorManagementToAutomatic,
} from './media';

const colorSpaces = [
  { name: 'ACEScg', canonicalName: 'ACEScg', isData: false },
  { name: 'Raw', canonicalName: 'Raw', isData: true },
];

describe('media color management', () => {
  it('creates an explicit unassigned state', () => {
    expect(createUnassignedMediaColorManagement()).toEqual({
      sourceColorSpace: null,
      assignmentSource: 'unassigned',
      isData: false,
    });
  });

  it('creates project-default source assignments', () => {
    expect(createProjectDefaultMediaColorManagement('ACEScg')).toEqual({
      sourceColorSpace: 'ACEScg',
      assignmentSource: 'project_default',
      isData: false,
    });
  });

  it('creates user source assignments', () => {
    expect(createUserMediaColorManagement('Linear Rec.709 (sRGB)')).toEqual({
      sourceColorSpace: 'Linear Rec.709 (sRGB)',
      assignmentSource: 'user',
      isData: false,
    });
    expect(createUserMediaColorManagement('ARRI Wide Gamut 4 LogC4')).toEqual({
      sourceColorSpace: 'ARRI Wide Gamut 4 LogC4',
      assignmentSource: 'user',
      isData: false,
    });
    expect(createUserMediaColorManagement('Raw', { isData: true })).toEqual({
      sourceColorSpace: 'Raw',
      assignmentSource: 'user',
      isData: true,
    });
  });

  it('classifies data color spaces from OCIO metadata', () => {
    expect(isDataColorSpace(colorSpaces, 'Raw')).toBe(true);
    expect(isDataColorSpace(colorSpaces, 'ACEScg')).toBe(false);
  });

  it('resolves assignments in the documented priority order', () => {
    expect(
      resolveMediaColorAssignmentPipeline({
        user: { sourceColorSpace: 'ACEScct' },
        pipeline: { sourceColorSpace: 'ARRI Wide Gamut 4 LogC4' },
        metadata: { sourceColorSpace: 'ACEScg' },
        fileRule: { sourceColorSpace: 'ACES2065-1' },
        pathConvention: { sourceColorSpace: 'Linear Rec.709 (sRGB)' },
        projectDefault: { sourceColorSpace: 'sRGB Encoded Rec.709 (sRGB)' },
      }),
    ).toMatchObject({
      sourceColorSpace: 'ACEScct',
      assignmentSource: 'user',
      isData: false,
    });

    expect(
      resolveMediaColorAssignmentPipeline({
        pipeline: { sourceColorSpace: 'ARRI Wide Gamut 4 LogC4' },
        metadata: { sourceColorSpace: 'ACEScg' },
        fileRule: { sourceColorSpace: 'ACES2065-1' },
        projectDefault: { sourceColorSpace: 'sRGB Encoded Rec.709 (sRGB)' },
      }),
    ).toMatchObject({
      sourceColorSpace: 'ARRI Wide Gamut 4 LogC4',
      assignmentSource: 'pipeline',
      isData: false,
    });

    expect(
      resolveMediaColorAssignmentPipeline({
        metadata: { sourceColorSpace: 'ACEScg' },
        fileRule: { sourceColorSpace: 'ACES2065-1' },
        pathConvention: { sourceColorSpace: 'Linear Rec.709 (sRGB)' },
        projectDefault: { sourceColorSpace: 'sRGB Encoded Rec.709 (sRGB)' },
      }),
    ).toMatchObject({
      sourceColorSpace: 'ACEScg',
      assignmentSource: 'metadata',
      isData: false,
    });

    expect(
      resolveMediaColorAssignmentPipeline({
        pathConvention: { sourceColorSpace: 'Linear Rec.709 (sRGB)' },
        projectDefault: { sourceColorSpace: 'sRGB Encoded Rec.709 (sRGB)' },
      }),
    ).toMatchObject({
      sourceColorSpace: 'Linear Rec.709 (sRGB)',
      assignmentSource: 'path_convention',
      isData: false,
    });
  });

  it('falls back to unassigned when no assignment candidate has a source space', () => {
    expect(
      resolveMediaColorAssignmentPipeline({
        metadata: { sourceColorSpace: ' ' },
        projectDefault: null,
      }),
    ).toMatchObject({
      sourceColorSpace: null,
      assignmentSource: 'unassigned',
      isData: false,
    });
  });

  it('preserves explicit source assignments across source changes', () => {
    const manual = createUserMediaColorManagement('ARRI Wide Gamut 4 LogC4');
    const nextAutomatic = resolveMediaColorAssignmentPipeline({
      metadata: { sourceColorSpace: 'ACEScg', detail: 'chromaticities' },
    });

    expect(isExplicitMediaColorAssignment(manual)).toBe(true);
    expect(resolveMediaColorManagementForSourceChange(manual, nextAutomatic)).toEqual({
      ...manual,
      evidence: nextAutomatic.evidence,
    });
  });

  it('produces one synchronized source-change update for user and pipeline overrides', () => {
    const nextAutomatic = resolveMediaColorAssignmentPipeline({
      fileRule: {
        sourceColorSpace: 'ACES2065-1',
        detail: 'OCIO file rule: EXR',
        ruleName: 'EXR',
      },
    });

    expect(
      resolveMediaColorManagementSourceChange(
        createUserMediaColorManagement('ARRI Wide Gamut 4 LogC4'),
        nextAutomatic,
      ),
    ).toEqual({
      colorSpace: 'ARRI Wide Gamut 4 LogC4',
      mediaColorManagement: {
        sourceColorSpace: 'ARRI Wide Gamut 4 LogC4',
        assignmentSource: 'user',
        isData: false,
        evidence: nextAutomatic.evidence,
      },
    });
    expect(
      resolveMediaColorManagementSourceChange(
        resolveMediaColorAssignmentPipeline({
          pipeline: { sourceColorSpace: 'ACEScg' },
        }),
        nextAutomatic,
      ),
    ).toEqual({
      colorSpace: 'ACEScg',
      mediaColorManagement: {
        sourceColorSpace: 'ACEScg',
        assignmentSource: 'pipeline',
        isData: false,
        evidence: nextAutomatic.evidence,
      },
    });
  });

  it('clears synchronized source color when a path change has no automatic match', () => {
    expect(
      resolveMediaColorManagementSourceChange(
        resolveMediaColorAssignmentPipeline({
          fileRule: { sourceColorSpace: 'ACES2065-1' },
        }),
        createUnassignedMediaColorManagement(),
      ),
    ).toEqual({
      colorSpace: undefined,
      mediaColorManagement: {
        sourceColorSpace: null,
        assignmentSource: 'unassigned',
        isData: false,
      },
    });
  });

  it('models conflicting automatic candidates and resets a manual override', () => {
    const automatic = resolveMediaColorAssignmentPipeline({
      metadata: { sourceColorSpace: 'ACEScg', detail: 'EXR chromaticities' },
      fileRule: { sourceColorSpace: 'ACES2065-1', detail: 'aces_interchange' },
      pathConvention: { sourceColorSpace: 'Linear Rec.709 (sRGB)' },
      projectDefault: { sourceColorSpace: 'sRGB Encoded Rec.709 (sRGB)' },
    });
    const conflict = getMediaColorAssignmentConflict(automatic);
    const manual = createUserMediaColorManagementOverride(automatic, 'ACEScct');

    expect(automatic.evidence?.automatic).toEqual({
      sourceColorSpace: 'ACEScg',
      assignmentSource: 'metadata',
      isData: false,
      detail: 'EXR chromaticities',
    });
    expect(conflict?.colorSpaces).toEqual(['ACEScg', 'ACES2065-1', 'Linear Rec.709 (sRGB)']);
    expect(conflict?.candidates.map((candidate) => candidate.assignmentSource)).toEqual([
      'metadata',
      'file_rule',
      'path_convention',
    ]);
    expect(resetMediaColorManagementToAutomatic(manual)).toEqual(automatic);
  });

  it('resets a pipeline override to the detected file assignment', () => {
    const fileAssignment = resolveMediaColorAssignmentPipeline({
      fileRule: {
        sourceColorSpace: 'ACES2065-1',
        detail: 'OCIO file rule: EXR',
        ruleName: 'EXR',
      },
    });
    const pipelineOverride = createPipelineMediaColorManagementOverride(fileAssignment, 'ACEScg');

    expect(pipelineOverride).toMatchObject({
      sourceColorSpace: 'ACEScg',
      assignmentSource: 'pipeline',
      evidence: fileAssignment.evidence,
    });
    expect(resetMediaColorManagementToAutomatic(pipelineOverride)).toMatchObject({
      sourceColorSpace: 'ACES2065-1',
      assignmentSource: 'file_rule',
    });
  });

  it('reruns automatic source assignments after source changes', () => {
    const metadataAssignment = resolveMediaColorAssignmentPipeline({
      metadata: { sourceColorSpace: 'ACEScg' },
    });
    const nextAutomatic = createUnassignedMediaColorManagement();

    expect(isExplicitMediaColorAssignment(metadataAssignment)).toBe(false);
    expect(resolveMediaColorManagementForSourceChange(metadataAssignment, nextAutomatic)).toEqual({
      sourceColorSpace: null,
      assignmentSource: 'unassigned',
      isData: false,
    });
  });

  it('reports enabled referenced media with unassigned source color', () => {
    const nodes = [
      {
        id: 'plate-a',
        type: NodeType.MEDIA_SOURCE,
        name: 'Plate A',
        enabled: true,
        src: 'asset-a',
        sourceFileName: 'plate-a.exr',
        mediaColorManagement: createUnassignedMediaColorManagement(),
      },
      {
        id: 'plate-b',
        type: NodeType.MEDIA_SOURCE,
        name: 'Plate B',
        enabled: true,
        src: 'asset-b',
        sourceFileName: 'plate-b.png',
        mediaColorManagement: createProjectDefaultMediaColorManagement('ACEScg'),
      },
      {
        id: 'plate-c',
        type: NodeType.MEDIA_SOURCE,
        name: 'Plate C',
        enabled: false,
        src: 'asset-c',
        sourceFileName: 'plate-c.exr',
        mediaColorManagement: createUnassignedMediaColorManagement(),
      },
      {
        id: 'empty',
        type: NodeType.MEDIA_SOURCE,
        name: 'Empty',
        enabled: true,
        src: '',
        mediaColorManagement: createUnassignedMediaColorManagement(),
      },
    ] as AnyNode[];

    const issues = getUnassignedMediaColorIssues(nodes);

    expect(issues).toEqual([
      {
        nodeId: 'plate-a',
        nodeName: 'Plate A',
        sourceName: 'plate-a.exr',
        assignmentSource: 'unassigned',
      },
    ]);
    expect(formatUnassignedMediaColorIssueMessage(issues)).toBe(
      'Assign source color for plate-a.exr before export.',
    );
  });

  it('applies batch assignments to media records', () => {
    const records = applyMediaColorAssignmentBatch(
      [
        { id: 'plate-a', colorSpace: 'ACEScg' },
        { id: 'plate-b', colorSpace: 'ACEScg' },
      ],
      {
        sourceColorSpace: 'Raw',
        assignmentSource: 'user',
        isData: true,
      },
    );

    expect(records).toEqual([
      {
        id: 'plate-a',
        colorSpace: 'Raw',
        mediaColorManagement: {
          sourceColorSpace: 'Raw',
          assignmentSource: 'user',
          isData: true,
          evidence: {
            automatic: {
              sourceColorSpace: null,
              assignmentSource: 'unassigned',
              isData: false,
            },
            candidates: [],
          },
        },
      },
      {
        id: 'plate-b',
        colorSpace: 'Raw',
        mediaColorManagement: {
          sourceColorSpace: 'Raw',
          assignmentSource: 'user',
          isData: true,
          evidence: {
            automatic: {
              sourceColorSpace: null,
              assignmentSource: 'unassigned',
              isData: false,
            },
            candidates: [],
          },
        },
      },
    ]);
  });

  it('preserves each record automatic result during a batch manual assignment', () => {
    const metadata = resolveMediaColorAssignmentPipeline({
      metadata: { sourceColorSpace: 'ACEScg' },
    });
    const fileRule = resolveMediaColorAssignmentPipeline({
      fileRule: { sourceColorSpace: 'ACES2065-1' },
    });

    const records = applyMediaColorAssignmentBatch(
      [
        { id: 'plate-a', mediaColorManagement: metadata },
        { id: 'plate-b', mediaColorManagement: fileRule },
      ],
      {
        sourceColorSpace: 'Raw',
        assignmentSource: 'user',
        isData: true,
      },
    );

    expect(
      records.map((record) => resetMediaColorManagementToAutomatic(record.mediaColorManagement)),
    ).toEqual([metadata, fileRule]);
  });
});
