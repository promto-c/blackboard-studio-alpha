import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import { usePreferences } from '@/state/preferencesContext';
import { useInstalledOnnxModels } from '@/state/installedOnnxModelsContext';
import { getAsset, saveAsset } from '@/state/assetStorage';
import { useNodeExecutionHandler } from '@/hooks/useNodeExecutionHandler';
import {
  CollapsibleSection,
  SegmentedControl,
  Slider,
  StyledDropdown,
  ToggleSwitch,
} from '@/components';
import {
  AnyNode,
  ImageFitMode,
  ImageSequenceNode,
  NodeType,
  OnnxBackend,
  OnnxChannelMode,
  OnnxInputMetadata,
  OnnxModelNode,
  OnnxNodeOutput,
  OnnxOutputMetadata,
  RotoNode,
  SceneNode,
} from '@blackboard/types';
import { getInstalledOnnxModel, updateInstalledOnnxModel } from '@/services/onnx/modelCache';
import {
  getCachedOnnxModelInputMetadata,
  getCachedOnnxModelOutputMetadata,
  getResolvedInputMetadata,
  loadOnnxModelMetadataCached,
  loadOnnxModelOutputMetadataCached,
  primeMetadataFromModel,
} from '@/services/onnx/onnxMetadataCache';
import {
  FloatInput,
  getOnnxRuntimeCompatibility,
  getOnnxOutputCache,
  runOnnxModel,
  setOnnxOutputCache,
} from '@/services/onnx/onnxRuntime';
import { GENERIC_ONNX_RECIPE, resolveRecipe } from '@/services/onnx/modelRegistry';
import { calculateTransformForFitMode } from '@/state/editor/selectors';
import { createMaskCanvas } from '@/utils/rotoMaskTexture';
import { decodeExrImage } from '@/utils/exr';
import { isExrFileLike } from '@/utils/mediaFiles';

type RunState = 'idle' | 'running' | 'complete' | 'error';

const fitModeOptions = [
  { value: ImageFitMode.FIT, label: 'Fit' },
  { value: ImageFitMode.FILL, label: 'Fill' },
  { value: ImageFitMode.NONE, label: 'None' },
  { value: ImageFitMode.STRETCH, label: 'Stretch' },
];

const getConnectedSourceAssetId = (sourceNode: AnyNode, currentFrame: number): string | null => {
  if (
    sourceNode.type === NodeType.IMAGE ||
    sourceNode.type === NodeType.COMFY ||
    sourceNode.type === NodeType.ONNX_MODEL
  ) {
    return (sourceNode as { src?: string }).src || null;
  }

  if (sourceNode.type === NodeType.IMAGE_SEQUENCE) {
    const sequenceNode = sourceNode as ImageSequenceNode;
    if (sequenceNode.frames.length === 0) return null;
    const index = Math.floor(currentFrame - sequenceNode.startFrame);
    if (sequenceNode.loop) {
      const safeIndex =
        ((index % sequenceNode.frames.length) + sequenceNode.frames.length) %
        sequenceNode.frames.length;
      return sequenceNode.frames[safeIndex] ?? null;
    }
    return (
      sequenceNode.frames[Math.max(0, Math.min(sequenceNode.frames.length - 1, index))] ?? null
    );
  }

  return null;
};

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

const InputPreview: React.FC<{
  sourceNode: AnyNode | null;
  currentFrame: number;
  sceneNode?: SceneNode;
  width?: number;
}> = ({ sourceNode, currentFrame, sceneNode, width = 64 }) => {
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
        const assetId = getConnectedSourceAssetId(sourceNode, currentFrame);
        if (!assetId) return;
        const blob = await getAsset(assetId);
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

    render();

    return () => {
      cancelled = true;
    };
  }, [sourceNode, currentFrame, sceneNode]);

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
};

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

