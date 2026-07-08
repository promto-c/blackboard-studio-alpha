import { NodeType, type MatchMoveNode } from '@blackboard/types';
import * as Icons from '@blackboard/icons';
import type { NodeDefinition } from '@/nodes/NodeDefinition';
import { MEDIA_SOURCE_UPSTREAM } from '@/utils/mediaSourceSelection';
import MatchMoveAdjustments from './MatchMoveAdjustments';
import MatchMoveOverlay from './MatchMoveOverlay';
import { MatchMoveTool } from './MatchMoveTool';

const DEFAULT_TRACKING: MatchMoveNode['tracking'] = {
  sourceId: MEDIA_SOURCE_UPSTREAM,
  startFrame: 0,
  endFrame: 90,
  maxFeatures: 180,
  minFeatureDistance: 24,
  featureQuality: 0.035,
  patchSize: 9,
  maxTrackError: 8,
};

const DEFAULT_SOLVE: MatchMoveNode['solve'] = {
  mode: 'planar',
  model: 'homography',
  ransacThreshold: 2.5,
  minTrackFrames: 8,
};

const DEFAULT_CAMERA: MatchMoveNode['camera'] = {
  focalLengthMm: 35,
  sensorWidthMm: 36,
  principalPoint: { x: 0, y: 0 },
  lensDistortionModel: 'none',
  surveyScale: 1,
};

const DEFAULT_DISPLAY: MatchMoveNode['display'] = {
  showFeatures: true,
  showTrails: true,
  trailLength: 30,
  colorByError: true,
};

const finiteNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const normalizeTracking = (tracking: Partial<MatchMoveNode['tracking']> | undefined) => ({
  ...DEFAULT_TRACKING,
  ...tracking,
  sourceId: typeof tracking?.sourceId === 'string' ? tracking.sourceId : DEFAULT_TRACKING.sourceId,
  startFrame: Math.max(0, Math.round(finiteNumber(tracking?.startFrame, 0))),
  endFrame: Math.max(0, Math.round(finiteNumber(tracking?.endFrame, DEFAULT_TRACKING.endFrame))),
  maxFeatures: Math.round(clamp(finiteNumber(tracking?.maxFeatures, 180), 4, 2000)),
  minFeatureDistance: Math.round(clamp(finiteNumber(tracking?.minFeatureDistance, 24), 4, 200)),
  featureQuality: clamp(finiteNumber(tracking?.featureQuality, 0.035), 0.001, 1),
  patchSize: Math.round(clamp(finiteNumber(tracking?.patchSize, 9), 5, 31)),
  maxTrackError: clamp(finiteNumber(tracking?.maxTrackError, 8), 0.1, 100),
});

const normalizeSolve = (solve: Partial<MatchMoveNode['solve']> | undefined) => ({
  ...DEFAULT_SOLVE,
  ...solve,
  mode:
    solve?.mode === 'track_2d' || solve?.mode === 'planar' || solve?.mode === 'camera_3d'
      ? solve.mode
      : DEFAULT_SOLVE.mode,
  model:
    solve?.model === 'translation' ||
    solve?.model === 'similarity' ||
    solve?.model === 'affine' ||
    solve?.model === 'homography'
      ? solve.model
      : DEFAULT_SOLVE.model,
  ransacThreshold: clamp(finiteNumber(solve?.ransacThreshold, 2.5), 0.1, 50),
  minTrackFrames: Math.max(1, Math.round(finiteNumber(solve?.minTrackFrames, 8))),
});

const normalizeCamera = (camera: Partial<MatchMoveNode['camera']> | undefined) => ({
  ...DEFAULT_CAMERA,
  ...camera,
  focalLengthMm: clamp(finiteNumber(camera?.focalLengthMm, 35), 1, 1000),
  sensorWidthMm: clamp(finiteNumber(camera?.sensorWidthMm, 36), 1, 300),
  principalPoint: {
    x: finiteNumber(camera?.principalPoint?.x, 0),
    y: finiteNumber(camera?.principalPoint?.y, 0),
  },
  lensDistortionModel: camera?.lensDistortionModel === 'brown_conrady' ? 'brown_conrady' : 'none',
  surveyScale: clamp(finiteNumber(camera?.surveyScale, 1), 0.0001, 1_000_000),
});

const normalizeDisplay = (display: Partial<MatchMoveNode['display']> | undefined) => ({
  ...DEFAULT_DISPLAY,
  ...display,
  showFeatures: display?.showFeatures !== false,
  showTrails: display?.showTrails !== false,
  trailLength: Math.round(clamp(finiteNumber(display?.trailLength, 30), 1, 500)),
  colorByError: display?.colorByError !== false,
});

export const matchMoveNode: NodeDefinition = {
  type: NodeType.MATCH_MOVE,
  name: 'Match Move',
  description: 'Track 2D features, solve planar motion, and prepare camera-track data.',
  category: 'Spatial',
  renderMode: 'utility',
  processingDomain: 'data',
  IconComponent: Icons.OffsetRing,
  ToolComponent: MatchMoveTool,
  AdjustmentComponent: MatchMoveAdjustments,
  ViewportOverlayComponent: MatchMoveOverlay,
  flags: {
    isRenderable: false,
    isDraggable: true,
  },
  nodeExecution: {
    label: 'Track',
  },
  getInitialNodeProps: () => ({
    tracking: DEFAULT_TRACKING,
    solve: DEFAULT_SOLVE,
    camera: DEFAULT_CAMERA,
    tracks: [],
    solveResult: {
      status: 'idle',
      startFrame: DEFAULT_TRACKING.startFrame,
      endFrame: DEFAULT_TRACKING.endFrame,
      model: DEFAULT_SOLVE.model,
      frames: [],
    },
    display: DEFAULT_DISPLAY,
  }),
  onNodeUpdate: (node, changes) => {
    const updated = { ...(node as MatchMoveNode), ...changes };
    return {
      changes: {
        ...changes,
        ...('tracking' in changes ? { tracking: normalizeTracking(updated.tracking) } : {}),
        ...('solve' in changes ? { solve: normalizeSolve(updated.solve) } : {}),
        ...('camera' in changes ? { camera: normalizeCamera(updated.camera) } : {}),
        ...('display' in changes ? { display: normalizeDisplay(updated.display) } : {}),
      },
      label: 'Update Match Move',
    };
  },
};
