import { NodeType } from '@blackboard/types';
import { NodeDefinition, ToolDefinition } from './NodeDefinition';
import {
  connectRegistries,
  type NodeDefinition as PluginNodeDefinition,
  type ToolDefinition as PluginToolDefinition,
} from '@blackboard/plugin-sdk';

import { mediaSourceNode } from './builtin/media_source';
import { imageSequenceNode } from './builtin/image_sequence';
import { sceneNode } from './builtin/scene';
import { scene3DNode } from './builtin/scene_3d';
import { cropNode, reformatNode, transformNode } from './spatial/transform';
import { gradeNode } from './effects/grade';
import { blurNode } from './effects/blur';
import { bokehNode } from './effects/bokeh';
import { liquidGlassNode } from './effects/liquid_glass';
import { customShaderNode } from './builtin/shader';
import { pixelateNode } from './effects/pixelate';
import { textNode } from './builtin/text';
import { mergeNode } from './builtin/merge';
import { extractChannelsNode, mergeChannelsNode } from './builtin/channels';
import { lensDistortionNode } from './spatial/lens_distortion';
import { matchMoveNode } from './spatial/match_move';
import { rotoNode } from './builtin/roto';
import { paintNode } from './builtin/paint';
import { keyerNode } from './effects/keyer';
import { warpNode } from './spatial/warp';
import { comfyNode } from './ai/comfy';
import { onnxNode } from './ai/onnx';
import { groupNode } from './builtin/group';
import { inputNode } from './builtin/input';
import { noteNode } from './builtin/note';
import {
  ocioColorSpaceTransformNode,
  ocioFileTransformNode,
  ocioLookTransformNode,
  ocioNamedTransformNode,
} from './effects/ocio';

// A mutable map of all registered node definitions, keyed by node type string.
// Plugins can register new node types via registerPlugin() from @blackboard/plugin-sdk.
export const nodeRegistry = new Map<string, NodeDefinition>();

// Register all built-in node types
nodeRegistry.set(NodeType.MEDIA_SOURCE, mediaSourceNode);
nodeRegistry.set(NodeType.IMAGE_SEQUENCE, imageSequenceNode);
nodeRegistry.set(NodeType.SCENE, sceneNode);
nodeRegistry.set(NodeType.SCENE_3D, scene3DNode);
nodeRegistry.set(NodeType.GROUP, groupNode);
nodeRegistry.set(NodeType.INPUT, inputNode);
nodeRegistry.set(NodeType.TEXT, textNode);
nodeRegistry.set(NodeType.MERGE, mergeNode);
nodeRegistry.set(NodeType.EXTRACT_CHANNELS, extractChannelsNode);
nodeRegistry.set(NodeType.MERGE_CHANNELS, mergeChannelsNode);
nodeRegistry.set(NodeType.REFORMAT, reformatNode);
nodeRegistry.set(NodeType.TRANSFORM, transformNode);
nodeRegistry.set(NodeType.CROP, cropNode);
nodeRegistry.set(NodeType.GRADE, gradeNode);
nodeRegistry.set(NodeType.BLUR, blurNode);
nodeRegistry.set(NodeType.BOKEH_BLUR, bokehNode);
nodeRegistry.set(NodeType.LIQUID_GLASS, liquidGlassNode);
nodeRegistry.set(NodeType.CUSTOM_SHADER, customShaderNode);
nodeRegistry.set(NodeType.PIXELATE, pixelateNode);
nodeRegistry.set(NodeType.LENS_DISTORTION, lensDistortionNode);
nodeRegistry.set(NodeType.MATCH_MOVE, matchMoveNode);
nodeRegistry.set(NodeType.ROTO, rotoNode);
nodeRegistry.set(NodeType.PAINT, paintNode);
nodeRegistry.set(NodeType.KEYER, keyerNode);
nodeRegistry.set(NodeType.WARP, warpNode);
nodeRegistry.set(NodeType.COMFY, comfyNode);
nodeRegistry.set(NodeType.ONNX_MODEL, onnxNode);
nodeRegistry.set(NodeType.OCIO_COLOR_SPACE, ocioColorSpaceTransformNode);
nodeRegistry.set(NodeType.OCIO_NAMED_TRANSFORM, ocioNamedTransformNode);
nodeRegistry.set(NodeType.OCIO_FILE_TRANSFORM, ocioFileTransformNode);
nodeRegistry.set(NodeType.OCIO_LOOK_TRANSFORM, ocioLookTransformNode);
nodeRegistry.set(NodeType.NOTE, noteNode);

// --- Categorized lists for UI generation ---
// Nodes with a ToolComponent are derived from the nodeRegistry.

function getToolDefinition(def: NodeDefinition): ToolDefinition {
  return {
    type: def.type,
    name: def.name,
    description: def.description,
    category: def.category,
    ToolComponent: def.ToolComponent,
  };
}

const builtInTools: ToolDefinition[] = [
  ...Array.from(nodeRegistry.values())
    .filter((def) => !!def.ToolComponent)
    .map(getToolDefinition),
];

export const imageTools = builtInTools
  .filter((def) => def.category === 'Image' && def.ToolComponent)
  .map((def) => def);
export const spatialTools = builtInTools
  .filter((def) => def.category === 'Spatial' && def.ToolComponent)
  .map((def) => def);
export const adjustmentTools = builtInTools
  .filter((def) => def.category === 'Adjustment' && def.ToolComponent)
  .map((def) => def);
export const effectTools = builtInTools
  .filter((def) => def.category === 'Effect' && def.ToolComponent)
  .map((def) => def);
export const utilityTools = builtInTools
  .filter((def) => def.category === 'Utility' && def.ToolComponent)
  .map((def) => def);

// Mutable tool list for plugin SDK compatibility. Plugins append to this
// via registerPlugin(). The UI categories above are Map-derived, so this
// array is only used by the SDK for its own push/splice operations.
const toolRegistry: ToolDefinition[] = [...builtInTools];

// Connect registries to the plugin-sdk so that plugins can register node types.
connectRegistries(
  nodeRegistry as Map<string, PluginNodeDefinition>,
  toolRegistry as PluginToolDefinition[],
);
