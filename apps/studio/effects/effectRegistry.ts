import { NodeType } from '@blackboard/types';
import { EffectDefinition, ToolDefinition } from './EffectDefinition';
import {
  connectRegistries,
  type EffectDefinition as PluginEffectDefinition,
  type ToolDefinition as PluginToolDefinition,
} from '@blackboard/plugin-sdk';

import { imageEffect } from './image';
import { videoEffect } from './video';
import { imageSequenceEffect } from './image_sequence';
import { sceneEffect } from './scene';
import { gradeEffect } from './grade';
import { blurEffect } from './blur';
import { bokehEffect } from './bokeh';
import { liquidGlassEffect } from './liquid_glass';
import { customShaderEffect } from './shader';
import { aiInpaintingTool } from './ai';
import { pixelateEffect } from './pixelate';
import { textEffect } from './text';
import { mergeEffect } from './merge';
import { lensDistortionEffect } from './lens_distortion';
import { rotoEffect } from './roto';
import { paintEffect } from './paint';
import { chromaKeyEffect } from './chroma_key';
import { warpEffect } from './warp';
import { comfyEffect } from './comfy';
import { onnxEffect } from './onnx';

// A mutable map of all registered effects, keyed by their node type string.
// Plugins can register new effects via registerPlugin() from @blackboard/plugin-sdk.
export const effectRegistry = new Map<string, EffectDefinition>();

// Register all built-in effects
effectRegistry.set(NodeType.IMAGE, imageEffect);
effectRegistry.set(NodeType.IMAGE_SEQUENCE, imageSequenceEffect);
effectRegistry.set(NodeType.VIDEO, videoEffect);
effectRegistry.set(NodeType.SCENE, sceneEffect);
effectRegistry.set(NodeType.TEXT, textEffect);
effectRegistry.set(NodeType.MERGE, mergeEffect);
effectRegistry.set(NodeType.GRADE, gradeEffect);
effectRegistry.set(NodeType.BLUR, blurEffect);
effectRegistry.set(NodeType.BOKEH_BLUR, bokehEffect);
effectRegistry.set(NodeType.LIQUID_GLASS, liquidGlassEffect);
effectRegistry.set(NodeType.CUSTOM_SHADER, customShaderEffect);
effectRegistry.set(NodeType.PIXELATE, pixelateEffect);
effectRegistry.set(NodeType.LENS_DISTORTION, lensDistortionEffect);
effectRegistry.set(NodeType.ROTO, rotoEffect);
effectRegistry.set(NodeType.PAINT, paintEffect);
effectRegistry.set(NodeType.CHROMA_KEY, chromaKeyEffect);
effectRegistry.set(NodeType.WARP, warpEffect);
effectRegistry.set(NodeType.COMFY, comfyEffect);
effectRegistry.set(NodeType.ONNX_MODEL, onnxEffect);

// --- Categorized lists for UI generation ---

// Mutable tool list for UI ordering. Plugins append to this via registerPlugin().
const toolRegistry: ToolDefinition[] = [
  imageEffect,
  videoEffect,
  imageSequenceEffect,
  comfyEffect,
  onnxEffect,
  textEffect,
  mergeEffect,
  aiInpaintingTool,
  gradeEffect,
  blurEffect,
  chromaKeyEffect,
  bokehEffect,
  liquidGlassEffect,
  customShaderEffect,
  pixelateEffect,
  lensDistortionEffect,
  warpEffect,
  rotoEffect,
  paintEffect,
];

export const imageTools = toolRegistry.filter(
  (def) => def.category === 'Image' && def.ToolComponent,
);
export const adjustmentTools = toolRegistry.filter(
  (def) => def.category === 'Adjustment' && def.ToolComponent,
);
export const effectTools = toolRegistry.filter(
  (def) => def.category === 'Effect' && def.ToolComponent,
);

// Connect registries to the plugin-sdk so that plugins can register effects.
connectRegistries(
  effectRegistry as Map<string, PluginEffectDefinition>,
  toolRegistry as PluginToolDefinition[],
);