const OnnxAdjustments: React.FC<{ node: AnyNode }> = ({ node: anyNode }) => {
  const node = anyNode as OnnxModelNode;
  const { updateNode, setKeyframe } = useEditorActions();
  const { onnxRuntimeWebGpuEnabled, onnxRuntimeWasmEnabled } = usePreferences();
  const allNodes = useEditorSelector((state) => state.nodes);
  const currentFrame = useEditorSelector((state) => state.currentFrame);
  const { models: installedModels } = useInstalledOnnxModels();
  const [runState, setRunState] = useState<RunState>('idle');
  const [localError, setLocalError] = useState<string | null>(node.lastError ?? null);
  const compatibility = useMemo(
    () =>
      getOnnxRuntimeCompatibility({
        webgpuEnabled: onnxRuntimeWebGpuEnabled,
        wasmEnabled: onnxRuntimeWasmEnabled,
      }),
    [onnxRuntimeWasmEnabled, onnxRuntimeWebGpuEnabled],
  );
  const recipe = node.modelRepo ? resolveRecipe(node.modelRepo) : GENERIC_ONNX_RECIPE;
  const sceneNode = useEditorSelector(
    (state) => state.nodes.find((n) => n.type === NodeType.SCENE) as SceneNode | undefined,
  );
  const selectedModel = installedModels.find((model) => model.id === node.modelId) ?? null;

  const [inputMetadata, setInputMetadata] = useState<OnnxInputMetadata[] | null>(null);
  const [outputMetadata, setOutputMetadata] = useState<OnnxOutputMetadata[] | null>(null);
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(false);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const [openChannelPopup, setOpenChannelPopup] = useState<string | null>(null);

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

  React.useEffect(() => {
    cancelledRef.current = false;
    if (!selectedModel) {
      setInputMetadata(null);
      setOutputMetadata(null);
      setMetadataError(null);
      setIsLoadingMetadata(false);
      return;
    }

    const persistedInputs = getCachedOnnxModelInputMetadata(selectedModel);
    const persistedOutputs = getCachedOnnxModelOutputMetadata(selectedModel);
    if (persistedInputs) {
      setInputMetadata(persistedInputs);
      setOutputMetadata(persistedOutputs);
      setIsLoadingMetadata(false);
      setMetadataError(null);
      return;
    }

    setIsLoadingMetadata(true);
    setMetadataError(null);

    Promise.all([
      loadOnnxModelMetadataCached(selectedModel, node.backend),
      loadOnnxModelOutputMetadataCached(selectedModel, node.backend),
    ])
      .then(([inputs, outputs]) => {
        if (!cancelledRef.current) {
          setInputMetadata(inputs);
          setOutputMetadata(outputs);
          setIsLoadingMetadata(false);
        }
      })
      .catch((caught) => {
        if (!cancelledRef.current) {
          setMetadataError(
            caught instanceof Error ? caught.message : 'Failed to load model metadata',
          );
          setIsLoadingMetadata(false);
        }
      });

    return () => {
      cancelledRef.current = true;
    };
  }, [selectedModel, node.backend]);

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

  const runNode = useCallback(async () => {
    setRunState('running');
    setLocalError(null);

    try {
      if (!node.modelId) {
        throw new Error('Choose an installed ONNX model before running this node.');
      }
      const model = await getInstalledOnnxModel(node.modelId);
      if (!model) {
        throw new Error('The selected ONNX model is not installed.');
      }

      const metaInputs = inputMetadata ?? [];
      const metaOutputs = outputMetadata ?? [];

      if (metaInputs.length === 0) {
        throw new Error('Model metadata not loaded. Wait for metadata to load.');
      }

      const imageInputs: Record<string, Blob | FloatInput> = {};
      for (const meta of metaInputs) {
        if (meta.kind !== 'image') continue;
        const sourceNode = connectedImageInputs[meta.name];
        if (!sourceNode) {
          throw new Error(`Connect a source to the "${meta.name}" input.`);
        }

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
          const canvas = rotoMaskCanvasWithAlpha(sourceNode as RotoNode, sceneNode, currentFrame);
          if (!canvas) {
            throw new Error(`Could not render mask for "${meta.name}".`);
          }
          input = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
        }

        if (!input) {
          const assetId = getConnectedSourceAssetId(sourceNode, currentFrame);
          if (!assetId) {
            throw new Error(`The "${meta.name}" source has no image for this frame.`);
          }
          const blob = await getAsset(assetId);
          if (!blob) {
            throw new Error(`Could not load image for "${meta.name}".`);
          }

          if (isExrFileLike(blob)) {
            const decoded = await decodeExrImage(blob, { cacheKey: assetId });
            input = {
              data: new Float32Array(decoded.rgba),
              width: decoded.width,
              height: decoded.height,
              channels: 4,
            };
          } else {
            input = blob;
          }
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

      const resolvedInputSize: { width: number; height: number } =
        node.inputSize?.width > 0 && node.inputSize?.height > 0
          ? { width: node.inputSize.width, height: node.inputSize.height }
          : sceneNode
            ? { width: sceneNode.width, height: sceneNode.height }
            : recipe.defaultInputSize;

      const results = await runOnnxModel({
        model,
        imageInputs,
        scalarInputs,
        inputMetadata: metaInputs,
        outputMetadata: metaOutputs,
        backend: node.backend,
        inputSize: resolvedInputSize,
        inputChannelModes: node.inputChannelModes,
        runtimePreferences: {
          webgpuEnabled: onnxRuntimeWebGpuEnabled,
          wasmEnabled: onnxRuntimeWasmEnabled,
        },
        normalization: recipe.normalization,
      });

      const savedOutputs: OnnxNodeOutput[] = [];

      for (const result of results) {
        const { blob, rawFloatData, ...cleanResult } = result;
        if (result.kind === 'image' && blob) {
          const assetId = await saveAsset(blob);
          savedOutputs.push({ ...cleanResult, src: assetId });

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
          savedOutputs.push(cleanResult);
        }
      }

      const firstImageOutput = savedOutputs.find((o) => o.kind === 'image');
      const update: Record<string, unknown> = {
        outputs: savedOutputs,
        activeOutputId: firstImageOutput?.id ?? savedOutputs[0]?.id,
        lastRunAt: Date.now(),
        lastError: undefined,
      };

      if (firstImageOutput && firstImageOutput.src) {
        update.src = firstImageOutput.src;
        update.width = firstImageOutput.width;
        update.height = firstImageOutput.height;

        if (sceneNode) {
          const { scaleX, scaleY } = calculateTransformForFitMode(
            { width: firstImageOutput.width, height: firstImageOutput.height },
            { width: sceneNode.width, height: sceneNode.height },
            node.transform.fitMode,
          );
          update.transform = { ...node.transform, scaleX, scaleY, x: 0, y: 0 };
        }
      }

      updateNode(node.id, update, true);
      setRunState('complete');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ONNX inference failed.';
      setLocalError(message);
      updateNode(node.id, { lastError: message }, false);
      setRunState('error');
    }
  }, [
    currentFrame,
    connectedImageInputs,
    inputMetadata,
    node,
    onnxRuntimeWasmEnabled,
    onnxRuntimeWebGpuEnabled,
    outputMetadata,
    recipe.defaultInputSize,
    sceneNode,
    updateNode,
    recipe.normalization,
  ]);

  const handleSelectOutput = useCallback(
    (output: OnnxNodeOutput) => {
      if (output.kind === 'image' && output.src) {
        const { scaleX, scaleY } = sceneNode
          ? calculateTransformForFitMode(
              { width: output.width, height: output.height },
              { width: sceneNode.width, height: sceneNode.height },
              node.transform.fitMode,
            )
          : { scaleX: 1, scaleY: 1 };
        const transform = sceneNode ? { ...node.transform, scaleX, scaleY, x: 0 } : node.transform;

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

  useNodeExecutionHandler(node.id, runNode);

  const modelOptions = installedModels.map((model) => ({
    value: model.id,
    label: model.name,
    secondaryLabel: `${model.variant.label} · ${formatBytes(
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
      primeMetadataFromModel(model!);

      const newPortNames = model
        ? (getResolvedInputMetadata(model.id) ?? []).map((m) => m.name)
        : [];
      const currentInputs = node.inputs ?? {};
      const cleanedInputs: Record<string, string> = {};
      for (const [port, sourceId] of Object.entries(currentInputs)) {
        if (newPortNames.length === 0 || newPortNames.includes(port)) {
          cleanedInputs[port] = sourceId;
        }
      }
      const inputsCleaned = Object.keys(cleanedInputs).length > 0 ? cleanedInputs : undefined;

      const resolvedInputSize = (() => {
        const shape = model?.variant.inputShape;
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
          modelName: model?.name ?? node.modelName,
          modelRepo: model?.repoName ?? node.modelRepo,
          variantId: model?.variant.id ?? node.variantId,
          variantLabel: model?.variant.label ?? node.variantLabel,
          inputSize: resolvedInputSize,
          ...(inputsCleaned !== node.inputs ? { inputs: inputsCleaned } : {}),
        },
        true,
      );
    },
    [
      installedModels,
      node.id,
      node.inputs,
      node.modelName,
      node.modelRepo,
      node.variantId,
      node.variantLabel,
      node.inputSize,
      sceneNode,
      updateNode,
    ],
  );

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
                {selectedModel.repoName} · {selectedModel.variant.filePath}
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

          {inputMetadata?.[0] &&
          !inputMetadata[0].isDynamic &&
          inputMetadata[0].dims.length >= 4 ? (
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-400">Input Size</label>
              <p className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm font-mono text-gray-100">
                {inputMetadata[0].dims[2]} &times; {inputMetadata[0].dims[3]}{' '}
                <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-100">
                  Fixed
                </span>
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <Slider
                  label="Input Width"
                  value={node.inputSize.width}
                  min={64}
                  max={8192}
                  step={1}
                  onChange={(value) =>
                    updateNode(node.id, {
                      inputSize: { ...node.inputSize, width: Math.round(value) },
                    })
                  }
                  onReset={() => {
                    if (sceneNode) {
                      updateNode(node.id, {
                        inputSize: { ...node.inputSize, width: sceneNode.width },
                      });
                    }
                  }}
                  displayFormatter={(value) => `${Math.round(value)} px`}
                />
              </div>
              <div className="flex-1 min-w-0">
                <Slider
                  label="Input Height"
                  value={node.inputSize.height}
                  min={64}
                  max={8192}
                  step={1}
                  onChange={(value) =>
                    updateNode(node.id, {
                      inputSize: { ...node.inputSize, height: Math.round(value) },
                    })
                  }
                  onReset={() => {
                    if (sceneNode) {
                      updateNode(node.id, {
                        inputSize: { ...node.inputSize, height: sceneNode.height },
                      });
                    }
                  }}
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
                  onClick={async () => {
                    if (selectedModel) {
                      selectedModel.variant.metadataError = undefined;
                      await updateInstalledOnnxModel(selectedModel).catch(() => {});
                    }
                    setMetadataError(null);
                    setIsLoadingMetadata(true);
                    cancelledRef.current = false;
                    Promise.all([
                      loadOnnxModelMetadataCached(selectedModel!, node.backend),
                      loadOnnxModelOutputMetadataCached(selectedModel!, node.backend),
                    ])
                      .then(([inputs, outputs]) => {
                        if (!cancelledRef.current) {
                          setInputMetadata(inputs);
                          setOutputMetadata(outputs);
                          setIsLoadingMetadata(false);
                        }
                      })
                      .catch((caught) => {
                        if (!cancelledRef.current) {
                          setMetadataError(
                            caught instanceof Error ? caught.message : 'Retry failed',
                          );
                          setIsLoadingMetadata(false);
                        }
                      });
                  }}
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
                          <span className="rounded-full px-2 py-0.5 text-[10px] font-medium border border-white/10 bg-white/[0.04]">
                            {meta.kind}
                          </span>
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
                        {output.width}&times;{output.height} &middot; {output.type}
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
                <span className="text-gray-500">
                  {currentActiveOutput.width}&times;{currentActiveOutput.height}
                </span>
              </div>
            </div>
          ) : null}

          {localError ? <p className="text-xs leading-5 text-red-300">{localError}</p> : null}

          <button
            type="button"
            onClick={() => void runNode()}
            disabled={runState === 'running'}
            className="inline-flex w-full items-center justify-center rounded-lg border border-primary-400/30 bg-primary-500/15 px-3 py-2 text-xs font-medium text-primary-100 transition hover:bg-primary-500/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {runState === 'running' ? 'Running...' : 'Run ONNX Inference'}
          </button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Transform" defaultOpen>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-400">Fit Mode</label>
            <SegmentedControl
              value={node.transform.fitMode}
              options={fitModeOptions}
              onChange={(value) =>
                updateNode(
                  node.id,
                  { transform: { ...node.transform, fitMode: value as ImageFitMode } },
                  true,
                )
              }
            />
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <Slider
                label="Scale X"
                value={typeof node.transform.scaleX === 'number' ? node.transform.scaleX : 1}
                min={0.01}
                max={5}
                step={0.01}
                onChange={(value) => setKeyframe(node.id, 'transform.scaleX', value)}
                onReset={() =>
                  updateNode(
                    node.id,
                    { transform: { ...node.transform, scaleX: 1, fitMode: ImageFitMode.FIT } },
                    true,
                  )
                }
                displayFormatter={(value) => `${Math.round(value * 100)}%`}
              />
            </div>
            <div className="flex-1 min-w-0">
              <Slider
                label="Scale Y"
                value={typeof node.transform.scaleY === 'number' ? node.transform.scaleY : 1}
                min={0.01}
                max={5}
                step={0.01}
                onChange={(value) => setKeyframe(node.id, 'transform.scaleY', value)}
                onReset={() =>
                  updateNode(
                    node.id,
                    { transform: { ...node.transform, scaleY: 1, fitMode: ImageFitMode.FIT } },
                    true,
                  )
                }
                displayFormatter={(value) => `${Math.round(value * 100)}%`}
              />
            </div>
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );
};

export default OnnxAdjustments;
