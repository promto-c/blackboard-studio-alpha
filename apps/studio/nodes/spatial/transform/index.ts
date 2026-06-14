import {
  AnyNode,
  CropNode,
  NodeType,
  ReformatNode,
  ReformatResizeMode,
  SpatialResamplingFilter,
  TransformNode,
} from '@blackboard/types';
import { getValueAtFrame } from '@blackboard/renderer';
import * as Icons from '@blackboard/icons';
import { NodeDefinition, ShaderUniformMap } from '../../NodeDefinition';
import {
  createAnimatablePropertyCollector,
  type NodeAnimationBehavior,
} from '../../animationHelpers';
import { CropAdjustments, ReformatAdjustments, TransformAdjustments } from './SpatialAdjustments';
import { CropTool, ReformatTool, TransformTool } from './SpatialTools';
import SpatialOverlay from './SpatialOverlay';
import { SpatialShader } from './spatialShaders';

const DEFAULT_FORMAT = { width: 1920, height: 1080 };
const DEFAULT_RESAMPLING: SpatialResamplingFilter = 'linear';

const modeToUniform = (mode: ReformatResizeMode): number => {
  if (mode === 'fill') return 1;
  if (mode === 'stretch') return 2;
  if (mode === 'none') return 3;
  return 0;
};

const resamplingToUniform = (filter: SpatialResamplingFilter | undefined): number => {
  if (filter === 'nearest') return 0;
  if (filter === 'cubic') return 2;
  if (filter === 'lanczos') return 3;
  return 1;
};

const isSpatialResamplingFilter = (value: unknown): value is SpatialResamplingFilter =>
  value === 'nearest' || value === 'linear' || value === 'cubic' || value === 'lanczos';

const clampDimension = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.round(value));
};

const normalizeSizeChanges = <T extends { width: number; height: number }>(
  node: T,
  changes: Record<string, unknown>,
) => ({
  ...changes,
  ...('width' in changes ? { width: clampDimension(changes.width, node.width) } : {}),
  ...('height' in changes ? { height: clampDimension(changes.height, node.height) } : {}),
});

const normalizeResamplingChanges = (changes: Record<string, unknown>) => {
  if (!('resampling' in changes)) return changes;
  return {
    ...changes,
    ...(isSpatialResamplingFilter(changes.resampling) ? {} : { resampling: DEFAULT_RESAMPLING }),
  };
};

const transformAnimation: NodeAnimationBehavior = {
  getAnimatableProperties: (node) => {
    const transformNode = node as TransformNode;
    const { props, addProp } = createAnimatablePropertyCollector();

    addProp('Translate X', 'transform.translateX', transformNode.transform.translateX, 'Transform');
    addProp('Translate Y', 'transform.translateY', transformNode.transform.translateY, 'Transform');
    addProp('Scale X', 'transform.scaleX', transformNode.transform.scaleX, 'Transform');
    addProp('Scale Y', 'transform.scaleY', transformNode.transform.scaleY, 'Transform');
    addProp('Rotation', 'transform.rotation', transformNode.transform.rotation, 'Transform');
    addProp('Pivot X', 'transform.pivotX', transformNode.transform.pivotX, 'Transform');
    addProp('Pivot Y', 'transform.pivotY', transformNode.transform.pivotY, 'Transform');

    return props;
  },
};

const cropAnimation: NodeAnimationBehavior = {
  getAnimatableProperties: (node) => {
    const cropNode = node as CropNode;
    const { props, addProp } = createAnimatablePropertyCollector();

    addProp('Left', 'crop.left', cropNode.crop.left, 'Crop');
    addProp('Right', 'crop.right', cropNode.crop.right, 'Crop');
    addProp('Top', 'crop.top', cropNode.crop.top, 'Crop');
    addProp('Bottom', 'crop.bottom', cropNode.crop.bottom, 'Crop');

    return props;
  },
};

