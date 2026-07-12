import {
  NodeType,
  OCIO_PROJECT_WORKING_SPACE,
  type AnyNode,
  type OcioColorSpaceTransformNode,
  type OcioFileTransformNode,
  type OcioLookTransformNode,
  type OcioNamedTransformNode,
} from '@blackboard/types';
import * as Icons from '@blackboard/icons';
import { colorManagementService } from '@/color-management';
import type { NodeDefinition } from '../../NodeDefinition';
import { OcioTransformAdjustments } from './OcioTransformAdjustments';
import {
  OcioColorSpaceTransformTool,
  OcioFileTransformTool,
  OcioLookTransformTool,
  OcioNamedTransformTool,
} from './OcioTransformTools';
import {
  getColorSpaceNodeTransforms,
  getFileTransformNodeTransforms,
  getLookTransformNodeTransforms,
  getNamedTransformNodeTransforms,
  getOcioColorSpaceProcessingDomain,
} from './ocioTransformModel';

const getColorSpaceDomain = (colorSpace: OcioColorSpaceTransformNode['sourceColorSpace']) =>
  getOcioColorSpaceProcessingDomain(colorSpace, colorManagementService.getSnapshot());

export const ocioColorSpaceTransformNode: NodeDefinition = {
  type: NodeType.OCIO_COLOR_SPACE,
  name: 'Color Space Transform',
  category: 'Adjustment',
  renderMode: 'ocio',
  processingDomain: (node) =>
    getColorSpaceDomain((node as OcioColorSpaceTransformNode).destinationColorSpace),
  primaryInputDomain: (node) =>
    getColorSpaceDomain((node as OcioColorSpaceTransformNode).sourceColorSpace),
  primaryInputDomainPolicy: 'reinterpret',
  description: 'Convert RGB between any two color spaces in the active OCIO config.',
  IconComponent: Icons.ArrowsRightLeft,
  ToolComponent: OcioColorSpaceTransformTool,
  AdjustmentComponent: OcioTransformAdjustments,
  flags: {},
  getInitialNodeProps: () => ({
    sourceColorSpace: OCIO_PROJECT_WORKING_SPACE,
    destinationColorSpace: OCIO_PROJECT_WORKING_SPACE,
  }),
  getOcioTransforms: (node, context) =>
    getColorSpaceNodeTransforms(node as OcioColorSpaceTransformNode, context),
};

export const ocioNamedTransformNode: NodeDefinition = {
  type: NodeType.OCIO_NAMED_TRANSFORM,
  name: 'OCIO Named Transform',
  category: 'Adjustment',
  renderMode: 'ocio',
  processingDomain: 'scene_linear',
  description: 'Apply a config-defined named transform in an explicit process color space.',
  IconComponent: Icons.Link,
  ToolComponent: OcioNamedTransformTool,
  AdjustmentComponent: OcioTransformAdjustments,
  flags: {},
  getInitialNodeProps: () => ({
    namedTransform: '',
    direction: 'forward',
    processColorSpace: OCIO_PROJECT_WORKING_SPACE,
  }),
  getOcioTransforms: (node, context) =>
    getNamedTransformNodeTransforms(node as OcioNamedTransformNode, context),
};

export const ocioFileTransformNode: NodeDefinition = {
  type: NodeType.OCIO_FILE_TRANSFORM,
  name: 'OCIO File Transform',
  category: 'Adjustment',
  renderMode: 'ocio',
  processingDomain: 'scene_linear',
  description: 'Apply an OCIO-supported LUT or transform file with explicit input/output encoding.',
  IconComponent: Icons.DocumentPlus,
  ToolComponent: OcioFileTransformTool,
  AdjustmentComponent: OcioTransformAdjustments,
  flags: {},
  getInitialNodeProps: () => ({
    assetId: null,
    fileName: null,
    direction: 'forward',
    interpolation: 'best',
    inputColorSpace: OCIO_PROJECT_WORKING_SPACE,
    outputColorSpace: OCIO_PROJECT_WORKING_SPACE,
  }),
  getAssetIds: (node: AnyNode) => {
    const assetId = (node as OcioFileTransformNode).assetId;
    return assetId ? [assetId] : [];
  },
  getOcioTransforms: (node, context) =>
    getFileTransformNodeTransforms(node as OcioFileTransformNode, context),
};

export const ocioLookTransformNode: NodeDefinition = {
  type: NodeType.OCIO_LOOK_TRANSFORM,
  name: 'OCIO Look',
  category: 'Adjustment',
  renderMode: 'ocio',
  processingDomain: 'scene_linear',
  description: 'Apply a look defined by the active OCIO config while preserving working-space I/O.',
  IconComponent: Icons.Sparkles,
  ToolComponent: OcioLookTransformTool,
  AdjustmentComponent: OcioTransformAdjustments,
  flags: {},
  getInitialNodeProps: () => ({ looks: '', direction: 'forward' }),
  getOcioTransforms: (node, context) =>
    getLookTransformNodeTransforms(node as OcioLookTransformNode, context),
};
