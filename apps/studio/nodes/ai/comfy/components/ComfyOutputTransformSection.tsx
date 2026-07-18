import { useMemo, useRef, useState } from 'react';
import type {
  ComfyNode,
  DifferenceMaskMorphologyShape,
  GeneratedOutput,
  GeneratedOutputDifferenceMask,
  ImageTransform,
} from '@blackboard/types';
import { ImageFitMode, NodeType, SceneNode } from '@blackboard/types';
import {
  getValueAtFrame,
  hasKeyframeAt,
  MAX_DIFFERENCE_MASK_MORPHOLOGY_RADIUS,
} from '@blackboard/renderer';
import { CollapsibleSection, RangeSlider, Slider } from '@blackboard/ui';
import { calculateTransformForFitMode } from '@/state/editor/selectors';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import { ImageTransformSettings, type LinkedScaleUpdate } from '@/nodes/ImageTransformSettings';
import { getImageFitModeTransformUpdate, isAutoImageFitMode } from '@/nodes/imageFitMode';
import {
  CheckboxIndicator,
  MediaColorManagementControls,
  SegmentedControl,
  SplitButton,
} from '@/components';
import { getMediaSourceColorSpace } from '@/color-management';
import {
  DEFAULT_COMFY_DIFFERENCE_MASK_SETTINGS,
  resolveComfyDifferenceMask,
} from '../comfyDifferenceMask';
import { ComfyAlignmentOptionsSection } from './ComfyAlignmentOptionsSection';

const formatSize = (width: number, height: number): string =>
  width > 0 && height > 0 ? `${Math.round(width)} x ${Math.round(height)}` : 'No output';

interface ComfyOutputTransformSectionProps {
  node: ComfyNode;
  output: GeneratedOutput;
  sceneSizeLabel: string;
  onAlignToInput: () => Promise<ImageTransform | null>;
}

