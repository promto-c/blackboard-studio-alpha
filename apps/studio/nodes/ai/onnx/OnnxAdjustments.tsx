import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import { usePreferences } from '@/state/preferencesContext';
import { useInstalledOnnxModels } from '@/state/installedOnnxModelsContext';
import { saveAsset } from '@/state/assetStorage';
import { useNodeExecutionHandler } from '@/hooks/useNodeExecutionHandler';
import {
  isBackgroundJobActive,
  registerBackgroundJobCancelHandler,
} from '@/state/editor/services/backgroundJobs';
import { CollapsibleSection, StyledDropdown, ToggleSwitch } from '@blackboard/ui';
import { SegmentedControl, Slider } from '@/components';
import {
  AnyNode,
  Flow,
  NodeType,
  OnnxBackend,
  OnnxChannelMode,
  OnnxModelNode,
  OnnxNodeOutput,
  OnnxNormalization,
  OnnxResultBehavior,
  RotoNode,
  SceneNode,
} from '@blackboard/types';
import { remapInputsOnModelChange } from '../../portMapping';
import { getInstalledOnnxModel } from '@/services/onnx/modelCache';
import {
  getResolvedInputMetadata,
  primeMetadataFromModel,
} from '@/services/onnx/onnxMetadataCache';
import {
  FloatInput,
  getOnnxRuntimeCompatibility,
  getOnnxOutputCache,
  runOnnxModel,
  setOnnxOutputCache,
} from '@/services/onnx/onnxRuntime';
import { GENERIC_ONNX_RECIPE } from '@/services/onnx/modelRegistry';
import { calculateTransformForFitMode } from '@/state/editor/selectors';
import { createMaskCanvas } from '@/utils/rotoMaskTexture';
import { renderNodeInputFrameToFloat, renderNodeInputFrameToPngBlob } from '@/utils/nodeInputFrame';
import { isCustomImageFitMode } from '@/nodes/imageFitMode';
import { Link } from '@blackboard/icons';
import { OnnxRunButtonGroup } from './OnnxRunButtonGroup';
import { useOnnxModelMetadata } from './useOnnxModelMetadata';
import SourceTransformControls from '../../SourceTransformControls';

const MIN_INPUT_SIZE = 64;
const MAX_INPUT_SIZE = 8192;

const clampInputSize = (value: number): number =>
  Math.max(MIN_INPUT_SIZE, Math.min(MAX_INPUT_SIZE, Math.round(value)));

const rotoMaskCanvasWithAlpha = (
  rotoNode: RotoNode,
  sceneNode: SceneNode,
  frame: number,
): HTMLCanvasElement | null => {
  const srcCanvas = createMaskCanvas(rotoNode, sceneNode, frame);
  if (!srcCanvas) return null;
  const srcCtx = srcCanvas.getContext('2d');
  if (!srcCtx) return null;

  const dstCanvas = document.createElement('canvas');
  dstCanvas.width = srcCanvas.width;
  dstCanvas.height = srcCanvas.height;
  const dstCtx = dstCanvas.getContext('2d');
  if (!dstCtx) return null;

  const srcData = srcCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
  const dstData = dstCtx.createImageData(srcCanvas.width, srcCanvas.height);
  for (let i = 0; i < dstData.data.length; i += 4) {
    const lum =
      0.2126 * srcData.data[i] + 0.7152 * srcData.data[i + 1] + 0.0722 * srcData.data[i + 2];
    dstData.data[i] = 255;
    dstData.data[i + 1] = 255;
    dstData.data[i + 2] = 255;
    dstData.data[i + 3] = lum;
  }
  dstCtx.putImageData(dstData, 0, 0);
  return dstCanvas;
};

function InputPreview({
  sourceNode,
  allNodes,
  flows,
  currentFrame,
  sceneNode,
  width = 64,
}: {
  sourceNode: AnyNode | null;
  allNodes: AnyNode[];
  flows: Record<string, Flow>;
  currentFrame: number;
  sceneNode?: SceneNode;
  width?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sourceNode) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let cancelled = false;

    const render = async () => {
      if (sourceNode.type === NodeType.ROTO) {
        if (!sceneNode) return;
        const maskCanvas = createMaskCanvas(sourceNode as RotoNode, sceneNode, currentFrame);
        if (!maskCanvas || cancelled) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height);
      } else {
        if (!sceneNode) return;
        const blob = await renderNodeInputFrameToPngBlob({
          nodes: allNodes,
          flows,
          sourceNodeId: sourceNode.id,
          sceneNode,
          frame: currentFrame,
          finalColorSpace: sceneNode.colorSpace === 'Linear' ? 'srgb' : 'raw_texture',
        });
        if (!blob || cancelled) return;
        const bitmap = await createImageBitmap(blob);
        if (cancelled) {
          bitmap.close();
          return;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
      }
    };

    const timeoutId = window.setTimeout(() => {
      void render().catch((error) => {
        if (!cancelled) {
          console.error('Failed to render ONNX input preview', error);
        }
      });
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [sourceNode, allNodes, flows, currentFrame, sceneNode]);

  if (!sourceNode) return null;

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={width}
      className="mt-1 rounded border border-white/10 bg-black/40"
      style={{
        width: `${width}px`,
        height: `${width}px`,
        objectFit: 'contain',
        imageRendering: 'pixelated',
      }}
    />
  );
}