export const transformNode: NodeDefinition = {
  type: NodeType.TRANSFORM,
  name: 'Transform',
  category: 'Spatial',
  renderMode: 'shader',
  description: 'Move, scale, rotate, and pivot the current image.',
  IconComponent: Icons.Transform,
  ToolComponent: TransformTool,
  AdjustmentComponent: TransformAdjustments,
  ViewportOverlayComponent: SpatialOverlay,
  flags: { showDataWindow: true, showInputDataWindow: true },
  animation: transformAnimation,
  getInitialNodeProps: () => ({
    transform: {
      translateX: 0,
      translateY: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      pivotX: 0,
      pivotY: 0,
    },
    resampling: DEFAULT_RESAMPLING,
  }),
  onNodeUpdate: (_node, changes) => ({
    changes: normalizeResamplingChanges(changes),
  }),
  getShader: () => SpatialShader.TRANSFORM,
  getUniforms: (node: AnyNode, context): ShaderUniformMap => {
    const transformNode = node as TransformNode;
    const transform = transformNode.transform;

    return {
      u_scene_res: { value: [context.scene.width, context.scene.height] },
      u_translate: {
        value: [
          getValueAtFrame(transform.translateX, context.frame),
          getValueAtFrame(transform.translateY, context.frame),
        ],
      },
      u_scale: {
        value: [
          getValueAtFrame(transform.scaleX, context.frame),
          getValueAtFrame(transform.scaleY, context.frame),
        ],
      },
      u_rotation: { value: -(getValueAtFrame(transform.rotation, context.frame) * Math.PI) / 180 },
      u_pivot: {
        value: [
          getValueAtFrame(transform.pivotX, context.frame),
          getValueAtFrame(transform.pivotY, context.frame),
        ],
      },
      u_filter: { value: resamplingToUniform(transformNode.resampling) },
    };
  },
};

export const cropNode: NodeDefinition = {
  type: NodeType.CROP,
  name: 'Crop',
  category: 'Spatial',
  renderMode: 'shader',
  description: 'Crop the current image and update its data window.',
  IconComponent: Icons.Rectangle,
  ToolComponent: CropTool,
  AdjustmentComponent: CropAdjustments,
  flags: { showDataWindow: true },
  animation: cropAnimation,
  getInitialNodeProps: () => ({
    crop: {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    },
  }),
  getShader: () => SpatialShader.CROP,
  getUniforms: (node: AnyNode, context): ShaderUniformMap => {
    const cropNode = node as CropNode;
    const crop = cropNode.crop;

    return {
      u_scene_res: { value: [context.scene.width, context.scene.height] },
      u_crop: {
        value: [
          getValueAtFrame(crop.left, context.frame),
          getValueAtFrame(crop.right, context.frame),
          getValueAtFrame(crop.top, context.frame),
          getValueAtFrame(crop.bottom, context.frame),
        ],
      },
    };
  },
};

export const reformatNode: NodeDefinition = {
  type: NodeType.REFORMAT,
  name: 'Reformat',
  category: 'Spatial',
  renderMode: 'shader',
  description: 'Reframe the current image into a target format window.',
  IconComponent: Icons.Landscape,
  ToolComponent: ReformatTool,
  AdjustmentComponent: ReformatAdjustments,
  flags: {},
  getInitialNodeProps: () => ({
    ...DEFAULT_FORMAT,
    resizeMode: 'fit' as ReformatResizeMode,
    resampling: DEFAULT_RESAMPLING,
  }),
  onNodeUpdate: (node, changes) => ({
    changes: normalizeResamplingChanges(normalizeSizeChanges(node as ReformatNode, changes)),
    label: `Reformat ${node.name}`,
  }),
  getShader: () => SpatialShader.REFORMAT,
  getUniforms: (node: AnyNode, context): ShaderUniformMap => {
    const reformatNode = node as ReformatNode;
    const sourceWidth = reformatNode.sourceWidth ?? context.scene.width;
    const sourceHeight = reformatNode.sourceHeight ?? context.scene.height;

    return {
      u_scene_res: { value: [sourceWidth, sourceHeight] },
      u_target_res: { value: [reformatNode.width, reformatNode.height] },
      u_mode: { value: modeToUniform(reformatNode.resizeMode) },
      u_filter: { value: resamplingToUniform(reformatNode.resampling) },
    };
  },
};
