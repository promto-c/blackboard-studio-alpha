import { NodeType, type FeatureMatchNode } from '@blackboard/types';
import * as Icons from '@blackboard/icons';
import type { NodeDefinition } from '@/nodes/NodeDefinition';
import FeatureMatchAdjustments from './FeatureMatchAdjustments';
import { FeatureMatchTool } from './FeatureMatchTool';
import { renderFeatureMatchGpu } from './featureMatchGpu';

const DEFAULT_SETTINGS: FeatureMatchNode['settings'] = {
  model: 'homography',
  ransacThreshold: 2.5,
  maxFeatures: 180,
  minFeatureDistance: 24,
  featureQuality: 0.035,
  patchSize: 9,
  maxTrackError: 8,
};

const IDLE_RESULT: FeatureMatchNode['result'] = {
  status: 'idle',
  matrix: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  invMatrix: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  model: 'homography',
  inliers: 0,
  totalPoints: 0,
  residual: 0,
};

const finiteNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const normalizeSettings = (
  settings: Partial<FeatureMatchNode['settings']> | undefined,
): FeatureMatchNode['settings'] => ({
  ...DEFAULT_SETTINGS,
  ...settings,
  model:
    settings?.model === 'translation' ||
    settings?.model === 'similarity' ||
    settings?.model === 'affine' ||
    settings?.model === 'homography'
      ? settings.model
      : DEFAULT_SETTINGS.model,
  ransacThreshold: clamp(finiteNumber(settings?.ransacThreshold, 2.5), 0.1, 50),
  maxFeatures: Math.round(clamp(finiteNumber(settings?.maxFeatures, 180), 4, 2000)),
  minFeatureDistance: Math.round(clamp(finiteNumber(settings?.minFeatureDistance, 24), 4, 200)),
  featureQuality: clamp(finiteNumber(settings?.featureQuality, 0.035), 0.001, 1),
  patchSize: Math.round(clamp(finiteNumber(settings?.patchSize, 9), 5, 31)),
  maxTrackError: clamp(finiteNumber(settings?.maxTrackError, 8), 0.1, 100),
});

export const featureMatchNode: NodeDefinition = {
  type: NodeType.FEATURE_MATCH,
  name: 'Feature Match',
  description:
    'Detect matching features between two images, solve for a transform, and warp the source to align with the reference.',
  category: 'Spatial',
  renderMode: 'mask',
  processingDomain: 'scene_linear',
  IconComponent: Icons.ArrowsRightLeft,
  ToolComponent: FeatureMatchTool,
  AdjustmentComponent: FeatureMatchAdjustments,
  flags: {
    isRenderable: true,
    isDraggable: true,
  },
  nodeExecution: {
    label: 'Match',
  },
  inputPorts: [
    {
      name: 'pipe',
      label: 'Source',
      type: 'texture',
      required: false,
      color: '#60a5fa',
      description: 'Left input image to transform (source).',
    },
    {
      name: 'reference',
      label: 'Reference',
      type: 'texture',
      required: true,
      color: '#34d399',
      description:
        'Right input image used as the target (base). Source will be warped to match this.',
    },
  ],
  getInitialNodeProps: () => ({
    settings: DEFAULT_SETTINGS,
    result: { ...IDLE_RESULT },
  }),
  renderOutput: renderFeatureMatchGpu,
  onNodeUpdate: (node, changes) => {
    const updated = { ...(node as FeatureMatchNode), ...changes };
    return {
      changes: {
        ...changes,
        ...('settings' in changes ? { settings: normalizeSettings(updated.settings) } : {}),
      },
      label: 'Update Feature Match',
    };
  },
};