const formatBytes = (bytes?: number): string => {
  if (!bytes) return 'Unknown size';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const RESULT_BEHAVIOR_OPTIONS: { value: OnnxResultBehavior; label: string }[] = [
  { value: 'static', label: 'Static Image' },
  { value: 'frame_sequence', label: 'Frame Sequence' },
];

function OnnxAdjustments({ node: anyNode }: { node: AnyNode }) {
  const node = anyNode as OnnxModelNode;
  const {
    updateNode,
    startBackgroundJob,
    updateBackgroundJob,
    finishBackgroundJob,
    requestBackgroundJobCancel,
  } = useEditorActions();
  const { onnxRuntimeWebGpuEnabled, onnxRuntimeWasmEnabled } = usePreferences();
  const allNodes = useEditorSelector((state) => state.nodes);
  const flows = useEditorSelector((state) => state.flows);
  const currentFrame = useEditorSelector((state) => state.currentFrame);
  const backgroundJobs = useEditorSelector((state) => state.backgroundJobs);
  const projectId = useEditorSelector((state) => state.projectId);
  const { models: installedModels } = useInstalledOnnxModels();
  const [localError, setLocalError] = useState<string | null>(node.lastError ?? null);
  const [activeInferenceJobId, setActiveInferenceJobId] = useState<string | null>(null);
  const hasPendingInferenceRef = useRef(false);
  const compatibility = useMemo(
    () =>
      getOnnxRuntimeCompatibility({
        webgpuEnabled: onnxRuntimeWebGpuEnabled,
        wasmEnabled: onnxRuntimeWasmEnabled,
      }),
    [onnxRuntimeWasmEnabled, onnxRuntimeWebGpuEnabled],
  );
  const recipe = GENERIC_ONNX_RECIPE;
  const sceneNode = useEditorSelector(
    (state) => state.nodes.find((n) => n.type === NodeType.SCENE) as SceneNode | undefined,
  );
  const selectedModel = installedModels.find((model) => model.id === node.modelId) ?? null;
  const { inputMetadata, outputMetadata, isLoadingMetadata, metadataError, retryMetadata } =
    useOnnxModelMetadata(selectedModel, node.backend);
  const [openChannelPopup, setOpenChannelPopup] = useState<string | null>(null);
  const [openNormalizationPopup, setOpenNormalizationPopup] = useState<string | null>(null);
  const [inputSizeLinked, setInputSizeLinked] = useState(true);

  const nodeOutputs = useMemo(() => node.outputs ?? [], [node.outputs]);
  const activeOutputId = node.activeOutputId;

  const currentActiveOutput = useMemo(
    () => nodeOutputs.find((o) => o.id === activeOutputId) ?? null,
    [nodeOutputs, activeOutputId],
  );
  const modelInputPorts = useMemo(() => {
    return inputMetadata && inputMetadata.length > 0 ? inputMetadata : null;
  }, [inputMetadata]);

  const imageInputPorts = useMemo(
    () => modelInputPorts?.filter((m) => m.kind === 'image') ?? null,
    [modelInputPorts],
  );
  const scalarInputPorts = useMemo(
    () => modelInputPorts?.filter((m) => m.kind === 'scalar') ?? null,
    [modelInputPorts],
  );

  const connectedImageInputs = useMemo(() => {
    const map: Record<string, AnyNode | null> = {};
    if (imageInputPorts) {
      for (const port of imageInputPorts) {
        const sourceId = node.inputs?.[port.name];
        map[port.name] = sourceId
          ? (allNodes.find((candidate) => candidate.id === sourceId) ?? null)
          : null;
      }
    } else {
      const sourceId = node.inputs?.image;
      map['image'] = sourceId
        ? (allNodes.find((candidate) => candidate.id === sourceId) ?? null)
        : null;
    }
    return map;
  }, [imageInputPorts, node.inputs, allNodes]);

  const activeInferenceJob = useMemo(
    () =>
      backgroundJobs.find(
        (job) =>
          job.type === 'onnx-inference' &&
          job.source?.nodeId === node.id &&
          isBackgroundJobActive(job),
      ) ?? null,
    [backgroundJobs, node.id],
  );
  const isInferenceRunning = activeInferenceJob !== null;

  React.useEffect(() => {
    setLocalError(node.lastError ?? null);
  }, [node.lastError]);

  const handleUpdateScalarInput = useCallback(
    (name: string, value: number | string | boolean) => {
      const next = { ...(node.inputValues ?? {}), [name]: value };
      updateNode(node.id, { inputValues: next }, true);
    },
    [node.id, node.inputValues, updateNode],
  );

  const handleInputSizeChange = useCallback(
    (axis: 'width' | 'height', value: number) => {
      const nextValue = clampInputSize(value);
      const currentWidth = clampInputSize(node.inputSize.width);
      const currentHeight = clampInputSize(node.inputSize.height);
      const aspectRatio = currentWidth / currentHeight || 1;

      const nextInputSize =
        axis === 'width'
          ? {
              width: nextValue,
              height: inputSizeLinked ? clampInputSize(nextValue / aspectRatio) : currentHeight,
            }
          : {
              width: inputSizeLinked ? clampInputSize(nextValue * aspectRatio) : currentWidth,
              height: nextValue,
            };

      updateNode(node.id, { inputSize: nextInputSize });
    },
    [inputSizeLinked, node.id, node.inputSize.height, node.inputSize.width, updateNode],
  );

  const handleInputSizeReset = useCallback(
    (axis: 'width' | 'height') => {
      const resetSize = sceneNode
        ? { width: sceneNode.width, height: sceneNode.height }
        : recipe.defaultInputSize;
      const currentWidth = clampInputSize(node.inputSize.width);
      const currentHeight = clampInputSize(node.inputSize.height);

      updateNode(node.id, {
        inputSize:
          inputSizeLinked || axis === 'width'
            ? {
                width: clampInputSize(resetSize.width),
                height: inputSizeLinked ? clampInputSize(resetSize.height) : currentHeight,
              }
            : {
                width: currentWidth,
                height: clampInputSize(resetSize.height),
              },
      });
    },
    [
      inputSizeLinked,
      node.id,
      node.inputSize.height,
      node.inputSize.width,
      recipe.defaultInputSize,
      sceneNode,
      updateNode,
    ],
  );

  const runNode = useCallback(
    async (framesToProcess?: number[]) => {
      if (hasPendingInferenceRef.current) return;
      hasPendingInferenceRef.current = true;
      setLocalError(null);

      if (!node.modelId) {
        hasPendingInferenceRef.current = false;
        setLocalError('Choose an installed ONNX model before running this node.');
        return;
      }

      const targetFrames =
        framesToProcess && framesToProcess.length > 0 ? framesToProcess : [currentFrame];
      const isBatch = targetFrames.length > 1;
      const isSequence = node.resultBehavior === 'frame_sequence';

      const jobTitle = isBatch
        ? `${node.modelName ?? 'ONNX Inference'} (${targetFrames.length} frames)`
        : (node.modelName ?? 'ONNX Inference');

      const jobId = startBackgroundJob({
        type: 'onnx-inference',
        title: jobTitle,
        subtitle: node.name,
        detail: isBatch ? `Starting ${targetFrames.length} frames...` : 'Starting inference',
        status: 'queued',
        progress: 0,
        indeterminate: true,
        cancellable: true,
        source: {
          nodeId: node.id,
          modelId: node.modelId,
          projectId: projectId!,
        },
      });
      setActiveInferenceJobId(jobId);

      const abortController = new AbortController();
      let jobFinished = false;

      const finishJobOnce = (updates: Parameters<typeof finishBackgroundJob>[1]) => {
        if (jobFinished) return;
        jobFinished = true;
        finishBackgroundJob(jobId, updates);
      };

      const unregisterCancel = registerBackgroundJobCancelHandler(jobId, () => {
        abortController.abort();
        finishJobOnce({
          status: 'cancelled',
          detail: isBatch ? 'Frame batch cancelled' : 'ONNX inference cancelled',
          progress: 0,
          source: { nodeId: node.id, modelId: node.modelId, projectId: projectId! },
        });
        hasPendingInferenceRef.current = false;
        setActiveInferenceJobId(null);
      });

      try {
        updateBackgroundJob(jobId, {
          status: 'running',
          detail: 'Loading model',
          progress: 5,
          indeterminate: true,
          source: { nodeId: node.id, modelId: node.modelId, projectId: projectId! },
        });

        if (abortController.signal.aborted) return;

        const model = await getInstalledOnnxModel(node.modelId);
        if (!model) {
          throw new Error('The selected ONNX model is not installed.');
        }

        const metaInputs = inputMetadata ?? [];
        const metaOutputs = outputMetadata ?? [];

        if (metaInputs.length === 0) {
          throw new Error('Model metadata not loaded. Wait for metadata to load.');
        }

        const resolvedInputSize: { width: number; height: number } =
          node.inputSize?.width > 0 && node.inputSize?.height > 0
            ? { width: node.inputSize.width, height: node.inputSize.height }
            : sceneNode
              ? { width: sceneNode.width, height: sceneNode.height }
              : recipe.defaultInputSize;

        let allOutputs: OnnxNodeOutput[] = [];
        let accumulatedFrames = node.frames ?? [];
        // Per-frame srcs for each output name (e.g., "output", "depth").
        // Populated in sequence mode so selecting a different output shows
        // the correct frame-specific data. Seed from previous data to
        // preserve frame ranges that aren't being re-run.
        let accumulatedFrameSrcs: Record<string, string[]> = { ...(node.outputFrameSrcs ?? {}) };

        // Preserve the previously active output by name so it survives regeneration
        const previousActiveOutputName = node.activeOutputId
          ? (node.outputs?.find((o) => o.id === node.activeOutputId)?.name ?? null)
          : null;

        for (let fi = 0; fi < targetFrames.length; fi++) {
          const frame = targetFrames[fi];

          if (abortController.signal.aborted) return;

          const frameProgress = isBatch ? Math.round((fi / targetFrames.length) * 75) + 10 : 0;
          const frameLabel = isBatch ? `Frame ${frame}` : '';

          updateBackgroundJob(jobId, {
            status: 'running',
            detail: isBatch ? `${frameLabel}: Preprocessing` : 'Preprocessing inputs',
            progress: frameProgress,
            indeterminate: !isBatch,
            source: { nodeId: node.id, modelId: node.modelId, projectId: projectId! },
          });

          if (abortController.signal.aborted) return;

          const imageInputs: Record<string, Blob | FloatInput> = {};
          for (const meta of metaInputs) {
            if (meta.kind !== 'image') continue;
            const sourceNode = connectedImageInputs[meta.name];
            if (!sourceNode) {
              throw new Error(`Connect a source to the "${meta.name}" input.`);
            }

            if (abortController.signal.aborted) return;

            let input: Blob | FloatInput | null = null;

            if (sourceNode.type === NodeType.ONNX_MODEL) {
              const cached = getOnnxOutputCache(sourceNode.id);
              if (cached) {
                input = {
                  data: new Float32Array(cached.data),
                  width: cached.width,
                  height: cached.height,
                  channels: cached.channels,
                };
              }
            }

            if (!input && sourceNode.type === NodeType.ROTO) {
              if (!sceneNode) {
                throw new Error('Scene node not found for mask rendering.');
              }
              const canvas = rotoMaskCanvasWithAlpha(sourceNode as RotoNode, sceneNode, frame);
              if (!canvas) {
                throw new Error(`Could not render mask for "${meta.name}".`);
              }
              input = await new Promise<Blob | null>((resolve) =>
                canvas.toBlob(resolve, 'image/png'),
              );
            }

            if (!input) {
              if (!sceneNode) {
                throw new Error('Scene node not found for ONNX input rendering.');
              }
              input = await renderNodeInputFrameToFloat({
                nodes: allNodes,
                flows,
                sourceNodeId: sourceNode.id,
                sceneNode,
                frame,
                finalColorSpace: 'raw_texture',
              });
            }

            if (!input) {
              throw new Error(`Could not load image for "${meta.name}".`);
            }
            imageInputs[meta.name] = input;
          }

          const scalarInputs: Record<string, number | string | boolean> = {};
          for (const meta of metaInputs) {
            if (meta.kind !== 'scalar') continue;
            const value = node.inputValues?.[meta.name] ?? meta.defaultValue;
            if (value === undefined || value === null) {
              throw new Error(`Set a value for scalar input "${meta.name}".`);
            }
            scalarInputs[meta.name] = value;
          }

          updateBackgroundJob(jobId, {
            status: 'running',
            detail: isBatch
              ? `${frameLabel}: Running on ${node.backend.toUpperCase()}`
              : `Running on ${node.backend.toUpperCase()}`,
            progress: isBatch ? frameProgress + 10 : 30,
            indeterminate: !isBatch,
            source: { nodeId: node.id, modelId: node.modelId, projectId: projectId! },
          });

          if (abortController.signal.aborted) return;

          const results = await runOnnxModel({
            model,
            imageInputs,
            scalarInputs,
            inputMetadata: metaInputs,
            outputMetadata: metaOutputs,
            backend: node.backend,
            inputSize: resolvedInputSize,
            inputChannelModes: node.inputChannelModes,
            inputNormalizationOverrides: node.inputNormalizationOverrides,
            outputNormalizationOverrides: node.outputNormalizationOverrides,
            runtimePreferences: {
              webgpuEnabled: onnxRuntimeWebGpuEnabled,
              wasmEnabled: onnxRuntimeWasmEnabled,
            },
            normalization: recipe.normalization,
          });

          if (abortController.signal.aborted) return;

          // Process outputs for this frame
          const frameOutputs: OnnxNodeOutput[] = [];

          for (const result of results) {
            const { blob, rawFloatData, ...cleanResult } = result;
            if (result.kind === 'image' && blob) {
              const assetId = await saveAsset(blob);
              frameOutputs.push({ ...cleanResult, src: assetId });

              if (rawFloatData) {
                setOnnxOutputCache(node.id, {
                  data: rawFloatData,
                  width: result.width,
                  height: result.height,
                  channels: 3,
                  dims: result.dims,
                });
              }
            } else if (result.kind === 'scalar') {
              frameOutputs.push(cleanResult);
            }
          }

          const firstImageOutput = frameOutputs.find((o) => o.kind === 'image');

          if (isSequence && firstImageOutput?.src) {
            // Frame sequence mode: store indexed by frame number
            const frameIndex = frame - (node.startFrame ?? 0);
            const newFrames = [...accumulatedFrames];
            const newFrameSrcs = { ...accumulatedFrameSrcs };
            while (newFrames.length <= frameIndex) {
              newFrames.push('');
            }
            newFrames[frameIndex] = firstImageOutput.src;
            accumulatedFrames = newFrames;

            // Store per-frame src for each named output
            for (const output of frameOutputs) {
              if (output.kind === 'image' && output.src) {
                const outputFrames = newFrameSrcs[output.name] ?? [];
                while (outputFrames.length <= frameIndex) {
                  outputFrames.push('');
                }
                outputFrames[frameIndex] = output.src;
                newFrameSrcs[output.name] = outputFrames;
              }
            }
            accumulatedFrameSrcs = newFrameSrcs;

            const transformUpdate =
              sceneNode && !isCustomImageFitMode(node.transform.fitMode)
                ? (() => {
                    const { scaleX, scaleY } = calculateTransformForFitMode(
                      { width: firstImageOutput.width, height: firstImageOutput.height },
                      { width: sceneNode.width, height: sceneNode.height },
                      node.transform.fitMode,
                    );
                    return { transform: { ...node.transform, scaleX, scaleY, x: 0, y: 0 } };
                  })()
                : {};

            updateNode(
              node.id,
              {
                frames: newFrames,
                outputFrameSrcs: newFrameSrcs,
                src: firstImageOutput.src,
                width: firstImageOutput.width,
                height: firstImageOutput.height,
                outputs: frameOutputs,
                activeOutputId:
                  (previousActiveOutputName
                    ? frameOutputs.find((o) => o.name === previousActiveOutputName)?.id
                    : undefined) ?? firstImageOutput.id,
                ...transformUpdate,
                lastRunAt: Date.now(),
                lastError: undefined,
              },
              fi === targetFrames.length - 1,
            );
          } else if (firstImageOutput?.src) {
            // Static mode: accumulate outputs in batch, or replace for single
            allOutputs = isBatch ? [...allOutputs, ...frameOutputs] : frameOutputs;

            const transformUpdate =
              sceneNode && !isCustomImageFitMode(node.transform.fitMode)
                ? (() => {
                    const { scaleX, scaleY } = calculateTransformForFitMode(
                      { width: firstImageOutput.width, height: firstImageOutput.height },
                      { width: sceneNode.width, height: sceneNode.height },
                      node.transform.fitMode,
                    );
                    return { transform: { ...node.transform, scaleX, scaleY, x: 0, y: 0 } };
                  })()
                : {};

            updateNode(
              node.id,
              {
                outputs: allOutputs,
                activeOutputId:
                  (previousActiveOutputName
                    ? allOutputs.find((o) => o.name === previousActiveOutputName)?.id
                    : undefined) ?? firstImageOutput.id,
                src: firstImageOutput.src,
                width: firstImageOutput.width,
                height: firstImageOutput.height,
                ...transformUpdate,
                lastRunAt: Date.now(),
                lastError: undefined,
              },
              fi === targetFrames.length - 1,
            );
          }
        }

        // Finalize
        const storedFrameCount = isSequence ? accumulatedFrames.filter(Boolean).length : 0;
        const outputCount = isSequence ? storedFrameCount : allOutputs.length;
        const frameCount = isSequence ? targetFrames.length : 0;
        const detail = isSequence
          ? `${outputCount} frame${outputCount === 1 ? '' : 's'} in sequence`
          : outputCount === 0
            ? 'Inference completed'
            : `${outputCount} output${outputCount === 1 ? '' : 's'} saved`;

        hasPendingInferenceRef.current = false;
        setActiveInferenceJobId(null);

        finishJobOnce({
          status: 'complete',
          detail: isBatch ? `${frameCount} frames \u00b7 ${detail}` : detail,
          progress: 100,
          source: { nodeId: node.id, modelId: node.modelId, projectId: projectId! },
        });
      } catch (error) {
        if (abortController.signal.aborted) return;
        const message = error instanceof Error ? error.message : 'ONNX inference failed.';
        setLocalError(message);
        updateNode(node.id, { lastError: message }, false);
        hasPendingInferenceRef.current = false;
        setActiveInferenceJobId(null);

        finishJobOnce({
          status: 'error',
          detail: message,
          error: message,
          progress: 100,
          source: { nodeId: node.id, modelId: node.modelId, projectId: projectId! },
        });
      } finally {
        unregisterCancel();
      }
    },
    [
      allNodes,
      currentFrame,
      connectedImageInputs,
      flows,
      inputMetadata,
      node,
      onnxRuntimeWasmEnabled,
      onnxRuntimeWebGpuEnabled,
      outputMetadata,
      projectId,
      recipe.defaultInputSize,
      recipe.normalization,
      sceneNode,
      startBackgroundJob,
      updateBackgroundJob,
      finishBackgroundJob,
      updateNode,
    ],
  );

  const runNodeAllFrames = useCallback(() => {
    const maxFrames = sceneNode?.maxFrames ?? 1;
    if (maxFrames <= 1) {
      void runNode();
      return;
    }
    const frames = Array.from({ length: maxFrames }, (_, i) => i);
    void runNode(frames);
  }, [runNode, sceneNode]);

  const runNodeFrameRange = useCallback(
    (startFrame: number, endFrame: number) => {
      const maxFrames = sceneNode?.maxFrames ?? 1;
      const frames: number[] = [];
      for (let f = startFrame; f <= endFrame && f < maxFrames; f++) {
        frames.push(f);
      }
      if (frames.length > 0) {
        void runNode(frames);
      }
    },
    [runNode, sceneNode],
  );

  const totalFrames = sceneNode?.maxFrames ?? 1;
  const storedFrameCount = useMemo(() => (node.frames ?? []).filter(Boolean).length, [node.frames]);

  const handleSelectOutput = useCallback(
    (output: OnnxNodeOutput) => {
      if (output.kind === 'image' && output.src) {
        const transform =
          sceneNode && !isCustomImageFitMode(node.transform.fitMode)
            ? {
                ...node.transform,
                ...calculateTransformForFitMode(
                  { width: output.width, height: output.height },
                  { width: sceneNode.width, height: sceneNode.height },
                  node.transform.fitMode,
                ),
              }
            : node.transform;

        updateNode(
          node.id,
          {
            activeOutputId: output.id,
            src: output.src,
            width: output.width,
            height: output.height,
            transform,
          },
          true,
        );
      } else {
        updateNode(node.id, { activeOutputId: output.id }, true);
      }
    },
    [node.id, node.transform, sceneNode, updateNode],
  );

  useNodeExecutionHandler(node.id, () => void runNode());

  const modelOptions = installedModels.map((model) => ({
    value: model.id,
    label: model.name,
    secondaryLabel: `${model.variant.label} \u00b7 ${formatBytes(
      (model.sizeBytes ?? 0) +
        (model.externalData ?? []).reduce((s, e) => s + (e.sizeBytes ?? 0), 0),
    )}`,
    badges: [model.variant.supportedBackends.join('/')],
  }));

  const backendOptions = [
    { value: 'webgpu', label: 'WebGPU' },
    { value: 'wasm', label: 'WASM' },
  ];

  const handleModelChange = useCallback(
    (value: string) => {
      const model = installedModels.find((candidate) => candidate.id === String(value));
      if (!model) return;
      primeMetadataFromModel(model);

      const newPortNames = (getResolvedInputMetadata(model.id) ?? []).map((m) => m.name);
      const inputsCleaned = remapInputsOnModelChange(node.inputs, newPortNames);

      const resolvedInputSize = (() => {
        const shape = model.variant.inputShape;
        if (shape && shape.length >= 4 && shape[2] > 0 && shape[3] > 0) {
          return { width: shape[3], height: shape[2] };
        }
        if (sceneNode) {
          return { width: sceneNode.width, height: sceneNode.height };
        }
        return node.inputSize;
      })();

      updateNode(
        node.id,
        {
          modelId: String(value),
          modelName: model.name,
          modelRepo: model.repoName,
          variantId: model.variant.id,
          variantLabel: model.variant.label,
          inputSize: resolvedInputSize,
          ...(inputsCleaned !== node.inputs ? { inputs: inputsCleaned } : {}),
        },
        true,
      );
    },
    [installedModels, node.id, node.inputs, node.inputSize, sceneNode, updateNode],
  );

  const hasStatic4DInput =
    inputMetadata?.[0] && !inputMetadata[0].isDynamic && inputMetadata[0].dims.length >= 4;

  return (
    <div>
      <CollapsibleSection title="ONNX Model" defaultOpen>
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label className="text-xs font-medium text-gray-400">Installed Model</label>
            </div>
            <StyledDropdown
              value={node.modelId ?? ''}
              options={[
                ...(node.modelId && !installedModels.some((model) => model.id === node.modelId)
                  ? [
                      {
                        value: node.modelId,
                        label: `${node.modelName ?? 'Missing model'} (missing)`,
                      },
                    ]
                  : []),
                ...modelOptions,
              ]}
              onChange={handleModelChange}
              widthClass="w-full"
              popoverWidthClass="w-[min(28rem,calc(100vw-2rem))]"
            />
            {selectedModel ? (
              <p className="text-xs leading-5 text-gray-500">
                {selectedModel.repoName} \u00b7 {selectedModel.variant.filePath}
              </p>
            ) : (
              <p className="text-xs leading-5 text-amber-200">
                Install a model in Preferences &gt; Models, then choose it here.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-400">Backend</label>
            <SegmentedControl
              value={node.backend}
              options={backendOptions}
              onChange={(value) => updateNode(node.id, { backend: value as OnnxBackend }, true)}
            />
            {compatibility.warning ? (
              <p className="text-xs leading-5 text-amber-200">{compatibility.warning}</p>
            ) : null}
            {!compatibility.webgpu && !compatibility.wasm ? (
              <p className="text-xs leading-5 text-red-300">
                Enable WebGPU or WASM in Preferences &gt; Models before running this node.
              </p>
            ) : null}
          </div>

          {!hasStatic4DInput && (
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <Slider
                  label="Input Width"
                  value={node.inputSize.width}
                  min={MIN_INPUT_SIZE}
                  max={MAX_INPUT_SIZE}
                  step={1}
                  onChange={(value) => handleInputSizeChange('width', value)}
                  onReset={() => handleInputSizeReset('width')}
                  displayFormatter={(value) => `${Math.round(value)} px`}
                />
              </div>
              <button
                type="button"
                onClick={() => setInputSizeLinked(!inputSizeLinked)}
                className={`flex-shrink-0 mt-6 rounded p-1 transition ${
                  inputSizeLinked
                    ? 'text-primary-400 hover:text-primary-300'
                    : 'text-gray-600 hover:text-gray-400'
                }`}
                title={inputSizeLinked ? 'Unlink input dimensions' : 'Link input dimensions'}
              >
                <Link className="h-4 w-4" />
              </button>
              <div className="flex-1 min-w-0">
                <Slider
                  label="Input Height"
                  value={node.inputSize.height}
                  min={MIN_INPUT_SIZE}
                  max={MAX_INPUT_SIZE}
                  step={1}
                  onChange={(value) => handleInputSizeChange('height', value)}
                  onReset={() => handleInputSizeReset('height')}
                  displayFormatter={(value) => `${Math.round(value)} px`}
                />
              </div>
            </div>
          )}

          {isLoadingMetadata && !inputMetadata ? (
            <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-gray-500">
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border border-gray-500 border-t-transparent" />
                Loading model metadata...
              </div>
            </div>
          ) : metadataError ? (
            <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs">
              <div className="flex items-center gap-2 text-red-300">
                <span>Failed to load metadata</span>
                <button
                  type="button"
                  onClick={retryMetadata}
                  className="rounded border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-gray-300 hover:bg-white/[0.08]"
                >
                  Retry
                </button>
              </div>
              <p className="mt-1 text-[11px] text-gray-500">{metadataError}</p>
            </div>
          ) : inputMetadata && inputMetadata.length > 0 ? (
            <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs">
              <div className="space-y-2">
                <p className="text-[11px] font-medium text-gray-400">Inputs</p>

                {imageInputPorts?.map((meta, i) => {
                  const connectedNode = connectedImageInputs[meta.name];
                  const channelModes: OnnxChannelMode[] = ['RGB', 'R', 'G', 'B', 'A', 'Luminance'];
                  const defaultChannel = (() => {
                    const cDim = meta.dims.length >= 2 ? meta.dims[1] : -1;
                    return cDim === 1 ? ('A' as OnnxChannelMode) : ('RGB' as OnnxChannelMode);
                  })();
                  const currentChannel = node.inputChannelModes?.[meta.name] ?? defaultChannel;
                  return (
                    <div key={i}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-gray-100 shrink-0">{meta.name}</span>
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() =>
                                setOpenChannelPopup(
                                  openChannelPopup === meta.name ? null : meta.name,
                                )
                              }
                              className="rounded px-1.5 py-0.5 text-[10px] font-mono font-medium text-gray-300 hover:text-white hover:bg-white/[0.06] border border-white/10"
                            >
                              {currentChannel}
                            </button>
                            {openChannelPopup === meta.name ? (
                              <>
                                <div
                                  className="fixed inset-0 z-40"
                                  onClick={() => setOpenChannelPopup(null)}
                                />
                                <div className="absolute left-0 top-full z-50 mt-1 min-w-[100px] rounded-lg border border-white/10 bg-gray-900 py-1 shadow-xl">
                                  {channelModes.map((cm) => (
                                    <button
                                      key={cm}
                                      type="button"
                                      onClick={() => {
                                        updateNode(
                                          node.id,
                                          {
                                            inputChannelModes: {
                                              ...(node.inputChannelModes ?? {}),
                                              [meta.name]: cm,
                                            },
                                          },
                                          true,
                                        );
                                        setOpenChannelPopup(null);
                                      }}
                                      className={`block w-full px-3 py-1 text-left text-[11px] hover:bg-white/[0.06] ${
                                        currentChannel === cm ? 'text-primary-300' : 'text-gray-300'
                                      }`}
                                    >
                                      {cm}
                                    </button>
                                  ))}
                                </div>
                              </>
                            ) : null}
                          </div>
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() =>
                                setOpenNormalizationPopup(
                                  openNormalizationPopup === `input:${meta.name}`
                                    ? null
                                    : `input:${meta.name}`,
                                )
                              }
                              className={`rounded px-1.5 py-0.5 text-[10px] font-mono font-medium border border-white/10 ${
                                (node.inputNormalizationOverrides?.[meta.name] ?? '') !== ''
                                  ? 'text-amber-200 hover:text-amber-100'
                                  : 'text-gray-500 hover:text-gray-300'
                              } hover:bg-white/[0.06]`}
                              title={`Normalization: ${node.inputNormalizationOverrides?.[meta.name] ?? 'auto (imagenet)'}`}
                            >
                              {node.inputNormalizationOverrides?.[meta.name] ?? 'Auto'}
                            </button>
                            {openNormalizationPopup === `input:${meta.name}` ? (
                              <>
                                <div
                                  className="fixed inset-0 z-40"
                                  onClick={() => setOpenNormalizationPopup(null)}
                                />
                                <div className="absolute left-0 top-full z-50 mt-1 min-w-[120px] rounded-lg border border-white/10 bg-gray-900 py-1 shadow-xl">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const next = { ...(node.inputNormalizationOverrides ?? {}) };
                                      delete next[meta.name];
                                      updateNode(
                                        node.id,
                                        { inputNormalizationOverrides: next },
                                        true,
                                      );
                                      setOpenNormalizationPopup(null);
                                    }}
                                    className={`block w-full px-3 py-1 text-left text-[11px] hover:bg-white/[0.06] ${
                                      !node.inputNormalizationOverrides?.[meta.name]
                                        ? 'text-primary-300'
                                        : 'text-gray-300'
                                    }`}
                                  >
                                    Auto (imagenet)
                                  </button>
                                  {(['none', 'zeroToOne'] as OnnxNormalization[]).map((n) => (
                                    <button
                                      key={n}
                                      type="button"
                                      onClick={() => {
                                        updateNode(
                                          node.id,
                                          {
                                            inputNormalizationOverrides: {
                                              ...(node.inputNormalizationOverrides ?? {}),
                                              [meta.name]: n,
                                            },
                                          },
                                          true,
                                        );
                                        setOpenNormalizationPopup(null);
                                      }}
                                      className={`block w-full px-3 py-1 text-left text-[11px] hover:bg-white/[0.06] ${
                                        node.inputNormalizationOverrides?.[meta.name] === n
                                          ? 'text-primary-300'
                                          : 'text-gray-300'
                                      }`}
                                    >
                                      {n === 'none' ? 'None (raw values)' : 'Zero to One'}
                                    </button>
                                  ))}
                                </div>
                              </>
                            ) : null}
                          </div>
                          {connectedNode ? (
                            <span className="text-[10px] text-primary-300 truncate">
                              &larr; {connectedNode.name}
                            </span>
                          ) : (
                            <span className="text-[10px] text-gray-500">not connected</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-mono text-gray-100">{meta.dimsLabel}</span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              meta.isDynamic
                                ? 'border border-amber-400/20 bg-amber-500/10 text-amber-200'
                                : 'border border-green-400/20 bg-green-500/10 text-green-100'
                            }`}
                          >
                            {meta.isDynamic ? 'Dynamic' : 'Fixed'}
                          </span>
                          {meta.type !== 'unknown' ? (
                            <span className="text-gray-500">{meta.type}</span>
                          ) : null}
                        </div>
                      </div>
                      <InputPreview
                        sourceNode={connectedNode}
                        allNodes={allNodes}
                        flows={flows}
                        currentFrame={currentFrame}
                        sceneNode={sceneNode}
                        width={64}
                      />
                    </div>
                  );
                })}

                {scalarInputPorts?.map((meta, i) => {
                  const currentValue = node.inputValues?.[meta.name] ?? meta.defaultValue;
                  const isNumber =
                    meta.type.startsWith('float') ||
                    meta.type.startsWith('int') ||
                    meta.type.startsWith('uint') ||
                    meta.type.startsWith('double') ||
                    meta.type.startsWith('bfloat') ||
                    meta.type.startsWith('complex');
                  const isBool = meta.type === 'bool';

                  if (isBool) {
                    return (
                      <div key={`scalar-${i}`} className="flex items-center justify-between gap-2">
                        <span className="text-gray-100">{meta.name}</span>
                        <div className="flex items-center gap-2">
                          <ToggleSwitch
                            checked={Boolean(currentValue ?? false)}
                            onCheckedChange={(checked) =>
                              handleUpdateScalarInput(meta.name, checked)
                            }
                          />
                          <span className="font-mono text-gray-500">{meta.type}</span>
                        </div>
                      </div>
                    );
                  }

                  if (isNumber) {
                    const numValue = typeof currentValue === 'number' ? currentValue : 0;
                    const maxVal =
                      meta.type === 'int32' || meta.type === 'int64'
                        ? 1024
                        : meta.type === 'uint8'
                          ? 255
                          : 1;
                    const minVal = meta.type === 'uint8' ? 0 : -1;
                    const step = meta.type === 'float32' || meta.type === 'float16' ? 0.01 : 1;
                    return (
                      <div key={`scalar-${i}`}>
                        <Slider
                          label={meta.name}
                          value={numValue}
                          min={minVal}
                          max={maxVal}
                          step={step}
                          onChange={(value) =>
                            handleUpdateScalarInput(
                              meta.name,
                              meta.type.startsWith('int') ? Math.round(value) : value,
                            )
                          }
                          displayFormatter={(value) => {
                            if (meta.type.startsWith('int')) return String(Math.round(value));
                            return value.toFixed(2);
                          }}
                        />
                      </div>
                    );
                  }

                  return (
                    <div key={`scalar-${i}`} className="flex items-center justify-between gap-2">
                      <span className="text-gray-100">{meta.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-gray-400 text-[11px] bg-white/[0.04] rounded px-2 py-1">
                          {String(currentValue ?? '') || 'no default'}
                        </span>
                        <span className="font-mono text-gray-500">{meta.type}</span>
                      </div>
                    </div>
                  );
                })}

                {outputMetadata && outputMetadata.length > 0 ? (
                  <>
                    <div className="border-t border-white/10" />
                    <p className="text-[11px] font-medium text-gray-400">Outputs</p>
                    {outputMetadata.map((meta, i) => (
                      <div key={i} className="flex items-center justify-between gap-2">
                        <span className="text-gray-100">{meta.name}</span>
                        <div className="flex items-center gap-2">
                          {meta.kind === 'image' ? (
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() =>
                                  setOpenNormalizationPopup(
                                    openNormalizationPopup === `output:${meta.name}`
                                      ? null
                                      : `output:${meta.name}`,
                                  )
                                }
                                className={`rounded px-1.5 py-0.5 text-[10px] font-mono font-medium border border-white/10 ${
                                  (node.outputNormalizationOverrides?.[meta.name] ?? '') !== ''
                                    ? 'text-amber-200 hover:text-amber-100'
                                    : 'text-gray-500 hover:text-gray-300'
                                } hover:bg-white/[0.06]`}
                                title={`Normalization: ${node.outputNormalizationOverrides?.[meta.name] ?? 'auto (imagenet)'}`}
                              >
                                Norm: {node.outputNormalizationOverrides?.[meta.name] ?? 'Auto'}
                              </button>
                              {openNormalizationPopup === `output:${meta.name}` ? (
                                <>
                                  <div
                                    className="fixed inset-0 z-40"
                                    onClick={() => setOpenNormalizationPopup(null)}
                                  />
                                  <div className="absolute left-0 top-full z-50 mt-1 min-w-[130px] rounded-lg border border-white/10 bg-gray-900 py-1 shadow-xl">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const next = {
                                          ...(node.outputNormalizationOverrides ?? {}),
                                        };
                                        delete next[meta.name];
                                        updateNode(
                                          node.id,
                                          { outputNormalizationOverrides: next },
                                          true,
                                        );
                                        setOpenNormalizationPopup(null);
                                      }}
                                      className={`block w-full px-3 py-1 text-left text-[11px] hover:bg-white/[0.06] ${
                                        !node.outputNormalizationOverrides?.[meta.name]
                                          ? 'text-primary-300'
                                          : 'text-gray-300'
                                      }`}
                                    >
                                      Auto (imagenet)
                                    </button>
                                    {(['none', 'zeroToOne'] as OnnxNormalization[]).map((n) => (
                                      <button
                                        key={n}
                                        type="button"
                                        onClick={() => {
                                          updateNode(
                                            node.id,
                                            {
                                              outputNormalizationOverrides: {
                                                ...(node.outputNormalizationOverrides ?? {}),
                                                [meta.name]: n,
                                              },
                                            },
                                            true,
                                          );
                                          setOpenNormalizationPopup(null);
                                        }}
                                        className={`block w-full px-3 py-1 text-left text-[11px] hover:bg-white/[0.06] ${
                                          node.outputNormalizationOverrides?.[meta.name] === n
                                            ? 'text-primary-300'
                                            : 'text-gray-300'
                                        }`}
                                      >
                                        {n === 'none' ? 'None (raw values)' : 'Zero to One'}
                                      </button>
                                    ))}
                                  </div>
                                </>
                              ) : null}
                            </div>
                          ) : (
                            <span className="rounded-full px-2 py-0.5 text-[10px] font-medium border border-white/10 bg-white/[0.04]">
                              {meta.kind}
                            </span>
                          )}
                          <span className="font-mono text-gray-100">{meta.dimsLabel}</span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              meta.isDynamic
                                ? 'border border-amber-400/20 bg-amber-500/10 text-amber-200'
                                : 'border border-green-400/20 bg-green-500/10 text-green-100'
                            }`}
                          >
                            {meta.isDynamic ? 'Dynamic' : 'Fixed'}
                          </span>
                          {meta.type !== 'unknown' ? (
                            <span className="text-gray-500">{meta.type}</span>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </>
                ) : null}
              </div>
              <div className="mt-2 border-t border-white/10 pt-2 leading-5 text-gray-400">
                <p>{recipe.preprocessing}</p>
                <p className="mt-1">{recipe.postprocessing}</p>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-gray-400">
              <div className="flex flex-wrap gap-2">
                {(Object.entries(connectedImageInputs) as [string, AnyNode | null][]).map(
                  ([portName, sourceNode]) => (
                    <span
                      key={portName}
                      className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1"
                    >
                      {portName}: {sourceNode?.name ?? 'not connected'}
                    </span>
                  ),
                )}
                {Object.keys(connectedImageInputs).length === 0 ? (
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1">
                    No input ports
                  </span>
                ) : null}
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1">
                  Output: {node.src ? `${node.width}\u00d7${node.height}` : 'not rendered'}
                </span>
              </div>
              <p className="mt-2 leading-5">{recipe.preprocessing}</p>
              <p className="mt-1 leading-5">{recipe.postprocessing}</p>
            </div>
          )}

          {nodeOutputs.length > 1 ? (
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-400">Outputs</label>
              <div className="grid grid-cols-2 gap-2">
                {nodeOutputs
                  .filter((o) => o.kind === 'image')
                  .map((output) => (
                    <button
                      key={output.id}
                      type="button"
                      onClick={() => handleSelectOutput(output)}
                      className={`rounded-xl border p-2 text-left text-[11px] transition ${
                        output.id === activeOutputId
                          ? 'border-primary-400/40 bg-primary-500/10'
                          : 'border-white/10 bg-black/20 hover:bg-white/[0.04]'
                      }`}
                    >
                      <div className="font-medium text-gray-100">{output.name}</div>
                      <div className="mt-0.5 text-gray-500">
                        {output.dims.join('\u00d7')} &middot; {output.type}
                      </div>
                    </button>
                  ))}
              </div>
              {nodeOutputs.filter((o) => o.kind === 'scalar').length > 0 ? (
                <div className="rounded-xl border border-white/10 bg-black/20 p-2 text-xs">
                  <p className="text-[11px] font-medium text-gray-400 mb-1">Scalar Outputs</p>
                  {nodeOutputs
                    .filter((o) => o.kind === 'scalar')
                    .map((output) => (
                      <div key={output.id} className="flex items-center justify-between py-0.5">
                        <span className="text-gray-300">{output.name}</span>
                        <span className="font-mono text-gray-100">
                          {output.scalarValue?.toFixed(4) ?? '-'}
                        </span>
                      </div>
                    ))}
                </div>
              ) : null}
            </div>
          ) : nodeOutputs.length === 1 && currentActiveOutput ? (
            <div className="rounded-xl border border-primary-400/20 bg-primary-500/5 p-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-gray-100 font-medium">{currentActiveOutput.name}</span>
                <span className="text-gray-500">{currentActiveOutput.dims.join('\u00d7')}</span>
              </div>
            </div>
          ) : null}

          {localError ? <p className="text-xs leading-5 text-red-300">{localError}</p> : null}

          <div className="flex items-center gap-2 border-t border-white/10 pt-3">
            <SegmentedControl
              value={node.resultBehavior ?? 'static'}
              options={RESULT_BEHAVIOR_OPTIONS}
              onChange={(value) =>
                updateNode(node.id, { resultBehavior: value as OnnxResultBehavior }, true)
              }
            />
            <div className="flex items-center gap-2 ml-auto">
              <OnnxRunButtonGroup
                disabled={isInferenceRunning}
                runShortcutHint={'\u2318\u23CE'}
                currentFrame={currentFrame}
                totalFrames={totalFrames}
                storedFrameCount={storedFrameCount}
                showRunFrames={node.resultBehavior === 'frame_sequence'}
                onRunFrame={() => void runNode()}
                onRunFrameRange={(startFrame, endFrame) =>
                  void runNodeFrameRange(startFrame, endFrame)
                }
                onRunAllFrames={() => void runNodeAllFrames()}
              />
              {isInferenceRunning && (
                <button
                  type="button"
                  onClick={() => {
                    if (activeInferenceJobId) {
                      requestBackgroundJobCancel(activeInferenceJobId);
                    }
                  }}
                  className="inline-flex items-center justify-center rounded-lg border border-red-300/20 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-100 transition hover:bg-red-500/15"
                  title="Cancel inference"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>
      </CollapsibleSection>

      <SourceTransformControls node={node} />
    </div>
  );
}

export default OnnxAdjustments;
