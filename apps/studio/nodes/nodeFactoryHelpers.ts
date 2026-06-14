/**
 * Node Factory Helpers — Shared functions that reduce boilerplate in
 * shader-effect node index files.
 *
 * Placed in a separate file from `helpers.ts` to avoid circular dependencies:
 * `helpers.ts` is imported by many modules (nodeFlags, hasRenderableNodes, etc.)
 * and should not carry heavy imports like THREE or @blackboard/renderer.
 */

import type { ComponentType } from 'react';
import type {
  NodeDefinition,
  ShaderUniformMap,
  RenderContext,
  ToolCategory,
} from './NodeDefinition';
import { type AnyNode, UniformUIType, type AnyUniform } from '@blackboard/types';
import { parseUniformsFromGLSL, getValueAtFrame } from '@blackboard/renderer';
import { uniformSliderAnimation } from './animationHelpers';
import * as THREE from 'three';

// Re-export types consumed by node index files.
export type { ShaderUniformMap, RenderContext } from './NodeDefinition';

// ---------------------------------------------------------------------------
// createUniformGetter
// ---------------------------------------------------------------------------

export interface CreateUniformGetterOptions {
  /** When true, merge `_x` / `_y` slider pairs into `THREE.Vector2`. */
  supportsVector2?: boolean;
  /**
   * Callback to inject extra uniforms that aren't part of `node.uniforms`
   * (e.g. `u_resolution`, `u_depthSource`). Runs after the default loop.
   */
  additionalUniforms?: (node: AnyNode, context: RenderContext) => ShaderUniformMap;
}

/**
 * Build a `getUniforms` callback for a standard shader node.
 *
 * Handles:
 * - `UniformUIType.SLIDER` → `getValueAtFrame` for animation
 * - `UniformUIType.COLOR` → `new THREE.Color(...)`
 * - All other types → passthrough (TOGGLE, SEGMENTED, NUMBER, etc.)
 *
 * When `supportsVector2` is `true`, `_x` / `_y` slider pairs from the
 * shader are merged into a single `THREE.Vector2` uniform.
 */
export function createUniformGetter(
  options: CreateUniformGetterOptions = {},
): NonNullable<NodeDefinition['getUniforms']> {
  const { supportsVector2 = false, additionalUniforms } = options;

  return (node: AnyNode, context: RenderContext): ShaderUniformMap => {
    const uniforms: ShaderUniformMap = {};
    const processedKeys = supportsVector2 ? new Set<string>() : null;

    const nodeUniforms = (node as { uniforms: Record<string, AnyUniform> }).uniforms;
    for (const key in nodeUniforms) {
      const uniformData = nodeUniforms[key];
      if (!uniformData) continue;

      // ── Vector2 pair merging ──────────────────────────────────────────
      if (supportsVector2 && processedKeys) {
        if (processedKeys.has(key)) continue;

        if (key.endsWith('_x')) {
          const baseKey = key.slice(0, -2);
          const yKey = `${baseKey}_y`;
          const yUniform = nodeUniforms[yKey];
          if (
            yUniform &&
            uniformData.ui === UniformUIType.SLIDER &&
            yUniform.ui === UniformUIType.SLIDER
          ) {
            uniforms[baseKey] = {
              value: new THREE.Vector2(
                getValueAtFrame(uniformData.value, context.frame),
                getValueAtFrame(yUniform.value, context.frame),
              ),
            };
            processedKeys.add(yKey);
            continue;
          }
        }

        if (key.endsWith('_y')) continue;
        processedKeys.add(key);
      }

      // ── Per-type handling ─────────────────────────────────────────────
      if (uniformData.ui === UniformUIType.SLIDER) {
        uniforms[key] = { value: getValueAtFrame(uniformData.value, context.frame) };
      } else if (uniformData.ui === UniformUIType.COLOR) {
        uniforms[key] = {
          value: new THREE.Color(...(uniformData.value as [number, number, number])),
        };
      } else {
        uniforms[key] = { value: uniformData.value };
      }
    }

    // ── Additional uniforms ─────────────────────────────────────────────
    if (additionalUniforms) {
      Object.assign(uniforms, additionalUniforms(node, context));
    }

    return uniforms;
  };
}

// ---------------------------------------------------------------------------
// createShaderNodeDefinition
// ---------------------------------------------------------------------------

export interface CreateShaderNodeDefinitionOptions {
  type: string;
  name: string;
  description: string;
  /** Defaults to `'Effect'` if not provided. */
  category?: ToolCategory;
  IconComponent: ComponentType<{ className?: string }>;
  ToolComponent?: ComponentType;
  AdjustmentComponent: ComponentType<{ node: AnyNode }>;
  /** The GLSL shader source string. */
  shader: string;
  /** Uniform names to exclude when calling `parseUniformsFromGLSL`. */
  excludedUniforms?: string[];
  /** When `true`, merge `_x` / `_y` slider pairs into `THREE.Vector2`. */
  supportsVector2?: boolean;
  /** Extra uniforms beyond `node.uniforms` (e.g. `u_resolution`). */
  additionalUniforms?: (node: AnyNode, context: RenderContext) => ShaderUniformMap;
  /** Any other `NodeDefinition` fields to merge on top of the factory defaults. */
  overrides?: Partial<
    Omit<
      NodeDefinition,
      | 'type'
      | 'name'
      | 'description'
      | 'category'
      | 'renderMode'
      | 'IconComponent'
      | 'ToolComponent'
      | 'AdjustmentComponent'
    >
  >;
}

/**
 * Create a standard shader-based effect `NodeDefinition` with sensible defaults.
 *
 * Covers the ~80 % of shader effect nodes that follow the pattern:
 * ```
 * getInitialNodeProps → parseUniformsFromGLSL(shader)
 * getShader          → shader
 * getUniforms        → iterate uniforms, handle SLIDER / COLOR / Vector2
 * animation          → uniformSliderAnimation
 * flags              → {}
 * ```
 *
 * Use `overrides` for extra properties (`inputPorts`, `toolHotkeys`,
 * `getUniforms` customisation, etc.).
 */
export function createShaderNodeDefinition(
  options: CreateShaderNodeDefinitionOptions,
): NodeDefinition {
  const {
    type,
    name,
    description,
    category = 'Effect',
    IconComponent,
    ToolComponent,
    AdjustmentComponent,
    shader,
    excludedUniforms,
    supportsVector2,
    additionalUniforms,
    overrides,
  } = options;

  return {
    type,
    name,
    category,
    renderMode: 'shader',
    description,
    IconComponent,
    ToolComponent,
    AdjustmentComponent,
    animation: uniformSliderAnimation,
    flags: {},
    getInitialNodeProps: () => ({
      uniforms: parseUniformsFromGLSL(shader, excludedUniforms),
    }),
    getShader: () => shader,
    getUniforms: createUniformGetter({ supportsVector2, additionalUniforms }),
    ...overrides,
  };
}
