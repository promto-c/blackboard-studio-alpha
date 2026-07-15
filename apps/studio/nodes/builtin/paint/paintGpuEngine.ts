import * as THREE from 'three';
import type { ResolveOutputContext } from '@blackboard/renderer';
import type { PaintNode, PaintStroke, PaintStrokeChannels, Point } from '@blackboard/types';
import { sampleBSplinePoints } from '@/utils/bspline';
import {
  collectPaintStampPoints,
  getVisiblePaintStrokes,
  paintCloneOffsetToUv,
  paintPointToRenderSpace,
  type PaintLivePreview,
} from './paintModel';
import { getPaintLivePreview } from './paintRuntime';

export const PAINT_COPY_SHADER = `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_texture;
out vec4 fragColor;

void main() {
  fragColor = texture(u_texture, v_uv);
}
`;

/**
 * Paint operates on straight, independent channels. There is deliberately no
 * source-over RGB/alpha coupling here: u_channels selects exactly which image
 * planes a stroke is allowed to replace.
 */
export const PAINT_STROKE_COMPOSITE_SHADER = `
precision highp float;

in vec2 v_uv;
uniform sampler2D u_current;
uniform sampler2D u_input;
uniform sampler2D u_mask;
uniform vec4 u_channels;
uniform vec4 u_paintValue;
uniform vec2 u_cloneOffsetUv;
uniform int u_tool;
out vec4 fragColor;

void main() {
  vec4 current = texture(u_current, v_uv);
  vec4 inputValue = texture(u_input, v_uv);
  float coverage = clamp(texture(u_mask, v_uv).r, 0.0, 1.0);
  vec4 strokeValue = u_paintValue;

  if (u_tool == 1) {
    // RGB erase reveals the unmodified input. Alpha erase explicitly clears alpha.
    strokeValue = vec4(inputValue.rgb, 0.0);
  } else if (u_tool == 2) {
    strokeValue = texture(u_input, v_uv + u_cloneOffsetUv);
  }

  fragColor = mix(current, strokeValue, u_channels * coverage);
}
`;

const STAMP_VERTEX_SHADER = `
precision highp float;

in vec2 position;
in vec2 instanceCenter;
uniform vec2 u_sceneSize;
uniform float u_brushSize;
out vec2 v_brushPosition;

void main() {
  v_brushPosition = position;
  vec2 centerUv = (instanceCenter + u_sceneSize * 0.5) / u_sceneSize;
  vec2 radiusClip = vec2(u_brushSize) / u_sceneSize;
  gl_Position = vec4(centerUv * 2.0 - 1.0 + position * radiusClip, 0.0, 1.0);
}
`;

const STAMP_FRAGMENT_SHADER = `
precision highp float;

in vec2 v_brushPosition;
uniform float u_softness;
uniform float u_opacity;
out vec4 fragColor;

void main() {
  float distanceFromCenter = length(v_brushPosition);
  float innerRadius = clamp(1.0 - u_softness * 0.01, 0.0, 1.0);
  float edge = innerRadius > 0.9999
    ? step(distanceFromCenter, 1.0)
    : 1.0 - smoothstep(innerRadius, 1.0, distanceFromCenter);
  float coverage = edge * clamp(u_opacity * 0.01, 0.0, 1.0);
  fragColor = vec4(coverage);
}
`;

interface PaintGpuState {
  strokes: PaintNode['strokes'];
  layers: PaintNode['layers'];
  frame: number;
  width: number;
  height: number;
  nodes: ResolveOutputContext['nodes'] | null;
  inputTexture: THREE.Texture | null;
  inputVersion: number;
  committedTarget: THREE.WebGLRenderTarget | null;
}

interface PaintStampRenderer {
  geometry: THREE.InstancedBufferGeometry;
  centers: THREE.InstancedBufferAttribute;
  capacity: number;
  material: THREE.RawShaderMaterial;
  mesh: THREE.Mesh;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
}