export function ComfyOutputTransformSection({
  node,
  output,
  sceneSizeLabel,
  onAlignToInput,
}: ComfyOutputTransformSectionProps) {
  const currentFrame = useEditorSelector((state) => state.currentFrame);
  const sceneNode = useEditorSelector((state) =>
    state.nodes.find((candidate): candidate is SceneNode => candidate.type === NodeType.SCENE),
  );
  const { updateNode, setKeyframe } = useEditorActions();
  const [isAligning, setIsAligning] = useState(false);
  const [alignmentMessage, setAlignmentMessage] = useState<string | null>(null);
  const maskPreviewBeforeInteractionRef = useRef<NonNullable<
    GeneratedOutputDifferenceMask['previewMode']
  > | null>(null);

  const outputTransform = output.transform ?? node.transform;
  const outputUseOutputSizeAsScene = output.useOutputSizeAsScene === true;
  const fitMode = outputTransform.fitMode;

  const scaleXAtCurrentFrame = getValueAtFrame(outputTransform.scaleX, currentFrame);
  const scaleYAtCurrentFrame = getValueAtFrame(outputTransform.scaleY, currentFrame);
  const positionXAtCurrentFrame = getValueAtFrame(outputTransform.x, currentFrame);
  const positionYAtCurrentFrame = getValueAtFrame(outputTransform.y, currentFrame);
  const outputSizeLabel = formatSize(output.width, output.height);
  const differenceMask = output.differenceMask
    ? resolveComfyDifferenceMask(output.differenceMask)
    : null;

  const autoFitScale = useMemo(() => {
    if (outputUseOutputSizeAsScene || !isAutoImageFitMode(fitMode)) return null;
    const regionRect = output.regionId
      ? (node.viewportPromptRegions ?? []).find((r) => r.id === output.regionId)?.rect
      : output.regionRect;
    const effectiveScene = regionRect
      ? { width: regionRect.width, height: regionRect.height }
      : sceneNode
        ? { width: sceneNode.width, height: sceneNode.height }
        : null;
    if (!effectiveScene || output.width <= 0 || output.height <= 0) return null;
    return calculateTransformForFitMode(
      { width: output.width, height: output.height },
      effectiveScene,
      fitMode,
    );
  }, [
    outputUseOutputSizeAsScene,
    fitMode,
    output.regionId,
    output.regionRect,
    sceneNode,
    output.width,
    output.height,
    node.viewportPromptRegions,
  ]);

  const displayScaleX = autoFitScale?.scaleX ?? scaleXAtCurrentFrame;
  const displayScaleY = autoFitScale?.scaleY ?? scaleYAtCurrentFrame;
  const isAutoFitActive = autoFitScale !== null;

  const updateOutputTransform = (updates: Partial<ImageTransform>, withHistory = true) => {
    const nextGeneratedOutputs = (node.generatedOutputs ?? []).map((genOutput) =>
      genOutput.id === output.id
        ? {
            ...genOutput,
            transform: { ...(genOutput.transform ?? node.transform), ...updates } as ImageTransform,
          }
        : genOutput,
    );
    updateNode(node.id, { generatedOutputs: nextGeneratedOutputs }, withHistory);
  };

  const updateOutputUseOutputSizeAsScene = (checked: boolean) => {
    const nextGeneratedOutputs = (node.generatedOutputs ?? []).map((genOutput) =>
      genOutput.id === output.id
        ? { ...genOutput, useOutputSizeAsScene: checked || undefined }
        : genOutput,
    );
    updateNode(node.id, { generatedOutputs: nextGeneratedOutputs }, true);
  };

  const updateOutputColorManagement = (
    mediaColorManagement: NonNullable<GeneratedOutput['mediaColorManagement']>,
  ) => {
    const colorSpace = getMediaSourceColorSpace(mediaColorManagement);
    const nextGeneratedOutputs = (node.generatedOutputs ?? []).map((generatedOutput) =>
      generatedOutput.id === output.id
        ? { ...generatedOutput, colorSpace, mediaColorManagement }
        : generatedOutput,
    );
    updateNode(
      node.id,
      {
        generatedOutputs: nextGeneratedOutputs,
        ...(node.activeGeneratedOutputId === output.id
          ? {
              ...(colorSpace ? { colorSpace } : {}),
              mediaColorManagement,
            }
          : {}),
      },
      true,
    );
  };

  const updateOutputDifferenceMask = (
    updates: Partial<GeneratedOutputDifferenceMask>,
    withHistory = true,
  ) => {
    if (!differenceMask) return;
    const nextGeneratedOutputs = (node.generatedOutputs ?? []).map((generatedOutput) =>
      generatedOutput.id === output.id
        ? {
            ...generatedOutput,
            differenceMask: { ...differenceMask, ...updates },
          }
        : generatedOutput,
    );
    updateNode(node.id, { generatedOutputs: nextGeneratedOutputs }, withHistory);
  };

  const startMaskAdjustmentPreview = () => {
    const previewMode = differenceMask?.previewMode ?? 'result';
    maskPreviewBeforeInteractionRef.current = previewMode;
    if (previewMode === 'result') {
      updateOutputDifferenceMask({ previewMode: 'overlay' }, false);
    }
  };

  const updateMaskWhileAdjusting = (updates: Partial<GeneratedOutputDifferenceMask>) => {
    updateOutputDifferenceMask({
      ...updates,
      ...(maskPreviewBeforeInteractionRef.current === 'result'
        ? { previewMode: 'overlay' as const }
        : {}),
    });
  };

  const endMaskAdjustmentPreview = () => {
    const previewMode = maskPreviewBeforeInteractionRef.current;
    maskPreviewBeforeInteractionRef.current = null;
    if (previewMode === 'result') {
      updateOutputDifferenceMask({ previewMode: 'result' }, false);
    }
  };

  const handleFitModeChange = (mode: ImageFitMode) => {
    if (outputUseOutputSizeAsScene) return;
    updateOutputTransform(getImageFitModeTransformUpdate(mode));
  };

  const handleOutputSizeSceneChange = (checked: boolean) => {
    updateOutputUseOutputSizeAsScene(checked);
  };

  const getOutputTransformKeyframePath = (field: string): string =>
    `generatedOutputs[${(node.generatedOutputs ?? []).findIndex((gen) => gen.id === output.id)}].transform.${field}`;

  const markCustomFitMode = () => {
    if (outputTransform.fitMode === ImageFitMode.CUSTOM) return;
    updateOutputTransform({ fitMode: ImageFitMode.CUSTOM }, false);
  };

  const commitScaleUpdate = ({ axis, scaleX, scaleY, linked }: LinkedScaleUpdate) => {
    if (outputUseOutputSizeAsScene) return;
    markCustomFitMode();

    const shouldSetScaleX = axis === 'x' || linked;
    const shouldSetScaleY = axis === 'y' || linked;

    if (shouldSetScaleX) {
      setKeyframe(node.id, getOutputTransformKeyframePath('scaleX'), scaleX, !shouldSetScaleY);
    }
    if (shouldSetScaleY) {
      setKeyframe(node.id, getOutputTransformKeyframePath('scaleY'), scaleY);
    }
  };

  const commitPositionUpdate = (axis: 'x' | 'y', value: number) => {
    if (outputUseOutputSizeAsScene) return;
    markCustomFitMode();
    setKeyframe(node.id, getOutputTransformKeyframePath(axis), value);
  };

  const handleAlignToInput = async () => {
    setIsAligning(true);
    setAlignmentMessage(null);
    try {
      const alignedTransform = await onAlignToInput();
      if (!alignedTransform) {
        setAlignmentMessage('No reliable image match was found.');
        return;
      }
      updateOutputTransform(alignedTransform);
      setAlignmentMessage(
        `Aligned · X ${Number(alignedTransform.x).toFixed(2)} px · Y ${Number(alignedTransform.y).toFixed(2)} px · Scale ${Number(alignedTransform.scaleX).toFixed(5)} × ${Number(alignedTransform.scaleY).toFixed(5)}`,
      );
    } catch (error) {
      setAlignmentMessage(error instanceof Error ? error.message : 'Could not align this output.');
    } finally {
      setIsAligning(false);
    }
  };

  return (
    <div className="space-y-3">
      {output.mediaKind !== 'model_3d' ? (
        <CollapsibleSection title="Color Management" defaultOpen>
          <MediaColorManagementControls
            value={output.mediaColorManagement}
            onChange={updateOutputColorManagement}
          />
        </CollapsibleSection>
      ) : null}

      {output.mediaKind !== 'model_3d' ? (
        <CollapsibleSection title="Post Process" defaultOpen={differenceMask?.enabled === true}>
          <div className="space-y-3">
            <label
              className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs transition ${
                differenceMask
                  ? 'cursor-pointer border-white/10 bg-gray-900/50 text-gray-300 hover:border-primary-300/20'
                  : 'cursor-not-allowed border-white/5 bg-gray-950/30 text-gray-600'
              }`}
            >
              <input
                type="checkbox"
                checked={differenceMask?.enabled === true}
                disabled={!differenceMask}
                onChange={(event) => updateOutputDifferenceMask({ enabled: event.target.checked })}
                className="peer sr-only"
              />
              <CheckboxIndicator checked={differenceMask?.enabled === true} className="mt-0.5" />
              <span className="min-w-0">
                <span className="block font-medium">Difference mask</span>
                <span className="mt-0.5 block text-[11px] leading-4 text-gray-500">
                  {differenceMask
                    ? 'Reveal only areas changed from the image used for this generation.'
                    : 'Generate again with an image input to capture a difference reference.'}
                </span>
              </span>
            </label>

            {differenceMask?.enabled ? (
              <div className="space-y-3 rounded-lg border border-white/10 bg-gray-950/30 p-3">
                <div>
                  <div className="mb-2 text-xs font-medium text-gray-300">Viewport preview</div>
                  <SegmentedControl
                    ariaLabel="Difference mask viewport preview"
                    options={[
                      { value: 'result', label: 'Result' },
                      { value: 'overlay', label: 'Overlay' },
                      { value: 'matte', label: 'Matte' },
                    ]}
                    value={differenceMask.previewMode ?? 'result'}
                    onChange={(previewMode) =>
                      updateOutputDifferenceMask({
                        previewMode: previewMode as NonNullable<
                          GeneratedOutputDifferenceMask['previewMode']
                        >,
                      })
                    }
                  />
                  <div className="mt-1 text-[10px] leading-4 text-gray-500">
                    Export always uses Result. Result temporarily shows Overlay while dragging.
                  </div>
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-300">Change detection</div>
                  <div className="mt-0.5 text-[11px] leading-4 text-gray-500">
                    Compares perceptual OKLab lightness and color, not raw RGB channels. Small image
                    noise is smoothed before measuring change.
                  </div>
                </div>
                <Slider
                  label="Noise reduction"
                  description="Smooth compression noise and single-pixel variation before comparison."
                  value={differenceMask.comparisonBlur}
                  min={0}
                  max={6}
                  step={0.25}
                  displayFormatter={(value) => (value === 0 ? 'Off' : `${value.toFixed(2)} px`)}
                  onInteractionStart={startMaskAdjustmentPreview}
                  onInteractionEnd={endMaskAdjustmentPreview}
                  onChange={(comparisonBlur) => updateMaskWhileAdjusting({ comparisonBlur })}
                  onReset={() =>
                    updateOutputDifferenceMask({
                      comparisonBlur: DEFAULT_COMFY_DIFFERENCE_MASK_SETTINGS.comparisonBlur,
                    })
                  }
                />
                <div>
                  <RangeSlider
                    label="Change opacity range"
                    value={[differenceMask.thresholdLow, differenceMask.thresholdHigh]}
                    min={0}
                    max={0.75}
                    step={0.005}
                    minGap={0.005}
                    displayFormatter={(value) => `${Math.round(value * 100)}%`}
                    onInteractionStart={startMaskAdjustmentPreview}
                    onInteractionEnd={endMaskAdjustmentPreview}
                    onValueChange={([thresholdLow, thresholdHigh]) =>
                      updateMaskWhileAdjusting({ thresholdLow, thresholdHigh })
                    }
                    onReset={() =>
                      updateOutputDifferenceMask({
                        thresholdLow: DEFAULT_COMFY_DIFFERENCE_MASK_SETTINGS.thresholdLow,
                        thresholdHigh: DEFAULT_COMFY_DIFFERENCE_MASK_SETTINGS.thresholdHigh,
                      })
                    }
                    trackBackground="linear-gradient(90deg, #111827, #64748b 45%, #f8fafc)"
                  />
                  <div className="mt-1 flex items-center justify-between gap-3 text-[10px] leading-4 text-gray-500">
                    <span>Minimum change · transparent below</span>
                    <span className="text-right">Full opacity · solid above</span>
                  </div>
                </div>
                <div className="border-t border-white/10 pt-3">
                  <div className="text-xs font-medium text-gray-300">Shape cleanup</div>
                  <div className="mt-0.5 text-[11px] leading-4 text-gray-500">
                    Uses GPU morphological opening and closing on the matte, preserving solid change
                    regions while cleaning their shape.
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-xs font-medium text-gray-300">Cleanup shape</div>
                  <SegmentedControl
                    ariaLabel="Difference mask cleanup shape"
                    options={[
                      { value: 'round', label: 'Round' },
                      { value: 'square', label: 'Square' },
                    ]}
                    value={differenceMask.morphologyShape}
                    onChange={(morphologyShape) =>
                      updateOutputDifferenceMask({
                        morphologyShape: morphologyShape as DifferenceMaskMorphologyShape,
                      })
                    }
                  />
                  <div className="mt-1 text-[10px] leading-4 text-gray-500">
                    Round avoids box corners at large radii. Square preserves axis-aligned geometry.
                  </div>
                </div>
                <Slider
                  label="Remove small regions"
                  description="Opening removes isolated regions and narrow protrusions up to this radius."
                  value={differenceMask.removeSpecks}
                  min={0}
                  max={MAX_DIFFERENCE_MASK_MORPHOLOGY_RADIUS}
                  step={1}
                  displayFormatter={(value) => (value === 0 ? 'Off' : `${value} px`)}
                  onInteractionStart={startMaskAdjustmentPreview}
                  onInteractionEnd={endMaskAdjustmentPreview}
                  onChange={(removeSpecks) => updateMaskWhileAdjusting({ removeSpecks })}
                  onReset={() => updateOutputDifferenceMask({ removeSpecks: 0 })}
                />
                <Slider
                  label="Fill holes and gaps"
                  description="Closing fills transparent holes and narrow gaps up to this radius."
                  value={differenceMask.fillHoles}
                  min={0}
                  max={MAX_DIFFERENCE_MASK_MORPHOLOGY_RADIUS}
                  step={1}
                  displayFormatter={(value) => (value === 0 ? 'Off' : `${value} px`)}
                  onInteractionStart={startMaskAdjustmentPreview}
                  onInteractionEnd={endMaskAdjustmentPreview}
                  onChange={(fillHoles) => updateMaskWhileAdjusting({ fillHoles })}
                  onReset={() => updateOutputDifferenceMask({ fillHoles: 0 })}
                />
                <Slider
                  label="Mask edge"
                  description="Contract or expand the cleaned mask edge. Applied last."
                  value={differenceMask.edgeAdjustment}
                  min={-MAX_DIFFERENCE_MASK_MORPHOLOGY_RADIUS}
                  max={MAX_DIFFERENCE_MASK_MORPHOLOGY_RADIUS}
                  step={1}
                  displayFormatter={(value) =>
                    value < 0
                      ? `Contract ${Math.abs(value)} px`
                      : value > 0
                        ? `Expand ${value} px`
                        : 'None'
                  }
                  onInteractionStart={startMaskAdjustmentPreview}
                  onInteractionEnd={endMaskAdjustmentPreview}
                  onChange={(edgeAdjustment) => updateMaskWhileAdjusting({ edgeAdjustment })}
                  onReset={() => updateOutputDifferenceMask({ edgeAdjustment: 0 })}
                />
                <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-400">
                  <input
                    type="checkbox"
                    checked={differenceMask.invert === true}
                    onChange={(event) =>
                      updateOutputDifferenceMask({ invert: event.target.checked })
                    }
                    className="peer sr-only"
                  />
                  <CheckboxIndicator checked={differenceMask.invert === true} />
                  Invert mask
                </label>
              </div>
            ) : null}
          </div>
        </CollapsibleSection>
      ) : null}

      <ImageTransformSettings
        leadingContent={
          <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-medium text-gray-300">Image-to-image alignment</div>
                <div className="mt-1 text-[11px] leading-4 text-gray-500">
                  Match this output to its input and store the result as editable scale and offsets.
                </div>
              </div>
              <SplitButton
                actionDisabled={isAligning || outputUseOutputSizeAsScene}
                menuDisabled={isAligning}
                onClick={() => void handleAlignToInput()}
                menuLabel="Alignment settings"
                menuWidthClass="w-[22rem]"
                menu={<ComfyAlignmentOptionsSection node={node} />}
              >
                {isAligning ? 'Aligning...' : 'Align to Input'}
              </SplitButton>
            </div>
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-gray-400">
              <input
                type="checkbox"
                checked={node.autoAlignOutputs !== false}
                onChange={(event) =>
                  updateNode(node.id, { autoAlignOutputs: event.target.checked }, true)
                }
                className="peer sr-only"
              />
              <CheckboxIndicator checked={node.autoAlignOutputs !== false} />
              Auto-align new image outputs
            </label>
            {alignmentMessage ? (
              <div className="mt-2 text-[11px] leading-4 text-gray-400">{alignmentMessage}</div>
            ) : null}
          </div>
        }
        fitMode={outputTransform.fitMode}
        scaleX={displayScaleX}
        scaleY={displayScaleY}
        positionX={positionXAtCurrentFrame}
        positionY={positionYAtCurrentFrame}
        positionRange={{
          x: Math.max(sceneNode?.width ?? output.width, 1),
          y: Math.max(sceneNode?.height ?? output.height, 1),
        }}
        sceneSizeLabel={sceneSizeLabel}
        outputSizeLabel={outputSizeLabel}
        useOutputSizeAsScene={outputUseOutputSizeAsScene}
        scaleXKeyframed={!isAutoFitActive && hasKeyframeAt(outputTransform.scaleX, currentFrame)}
        scaleYKeyframed={!isAutoFitActive && hasKeyframeAt(outputTransform.scaleY, currentFrame)}
        positionXKeyframed={hasKeyframeAt(outputTransform.x, currentFrame)}
        positionYKeyframed={hasKeyframeAt(outputTransform.y, currentFrame)}
        onFitModeChange={handleFitModeChange}
        onUseOutputSizeAsSceneChange={handleOutputSizeSceneChange}
        onScaleChange={commitScaleUpdate}
        onScaleReset={commitScaleUpdate}
        onPositionChange={commitPositionUpdate}
        onPositionReset={(axis) => commitPositionUpdate(axis, 0)}
        onToggleScaleXKeyframe={() =>
          setKeyframe(node.id, getOutputTransformKeyframePath('scaleX'))
        }
        onToggleScaleYKeyframe={() =>
          setKeyframe(node.id, getOutputTransformKeyframePath('scaleY'))
        }
        onTogglePositionXKeyframe={() => setKeyframe(node.id, getOutputTransformKeyframePath('x'))}
        onTogglePositionYKeyframe={() => setKeyframe(node.id, getOutputTransformKeyframePath('y'))}
      />
    </div>
  );
}
