import { useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { createStudioRenderer, createStudioShaderMaterial } from '@blackboard/renderer';
import {
  NodeType,
  RotoPathBlend,
  RotoShapeType,
  RotoDrawMode,
  type AnyNode,
  type RotoNode,
  type SceneNode,
} from '@blackboard/types';
import type { RotoMotionBlurPreviewBackend } from '@/state/preferencesContext';
import { getValueAtFrame } from '@blackboard/renderer';
import { drawBSplineOnCanvas } from '@/utils/bspline';
import {
  getCanvasStorageColorTypeForBitDepth,
  resolveCanvasStorageColorType,
  type CanvasStorageColorType,
} from '@/utils/canvasColorType';
import {
  getVisibleRotoPaths,
  getRotoLayerMap,
  getRotoPathParentLayerId,
} from '@/utils/rotoHierarchy';
import { resolveRotoPathPointsAtFrame } from '@/utils/rotoTracking';
import {
  getRotoMotionBlurCanvasSampleWeights,
  getRotoMotionBlurSampleFrames,
  getRotoMotionBlurSampleWeights,
  resolveRotoMotionBlurPreviewSamples,
  resolveRotoMotionBlurSettings,
} from '@/utils/rotoMotionBlur';
import { DEFAULT_ROTO_POINT_WEIGHT_MODE, type RotoPointWeightMode } from '@/utils/rotoPointWeights';

interface RotoMaskEntry {
  texture: THREE.Texture;
  canvasTexture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  sampleCanvas: HTMLCanvasElement;
  sampleCtx: CanvasRenderingContext2D;
  requestedCanvasColorType: CanvasStorageColorType;
  accCanvas?: HTMLCanvasElement;
  accCtx?: CanvasRenderingContext2D;
  gpuSampleTexture?: THREE.CanvasTexture;
  gpuTarget?: THREE.WebGLRenderTarget;
  dispose: () => void;
}

interface UseViewportRotoMasksOptions {
  nodes: AnyNode[];
  sceneNode?: SceneNode;
  currentFrame: number;
  motionBlurPreviewBackend: RotoMotionBlurPreviewBackend;
  interactiveMotionBlurPreviewEnabled: boolean;
  interactiveMotionBlurPreviewActive: boolean;
  interactiveMotionBlurPreviewSamples: number;
  rotoPointWeightMode: RotoPointWeightMode;
  suspendMaskUpdatesWhileEditing: boolean;
  bumpMediaUpdate: () => void;
}

interface RotoMaskGpuCompositor {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  accumulationMaterial: THREE.ShaderMaterial;
  copyMaterial: THREE.ShaderMaterial;
  quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial | THREE.MeshBasicMaterial>;
}

const MASK_ACCUMULATION_VERTEX_SHADER = `
in vec3 position;
in vec2 uv;
out vec2 v_uv;

void main() {
  v_uv = uv;
  gl_Position = vec4(position, 1.0);
}
`;

const MASK_ACCUMULATION_FRAGMENT_SHADER = `
precision highp float;

uniform sampler2D u_tMask;
uniform float u_weight;
in vec2 v_uv;
out vec4 fragColor;

void main() {
  float mask = texture(u_tMask, v_uv).r * u_weight;
  fragColor = vec4(mask, mask, mask, 1.0);
}
`;

const MASK_COPY_FRAGMENT_SHADER = `
precision highp float;

uniform sampler2D u_tMask;
in vec2 v_uv;
out vec4 fragColor;

void main() {
  float mask = texture(u_tMask, v_uv).r;
  fragColor = vec4(mask, mask, mask, 1.0);
}
`;

const disposeMaskEntry = (entry: RotoMaskEntry): void => {
  entry.canvasTexture.dispose();
  entry.gpuSampleTexture?.dispose();
  entry.gpuTarget?.dispose();
};

const createGpuCompositor = (): RotoMaskGpuCompositor | null => {
  try {
    const renderer = createStudioRenderer({
      canvas: document.createElement('canvas'),
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
      pixelRatio: 1,
    });

    const hasGpuFloatSupport = renderer.extensions.has('EXT_color_buffer_float');
    if (!hasGpuFloatSupport) {
      renderer.dispose();
      return null;
    }

    renderer.autoClear = false;
    renderer.setClearColor(0x000000, 1);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    camera.position.z = 1;

    const accumulationMaterial = createStudioShaderMaterial({
      vertexShader: MASK_ACCUMULATION_VERTEX_SHADER,
      fragmentShader: MASK_ACCUMULATION_FRAGMENT_SHADER,
      uniforms: {
        u_tMask: { value: null },
        u_weight: { value: 1 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });

    const copyMaterial = createStudioShaderMaterial({
      vertexShader: MASK_ACCUMULATION_VERTEX_SHADER,
      fragmentShader: MASK_COPY_FRAGMENT_SHADER,
      uniforms: {
        u_tMask: { value: null },
      },
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), accumulationMaterial);
    scene.add(quad);

    return { renderer, scene, camera, accumulationMaterial, copyMaterial, quad };
  } catch {
    return null;
  }
};

const disposeGpuCompositor = (compositor: RotoMaskGpuCompositor): void => {
  compositor.quad.geometry.dispose();
  compositor.accumulationMaterial.dispose();
  compositor.copyMaterial.dispose();
  compositor.renderer.dispose();
  compositor.renderer.forceContextLoss?.();
};

const ensureGpuTarget = (
  entry: RotoMaskEntry,
  width: number,
  height: number,
): THREE.WebGLRenderTarget | null => {
  if (entry.gpuTarget && entry.gpuTarget.width === width && entry.gpuTarget.height === height) {
    return entry.gpuTarget;
  }

  entry.gpuTarget?.dispose();

  try {
    const target = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      colorSpace: THREE.NoColorSpace,
      depthBuffer: false,
      stencilBuffer: false,
    });
    target.texture.generateMipmaps = false;
    target.texture.colorSpace = THREE.NoColorSpace;
    entry.gpuTarget = target;
    return target;
  } catch {
    entry.gpuTarget = undefined;
    return null;
  }
};

const ensureGpuSampleTexture = (entry: RotoMaskEntry): THREE.CanvasTexture => {
  if (entry.gpuSampleTexture) {
    return entry.gpuSampleTexture;
  }

  const sampleTexture = new THREE.CanvasTexture(entry.sampleCanvas);
  sampleTexture.minFilter = THREE.LinearFilter;
  sampleTexture.magFilter = THREE.LinearFilter;
  sampleTexture.generateMipmaps = false;
  sampleTexture.colorSpace = THREE.NoColorSpace;
  entry.gpuSampleTexture = sampleTexture;
  return sampleTexture;
};

const ensureAccCanvas = (
  entry: RotoMaskEntry,
  width: number,
  height: number,
): { accCanvas: HTMLCanvasElement; accCtx: CanvasRenderingContext2D } | null => {
  if (
    entry.accCanvas &&
    entry.accCtx &&
    entry.accCanvas.width === width &&
    entry.accCanvas.height === height
  ) {
    return { accCanvas: entry.accCanvas, accCtx: entry.accCtx };
  }

  const accCanvas = document.createElement('canvas');
  accCanvas.width = width;
  accCanvas.height = height;
  const accCtx = getCanvas2dContext(accCanvas, entry.requestedCanvasColorType);
  if (!accCtx) return null;

  entry.accCanvas = accCanvas;
  entry.accCtx = accCtx.ctx;
  return { accCanvas, accCtx: accCtx.ctx };
};

const getCanvas2dContext = (
  canvas: HTMLCanvasElement,
  requestedColorType: CanvasStorageColorType,
): { ctx: CanvasRenderingContext2D; actualColorType: CanvasStorageColorType } | null => {
  const requestedOptions =
    requestedColorType === 'float16' ? ({ colorType: 'float16' } as any) : undefined;
  const ctx = requestedOptions
    ? ((canvas.getContext('2d', requestedOptions) as CanvasRenderingContext2D | null) ??
      canvas.getContext('2d'))
    : canvas.getContext('2d');
  if (!ctx) return null;

  const attributes =
    typeof (ctx as any).getContextAttributes === 'function'
      ? ((ctx as any).getContextAttributes() as { colorType?: unknown } | null)
      : null;

  return {
    ctx,
    actualColorType: resolveCanvasStorageColorType(attributes),
  };
};

export const useViewportRotoMasks = ({
  nodes,
  sceneNode,
  currentFrame,
  motionBlurPreviewBackend,
  interactiveMotionBlurPreviewEnabled,
  interactiveMotionBlurPreviewActive,
  interactiveMotionBlurPreviewSamples,
  rotoPointWeightMode,
  suspendMaskUpdatesWhileEditing,
  bumpMediaUpdate,
}: UseViewportRotoMasksOptions) => {
  const rotoMaskTexturesRef = useRef<Map<string, RotoMaskEntry>>(new Map());
  const gpuCompositorRef = useRef<RotoMaskGpuCompositor | null | 'unavailable'>(null);
  const previousBackendRef = useRef<RotoMotionBlurPreviewBackend | null>(null);
  const previousPointWeightModeRef = useRef<RotoPointWeightMode>(DEFAULT_ROTO_POINT_WEIGHT_MODE);
  const previousInteractivePreviewRef = useRef<{
    enabled: boolean;
    active: boolean;
    samples: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!sceneNode) return;

    const getGpuCompositor = (): RotoMaskGpuCompositor | null => {
      if (gpuCompositorRef.current === 'unavailable') return null;
      if (gpuCompositorRef.current) return gpuCompositorRef.current;

      const compositor = createGpuCompositor();
      if (!compositor) {
        gpuCompositorRef.current = 'unavailable';
        return null;
      }

      gpuCompositorRef.current = compositor;
      return compositor;
    };

    const rotoNodes = nodes.filter(
      (node) => node.type === NodeType.ROTO && node.visible,
    ) as RotoNode[];
    const nextMasks = new Map<string, RotoMaskEntry>();
    let didUpdate = false;

    if (
      previousBackendRef.current !== null &&
      previousBackendRef.current !== motionBlurPreviewBackend &&
      !suspendMaskUpdatesWhileEditing
    ) {
      didUpdate = true;
    }
    previousBackendRef.current = motionBlurPreviewBackend;
    if (
      previousPointWeightModeRef.current !== rotoPointWeightMode &&
      !suspendMaskUpdatesWhileEditing
    ) {
      didUpdate = true;
    }
    previousPointWeightModeRef.current = rotoPointWeightMode;

    const nextInteractivePreviewState = {
      enabled: interactiveMotionBlurPreviewEnabled,
      active: interactiveMotionBlurPreviewActive,
      samples: interactiveMotionBlurPreviewSamples,
    };
    if (
      previousInteractivePreviewRef.current &&
      (previousInteractivePreviewRef.current.enabled !== nextInteractivePreviewState.enabled ||
        previousInteractivePreviewRef.current.active !== nextInteractivePreviewState.active ||
        previousInteractivePreviewRef.current.samples !== nextInteractivePreviewState.samples) &&
      !suspendMaskUpdatesWhileEditing
    ) {
      didUpdate = true;
    }
    previousInteractivePreviewRef.current = nextInteractivePreviewState;

    rotoNodes.forEach((node) => {
      const visiblePaths = getVisibleRotoPaths(node);
      const getActivePathsAtFrame = (frame: number) =>
        visiblePaths.filter((path) => getValueAtFrame(path.opacity, frame) > 0);
      const layerMap = getRotoLayerMap(node);
      const getBlendForPath = (path: RotoNode['paths'][number]) => {
        const parentLayerId = getRotoPathParentLayerId(node, path);
        const layer = parentLayerId ? layerMap.get(parentLayerId) : undefined;
        return layer?.blend ?? path.blend;
      };
      const requestedCanvasColorType = getCanvasStorageColorTypeForBitDepth(sceneNode.bitDepth);
      let entry = rotoMaskTexturesRef.current.get(node.id);
      const needsResize =
        !entry ||
        entry.canvas.width !== sceneNode.width ||
        entry.canvas.height !== sceneNode.height ||
        entry.sampleCanvas.width !== sceneNode.width ||
        entry.sampleCanvas.height !== sceneNode.height ||
        entry.requestedCanvasColorType !== requestedCanvasColorType;
      // When the viewer is ignoring alpha entirely, keep the last matte texture
      // until the interaction ends instead of burning time on invisible updates.
      const shouldReuseFrozenMask = suspendMaskUpdatesWhileEditing && !!entry && !needsResize;

      if (shouldReuseFrozenMask) {
        nextMasks.set(node.id, entry);
        return;
      }

      if (!entry || needsResize) {
        if (entry) {
          disposeMaskEntry(entry);
        }

        const canvas = document.createElement('canvas');
        canvas.width = sceneNode.width;
        canvas.height = sceneNode.height;
        const canvasContext = getCanvas2dContext(canvas, requestedCanvasColorType);
        if (!canvasContext) return;

        const sampleCanvas = document.createElement('canvas');
        sampleCanvas.width = sceneNode.width;
        sampleCanvas.height = sceneNode.height;
        const sampleContext = getCanvas2dContext(sampleCanvas, requestedCanvasColorType);
        if (!sampleContext) return;

        const canvasTexture = new THREE.CanvasTexture(canvas);
        canvasTexture.minFilter = THREE.LinearFilter;
        canvasTexture.magFilter = THREE.LinearFilter;
        canvasTexture.generateMipmaps = false;
        canvasTexture.colorSpace = THREE.NoColorSpace;

        const nextEntry: RotoMaskEntry = {
          texture: canvasTexture,
          canvasTexture,
          canvas,
          ctx: canvasContext.ctx,
          sampleCanvas,
          sampleCtx: sampleContext.ctx,
          requestedCanvasColorType,
          dispose: () => {
            disposeMaskEntry(nextEntry);
          },
        };
        entry = nextEntry;
        didUpdate = true;
      }

      const { canvas, ctx, canvasTexture, sampleCanvas, sampleCtx } = entry;

      const drawPathGeometry = (
        targetCtx: CanvasRenderingContext2D,
        path: RotoNode['paths'][number],
        frame: number,
      ) => {
        const { mode, strokeWidth } = path.style;
        const strokeWidthAtFrame = getValueAtFrame(strokeWidth, frame);

        targetCtx.save();
        targetCtx.globalCompositeOperation = 'source-over';
        targetCtx.fillStyle = 'white';
        targetCtx.strokeStyle = 'white';

        targetCtx.beginPath();
        if (path.points.length > 0) {
          const sceneCenterX = canvas.width / 2;
          const sceneCenterY = canvas.height / 2;
          const resolvedPoints = resolveRotoPathPointsAtFrame(node, path, frame);
          const translatedPoints = resolvedPoints.map((p) => ({
            x: p.x + sceneCenterX,
            y: p.y + sceneCenterY,
          }));
          if (path.shapeType === RotoShapeType.BSPLINE) {
            drawBSplineOnCanvas(
              targetCtx,
              translatedPoints,
              path.closed,
              path.pointWeights,
              rotoPointWeightMode,
              path.pointTypes,
              path.pointWeightModes,
            );
          } else {
            targetCtx.moveTo(translatedPoints[0].x, translatedPoints[0].y);
            for (let i = 1; i < translatedPoints.length; i += 1) {
              targetCtx.lineTo(translatedPoints[i].x, translatedPoints[i].y);
            }
          }
        }

        if (path.closed) targetCtx.closePath();
        targetCtx.lineWidth = strokeWidthAtFrame;
        if (mode === RotoDrawMode.FILL) {
          if (path.closed) targetCtx.fill();
        } else if (mode === RotoDrawMode.STROKE) {
          targetCtx.stroke();
        } else if (mode === RotoDrawMode.FILL_AND_STROKE) {
          if (path.closed) targetCtx.fill();
          targetCtx.stroke();
        }
        targetCtx.restore();
      };

      const drawPathAtFrame = (
        targetCtx: CanvasRenderingContext2D,
        path: RotoNode['paths'][number],
        frame: number,
        skipFeather?: boolean,
      ) => {
        const feather = getValueAtFrame(path.feather, frame);
        const opacity = getValueAtFrame(path.opacity, frame);
        const { mode, strokeWidth } = path.style;
        const strokeWidthAtFrame = getValueAtFrame(strokeWidth, frame);

        targetCtx.save();
        targetCtx.globalAlpha = opacity / 100.0;
        const blend = getBlendForPath(path);
        if (node.invert) {
          targetCtx.globalCompositeOperation =
            blend === RotoPathBlend.ADD ? 'destination-out' : 'destination-in';
          targetCtx.fillStyle = 'black';
          targetCtx.strokeStyle = 'black';
        } else {
          targetCtx.globalCompositeOperation =
            blend === RotoPathBlend.SUBTRACT ? 'destination-out' : 'source-over';
          targetCtx.fillStyle = 'white';
          targetCtx.strokeStyle = 'white';
        }
        if (!skipFeather && feather > 0) targetCtx.filter = `blur(${feather}px)`;

        targetCtx.beginPath();
        if (path.points.length > 0) {
          const sceneCenterX = canvas.width / 2;
          const sceneCenterY = canvas.height / 2;
          const resolvedPoints = resolveRotoPathPointsAtFrame(node, path, frame);
          const translatedPoints = resolvedPoints.map((p) => ({
            x: p.x + sceneCenterX,
            y: p.y + sceneCenterY,
          }));
          if (path.shapeType === RotoShapeType.BSPLINE) {
            drawBSplineOnCanvas(
              targetCtx,
              translatedPoints,
              path.closed,
              path.pointWeights,
              rotoPointWeightMode,
              path.pointTypes,
              path.pointWeightModes,
            );
          } else {
            targetCtx.moveTo(translatedPoints[0].x, translatedPoints[0].y);
            for (let i = 1; i < translatedPoints.length; i += 1) {
              targetCtx.lineTo(translatedPoints[i].x, translatedPoints[i].y);
            }
          }
        }

        if (path.closed) targetCtx.closePath();
        targetCtx.lineWidth = strokeWidthAtFrame;
        if (mode === RotoDrawMode.FILL) {
          if (path.closed) targetCtx.fill();
        } else if (mode === RotoDrawMode.STROKE) {
          targetCtx.stroke();
        } else if (mode === RotoDrawMode.FILL_AND_STROKE) {
          if (path.closed) targetCtx.fill();
          targetCtx.stroke();
        }
        targetCtx.restore();
      };

      const clearMask = (targetCtx: CanvasRenderingContext2D, invert: boolean) => {
        targetCtx.setTransform(1, 0, 0, 1, 0, 0);
        targetCtx.clearRect(0, 0, canvas.width, canvas.height);
        targetCtx.fillStyle = invert ? 'white' : 'black';
        targetCtx.fillRect(0, 0, canvas.width, canvas.height);
      };

      const renderMaskAtFrame = (
        targetCtx: CanvasRenderingContext2D,
        frame: number,
        skipFeather?: boolean,
      ) => {
        clearMask(targetCtx, node.invert);
        for (const path of getActivePathsAtFrame(frame)) {
          drawPathAtFrame(targetCtx, path, frame, skipFeather);
        }
      };

      const motionBlur = resolveRotoMotionBlurSettings(node.motionBlur);
      const motionBlurEnabled = motionBlur.enabled && motionBlur.shutter > 0;
      const maxFrame = Math.max(0, sceneNode.maxFrames ?? 0);
      const previousTexture = entry.texture;

      if (motionBlurEnabled) {
        const previewSamples = resolveRotoMotionBlurPreviewSamples(motionBlur.samples, {
          interactivePreviewEnabled: interactiveMotionBlurPreviewEnabled,
          interactivePreviewActive: interactiveMotionBlurPreviewActive,
          interactivePreviewSamples: interactiveMotionBlurPreviewSamples,
        });
        const sampleFrames = getRotoMotionBlurSampleFrames(
          currentFrame,
          motionBlur.shutter,
          previewSamples,
          motionBlur.phase,
        );
        const sampleWeights = getRotoMotionBlurSampleWeights(sampleFrames.length);
        const canvasSampleWeights = getRotoMotionBlurCanvasSampleWeights(sampleWeights);

        const shouldUseGpu = motionBlurPreviewBackend === 'gpu_float';
        let usedGpu = false;

        if (shouldUseGpu) {
          const compositor = getGpuCompositor();
          const target = compositor ? ensureGpuTarget(entry, canvas.width, canvas.height) : null;

          if (compositor && target) {
            const sampleTexture = ensureGpuSampleTexture(entry);
            compositor.renderer.setSize(canvas.width, canvas.height, false);
            compositor.renderer.setRenderTarget(target);
            compositor.renderer.clear();

            compositor.quad.material = compositor.accumulationMaterial;
            compositor.accumulationMaterial.uniforms.u_tMask.value = sampleTexture;

            for (let sampleIndex = 0; sampleIndex < sampleFrames.length; sampleIndex += 1) {
              const sampleFrame = sampleFrames[sampleIndex];
              const clampedFrame = Math.max(0, Math.min(maxFrame, sampleFrame));
              compositor.accumulationMaterial.uniforms.u_weight.value = sampleWeights[sampleIndex];
              renderMaskAtFrame(sampleCtx, clampedFrame);
              sampleTexture.needsUpdate = true;
              compositor.renderer.render(compositor.scene, compositor.camera);
            }

            // Copy float-accumulated mask to a CPU-shareable canvas texture for the main renderer.
            compositor.quad.material = compositor.copyMaterial;
            compositor.copyMaterial.uniforms.u_tMask.value = target.texture;
            compositor.renderer.setRenderTarget(null);
            compositor.renderer.clear();
            compositor.renderer.render(compositor.scene, compositor.camera);

            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(compositor.renderer.domElement, 0, 0, canvas.width, canvas.height);
            canvasTexture.needsUpdate = true;
            entry.texture = canvasTexture;
            usedGpu = true;
          }
        }

        if (!usedGpu) {
          const activePathsAtCurrentFrame = getActivePathsAtFrame(currentFrame);
          // Check if any path has feather at the current frame.
          const hasFeather = activePathsAtCurrentFrame.some(
            (p) => getValueAtFrame(p.feather, currentFrame) > 0,
          );

          if (hasFeather) {
            // Per-path post-process feather: accumulate each path's motion
            // blur samples without feather, then apply that path's own feather
            // as a single blur pass. This avoids the 8-bit quantization banding
            // that occurs when per-sample 1/N-weighted draws are individually
            // blurred before additive accumulation into an 8-bit canvas.
            const acc = ensureAccCanvas(entry, canvas.width, canvas.height);
            if (!acc) {
              // Fallback: render without post-process feather optimisation.
              clearMask(ctx, false);
              for (let sampleIndex = 0; sampleIndex < sampleFrames.length; sampleIndex += 1) {
                const sampleFrame = sampleFrames[sampleIndex];
                const clampedFrame = Math.max(0, Math.min(maxFrame, sampleFrame));
                renderMaskAtFrame(sampleCtx, clampedFrame);
                ctx.save();
                ctx.globalCompositeOperation = 'lighter';
                ctx.globalAlpha = canvasSampleWeights[sampleIndex];
                ctx.drawImage(sampleCanvas, 0, 0);
                ctx.restore();
              }
            } else {
              const { accCanvas: accCvs, accCtx: accC } = acc;
              const w = canvas.width;
              const h = canvas.height;

              clearMask(ctx, node.invert);

              for (const path of activePathsAtCurrentFrame) {
                const feather = getValueAtFrame(path.feather, currentFrame);
                const opacity = getValueAtFrame(path.opacity, currentFrame);

                // Accumulate this path's motion blur (raw shape, no feather).
                accC.setTransform(1, 0, 0, 1, 0, 0);
                accC.clearRect(0, 0, w, h);

                for (let sampleIndex = 0; sampleIndex < sampleFrames.length; sampleIndex += 1) {
                  const sampleFrame = sampleFrames[sampleIndex];
                  const clampedFrame = Math.max(0, Math.min(maxFrame, sampleFrame));
                  sampleCtx.setTransform(1, 0, 0, 1, 0, 0);
                  sampleCtx.clearRect(0, 0, w, h);
                  drawPathGeometry(sampleCtx, path, clampedFrame);

                  accC.save();
                  accC.globalCompositeOperation = 'lighter';
                  accC.globalAlpha = canvasSampleWeights[sampleIndex];
                  accC.drawImage(sampleCanvas, 0, 0);
                  accC.restore();
                }

                // Apply this path's feather as a post-process blur.
                if (feather > 0) {
                  sampleCtx.setTransform(1, 0, 0, 1, 0, 0);
                  sampleCtx.clearRect(0, 0, w, h);
                  sampleCtx.drawImage(accCvs, 0, 0);

                  accC.setTransform(1, 0, 0, 1, 0, 0);
                  accC.clearRect(0, 0, w, h);
                  accC.save();
                  accC.filter = `blur(${feather}px)`;
                  accC.drawImage(sampleCanvas, 0, 0);
                  accC.restore();
                }

                // Composite this path onto the final mask.
                ctx.save();
                ctx.globalAlpha = opacity / 100.0;
                const blend = getBlendForPath(path);
                if (node.invert) {
                  ctx.globalCompositeOperation =
                    blend === RotoPathBlend.ADD ? 'destination-out' : 'destination-in';
                } else {
                  ctx.globalCompositeOperation =
                    blend === RotoPathBlend.SUBTRACT ? 'destination-out' : 'source-over';
                }
                ctx.drawImage(accCvs, 0, 0);
                ctx.restore();
              }
            }
          } else {
            // No feather — accumulate directly (original fast path).
            clearMask(ctx, false);
            for (let sampleIndex = 0; sampleIndex < sampleFrames.length; sampleIndex += 1) {
              const sampleFrame = sampleFrames[sampleIndex];
              const clampedFrame = Math.max(0, Math.min(maxFrame, sampleFrame));
              renderMaskAtFrame(sampleCtx, clampedFrame);

              ctx.save();
              ctx.globalCompositeOperation = 'lighter';
              ctx.globalAlpha = canvasSampleWeights[sampleIndex];
              ctx.drawImage(sampleCanvas, 0, 0);
              ctx.restore();
            }
          }

          canvasTexture.needsUpdate = true;
          entry.texture = canvasTexture;
        }
      } else {
        renderMaskAtFrame(ctx, currentFrame);
        canvasTexture.needsUpdate = true;
        entry.texture = canvasTexture;
      }

      if (entry.texture !== previousTexture) {
        didUpdate = true;
      }

      nextMasks.set(node.id, entry);
    });

    rotoMaskTexturesRef.current.forEach((entry, id) => {
      if (!nextMasks.has(id)) {
        entry.dispose();
        didUpdate = true;
      }
    });

    rotoMaskTexturesRef.current = nextMasks;
    if (didUpdate) bumpMediaUpdate();
  }, [
    nodes,
    currentFrame,
    sceneNode,
    motionBlurPreviewBackend,
    interactiveMotionBlurPreviewEnabled,
    interactiveMotionBlurPreviewActive,
    interactiveMotionBlurPreviewSamples,
    rotoPointWeightMode,
    suspendMaskUpdatesWhileEditing,
    bumpMediaUpdate,
  ]);

  useLayoutEffect(() => {
    return () => {
      rotoMaskTexturesRef.current.forEach((entry) => {
        entry.dispose();
      });
      rotoMaskTexturesRef.current.clear();

      if (gpuCompositorRef.current && gpuCompositorRef.current !== 'unavailable') {
        disposeGpuCompositor(gpuCompositorRef.current);
      }
      gpuCompositorRef.current = null;
    };
  }, []);

  return rotoMaskTexturesRef;
};