interface PaintRendererResources {
  states: Map<string, PaintGpuState>;
  stamps: PaintStampRenderer;
  fallbackMasks: Map<string, THREE.WebGLRenderTarget>;
  committedOwner: string | null;
}

const rendererResources = new WeakMap<THREE.WebGLRenderer, PaintRendererResources>();
const interactiveRenderers = new WeakSet<THREE.WebGLRenderer>();

export const setPaintRendererInteractive = (
  renderer: THREE.WebGLRenderer,
  interactive: boolean,
): void => {
  if (interactive) interactiveRenderers.add(renderer);
  else interactiveRenderers.delete(renderer);
};

const createStampGeometry = (
  capacity: number,
): {
  geometry: THREE.InstancedBufferGeometry;
  centers: THREE.InstancedBufferAttribute;
} => {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1], 2),
  );
  const centers = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
  centers.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('instanceCenter', centers);
  geometry.instanceCount = 0;
  return { geometry, centers };
};

const createStampRenderer = (): PaintStampRenderer => {
  const capacity = 64;
  const { geometry, centers } = createStampGeometry(capacity);

  const material = new THREE.RawShaderMaterial({
    vertexShader: STAMP_VERTEX_SHADER,
    fragmentShader: STAMP_FRAGMENT_SHADER,
    glslVersion: THREE.GLSL3,
    uniforms: {
      u_sceneSize: { value: new THREE.Vector2(1, 1) },
      u_brushSize: { value: 1 },
      u_softness: { value: 0 },
      u_opacity: { value: 100 },
    },
    depthTest: false,
    depthWrite: false,
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.MaxEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendEquationAlpha: THREE.MaxEquation,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneFactor,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  return {
    geometry,
    centers,
    capacity,
    material,
    mesh,
    scene,
    camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
  };
};

const getRendererResources = (renderer: THREE.WebGLRenderer): PaintRendererResources => {
  let resources = rendererResources.get(renderer);
  if (!resources) {
    resources = {
      states: new Map(),
      stamps: createStampRenderer(),
      fallbackMasks: new Map(),
      committedOwner: null,
    };
    rendererResources.set(renderer, resources);
  }
  return resources;
};

export const disposePaintGpuEngine = (renderer: THREE.WebGLRenderer): void => {
  const resources = rendererResources.get(renderer);
  if (!resources) return;
  resources.stamps.geometry.dispose();
  resources.stamps.material.dispose();
  resources.fallbackMasks.forEach((target) => target.dispose());
  resources.fallbackMasks.clear();
  resources.states.clear();
  interactiveRenderers.delete(renderer);
  rendererResources.delete(renderer);
};

const getStrokeMaskTarget = (
  width: number,
  height: number,
  context: ResolveOutputContext,
  resources: PaintRendererResources,
): THREE.WebGLRenderTarget => {
  // Float blending is ideal for soft coverage, but is an optional WebGL extension.
  // Fall back to an R8-equivalent RGBA mask so painting remains reliable on every
  // WebGL2 device supported by the renderer.
  if (context.renderer.extensions.has('EXT_float_blend')) {
    return context.getScratchRenderTarget!('paint:working-mask');
  }

  const key = 'paint:working-mask';
  let target = resources.fallbackMasks.get(key);
  if (!target) {
    target = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    resources.fallbackMasks.set(key, target);
  } else if (target.width !== width || target.height !== height) {
    target.setSize(width, height);
  }
  return target;
};

const ensureStampCapacity = (stampRenderer: PaintStampRenderer, count: number): void => {
  if (count <= stampRenderer.capacity) return;
  const capacity = 2 ** Math.ceil(Math.log2(count));
  const { geometry, centers } = createStampGeometry(capacity);
  const previousGeometry = stampRenderer.geometry;
  stampRenderer.mesh.geometry = geometry;
  stampRenderer.geometry = geometry;
  stampRenderer.centers = centers;
  stampRenderer.capacity = capacity;
  previousGeometry.dispose();
};

const renderPass = (
  context: ResolveOutputContext,
  material: THREE.ShaderMaterial,
  target: THREE.WebGLRenderTarget,
): void => {
  context.applyNoBlending(material);
  context.quad.material = material;
  context.renderer.setRenderTarget(target);
  context.renderer.render(context.scene, context.camera);
};

const copyTexture = (
  context: ResolveOutputContext,
  nodeId: string,
  source: THREE.Texture,
  target: THREE.WebGLRenderTarget,
): void => {
  const material = context.getMaterial(`${nodeId}:paint-copy`, PAINT_COPY_SHADER, {
    u_texture: { value: source },
  });
  renderPass(context, material, target);
};

export const getPaintChannelMask = (channels: PaintStrokeChannels | undefined): THREE.Vector4 => {
  switch (channels ?? 'rgb') {
    case 'r':
      return new THREE.Vector4(1, 0, 0, 0);
    case 'g':
      return new THREE.Vector4(0, 1, 0, 0);
    case 'b':
      return new THREE.Vector4(0, 0, 1, 0);
    case 'a':
      return new THREE.Vector4(0, 0, 0, 1);
    default:
      return new THREE.Vector4(1, 1, 1, 0);
  }
};

const getRenderablePathPoints = (stroke: Pick<PaintStroke, 'path'>): Point[] =>
  stroke.path.mode === 'bspline' && stroke.path.points.length >= 3
    ? sampleBSplinePoints(stroke.path.points, false, undefined, 8)
    : stroke.path.points;

const renderStrokeMask = (
  context: ResolveOutputContext,
  stampRenderer: PaintStampRenderer,
  target: THREE.WebGLRenderTarget,
  points: readonly Point[],
  size: number,
  spacing: number,
  softness: number,
  opacity: number,
): void => {
  const stamps = collectPaintStampPoints(points, Math.max(0.25, size * spacing * 0.01));
  ensureStampCapacity(stampRenderer, stamps.length);
  for (let index = 0; index < stamps.length; index += 1) {
    const renderPoint = paintPointToRenderSpace(stamps[index]);
    stampRenderer.centers.setXY(index, renderPoint.x, renderPoint.y);
  }
  stampRenderer.centers.needsUpdate = true;
  stampRenderer.geometry.instanceCount = stamps.length;
  stampRenderer.material.uniforms.u_sceneSize.value.set(
    context.sceneNode.width,
    context.sceneNode.height,
  );
  stampRenderer.material.uniforms.u_brushSize.value = Math.max(1, size);
  stampRenderer.material.uniforms.u_softness.value = softness;
  stampRenderer.material.uniforms.u_opacity.value = opacity;

  context.clearRenderTargetTransparent(target);
  const renderer = context.renderer;
  const scissorTest = renderer.getScissorTest();
  renderer.setScissorTest(false);
  renderer.setRenderTarget(target);
  renderer.render(stampRenderer.scene, stampRenderer.camera);
  renderer.setScissorTest(scissorTest);
};

type RenderableStroke = Pick<
  PaintStroke,
  | 'tool'
  | 'size'
  | 'spacing'
  | 'softness'
  | 'opacity'
  | 'color'
  | 'alpha'
  | 'channels'
  | 'cloneOffset'
> & { points: readonly Point[] };

const compositeStroke = (
  nodeId: string,
  stroke: RenderableStroke,
  inputTexture: THREE.Texture,
  currentTarget: THREE.WebGLRenderTarget,
  outputTarget: THREE.WebGLRenderTarget,
  maskTarget: THREE.WebGLRenderTarget,
  context: ResolveOutputContext,
  stampRenderer: PaintStampRenderer,
): void => {
  renderStrokeMask(
    context,
    stampRenderer,
    maskTarget,
    stroke.points,
    stroke.size,
    stroke.spacing,
    stroke.softness,
    stroke.opacity,
  );
  const color = stroke.color ?? [1, 1, 1];
  const cloneOffsetUv = paintCloneOffsetToUv(
    stroke.cloneOffset,
    context.sceneNode.width,
    context.sceneNode.height,
  );
  const material = context.getMaterial(
    `${nodeId}:paint-stroke-composite`,
    PAINT_STROKE_COMPOSITE_SHADER,
    {
      u_current: { value: currentTarget.texture },
      u_input: { value: inputTexture },
      u_mask: { value: maskTarget.texture },
      u_channels: { value: getPaintChannelMask(stroke.channels) },
      u_paintValue: {
        value: new THREE.Vector4(color[0], color[1], color[2], stroke.alpha ?? 1),
      },
      u_cloneOffsetUv: {
        value: new THREE.Vector2(cloneOffsetUv.x, cloneOffsetUv.y),
      },
      u_tool: { value: stroke.tool === 'erase' ? 1 : stroke.tool === 'clone' ? 2 : 0 },
    },
  );
  renderPass(context, material, outputTarget);
};

const asRenderablePreview = (preview: PaintLivePreview): RenderableStroke => ({
  tool: preview.tool,
  points: getRenderablePathPoints(preview),
  size: preview.size,
  spacing: preview.spacing,
  softness: preview.softness,
  opacity: preview.opacity,
  color: preview.color,
  alpha: preview.alpha,
  channels: preview.channels,
  cloneOffset: preview.cloneOffset,
});

/** Render a Paint node entirely on the active float pipeline renderer. */
export const renderPaintGpu = (
  node: PaintNode,
  target: THREE.WebGLRenderTarget,
  inputTexture: THREE.Texture | undefined,
  context: ResolveOutputContext,
): boolean => {
  if (!context.getScratchRenderTarget) return false;
  const source = inputTexture ?? context.getTransparentInputTexture();
  // Working targets are shared by sequential Paint nodes. A third shared target
  // is allocated only while an interactive stroke needs a committed snapshot.
  const readA = context.getScratchRenderTarget('paint:working-a');
  const readB = context.getScratchRenderTarget('paint:working-b');
  const resources = getRendererResources(context.renderer);
  const mask = getStrokeMaskTarget(readA.width, readA.height, context, resources);
  const inputVersion = source.version;
  let state = resources.states.get(node.id);
  const preview = interactiveRenderers.has(context.renderer) ? getPaintLivePreview(node.id) : null;
  const committed = preview ? context.getScratchRenderTarget('paint:preview-committed') : null;
  const needsRebuild =
    !state ||
    state.strokes !== node.strokes ||
    state.layers !== node.layers ||
    state.frame !== context.frame ||
    state.width !== target.width ||
    state.height !== target.height ||
    state.nodes !== context.nodes ||
    state.inputTexture !== source ||
    state.inputVersion !== inputVersion ||
    state.committedTarget !== committed ||
    resources.committedOwner !== node.id;

  if (needsRebuild) {
    let current = readA;
    let next = readB;
    copyTexture(context, node.id, source, current);
    for (const stroke of getVisiblePaintStrokes(node, context.frame)) {
      compositeStroke(
        node.id,
        { ...stroke, points: getRenderablePathPoints(stroke) },
        source,
        current,
        next,
        mask,
        context,
        resources.stamps,
      );
      [current, next] = [next, current];
    }
    if (!preview || !committed) {
      resources.states.delete(node.id);
      copyTexture(context, node.id, current.texture, target);
      return true;
    }

    copyTexture(context, node.id, current.texture, committed);
    state = {
      strokes: node.strokes,
      layers: node.layers,
      frame: context.frame,
      width: target.width,
      height: target.height,
      nodes: context.nodes,
      inputTexture: source,
      inputVersion,
      committedTarget: committed,
    };
    resources.states.set(node.id, state);
    resources.committedOwner = node.id;
  }

  if (preview && committed && preview.path.points.length > 0) {
    copyTexture(context, node.id, committed.texture, readA);
    compositeStroke(
      node.id,
      asRenderablePreview(preview),
      source,
      readA,
      readB,
      mask,
      context,
      resources.stamps,
    );
    copyTexture(context, node.id, readB.texture, target);
  } else if (committed) {
    copyTexture(context, node.id, committed.texture, target);
  }
  return true;
};
