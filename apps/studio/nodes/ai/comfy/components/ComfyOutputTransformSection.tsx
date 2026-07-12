import { useMemo, useRef, useState } from 'react';
import type {
  ComfyNode,
  GeneratedOutput,
  GeneratedOutputDifferenceMask,
  ImageTransform,
} from '@blackboard/types';
import { ImageFitMode, NodeType, SceneNode } from '@blackboard/types';
import { getValueAtFrame, hasKeyframeAt } from '@blackboard/renderer';
import { CollapsibleSection, Slider } from '@blackboard/ui';
import { calculateTransformForFitMode } from '@/state/editor/selectors';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import { ImageTransformSettings, type LinkedScaleUpdate } from '@/nodes/ImageTransformSettings';
import { isAutoImageFitMode } from '@/nodes/imageFitMode';
import {
  CheckboxIndicator,
  MediaColorManagementControls,
  SegmentedControl,
  SplitButton,
} from '@/components';
import { getMediaSourceColorSpace } from '@/color-management';
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
    if (!output.differenceMask) return;
    const nextGeneratedOutputs = (node.generatedOutputs ?? []).map((generatedOutput) =>
      generatedOutput.id === output.id
        ? {
            ...generatedOutput,
            differenceMask: { ...output.differenceMask, ...updates },
          }
        : generatedOutput,
    );
    updateNode(node.id, { generatedOutputs: nextGeneratedOutputs }, withHistory);
  };

  const startMaskAdjustmentPreview = () => {
    const previewMode = output.differenceMask?.previewMode ?? 'result';
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
    updateOutputTransform({ fitMode: mode });
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
        <CollapsibleSection
          title="Post Process"
          defaultOpen={output.differenceMask?.enabled === true}
        >
          <div className="space-y-3">
            <label
              className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs transition ${
                output.differenceMask
                  ? 'cursor-pointer border-white/10 bg-gray-900/50 text-gray-300 hover:border-primary-300/20'
                  : 'cursor-not-allowed border-white/5 bg-gray-950/30 text-gray-600'
              }`}
            >
              <input
                type="checkbox"
                checked={output.differenceMask?.enabled === true}
                disabled={!output.differenceMask}
                onChange={(event) => updateOutputDifferenceMask({ enabled: event.target.checked })}
                className="peer sr-only"
              />
              <CheckboxIndicator
                checked={output.differenceMask?.enabled === true}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block font-medium">Difference mask</span>
                <span className="mt-0.5 block text-[11px] leading-4 text-gray-500">
                  {output.differenceMask
                    ? 'Reveal only areas changed from the image used for this generation.'
                    : 'Generate again with an image input to capture a difference reference.'}
                </span>
              </span>
            </label>

            {output.differenceMask?.enabled ? (
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
                    value={output.differenceMask.previewMode ?? 'result'}
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
                  <div className="text-xs font-medium text-gray-300">Difference range</div>
                  <div className="mt-0.5 text-[11px] leading-4 text-gray-500">
                    Changes fade in between the minimum and full-opacity thresholds.
                  </div>
                </div>
                <Slider
                  label="Minimum change"
                  value={output.differenceMask.thresholdLow}
                  min={0}
                  max={0.5}
                  step={0.005}
                  displayFormatter={(value) => `${Math.round(value * 100)}%`}
                  onInteractionStart={startMaskAdjustmentPreview}
                  onInteractionEnd={endMaskAdjustmentPreview}
                  onChange={(thresholdLow) =>
                    updateMaskWhileAdjusting({
                      thresholdLow: Math.min(
                        thresholdLow,
                        output.differenceMask!.thresholdHigh - 0.005,
                      ),
                    })
                  }
                  onReset={() => updateOutputDifferenceMask({ thresholdLow: 0.06 })}
                />
                <Slider
                  label="Full opacity"
                  value={output.differenceMask.thresholdHigh}
                  min={0.005}
                  max={0.75}
                  step={0.005}
                  displayFormatter={(value) => `${Math.round(value * 100)}%`}
                  onInteractionStart={startMaskAdjustmentPreview}
                  onInteractionEnd={endMaskAdjustmentPreview}
                  onChange={(thresholdHigh) =>
                    updateMaskWhileAdjusting({
                      thresholdHigh: Math.max(
                        thresholdHigh,
                        output.differenceMask!.thresholdLow + 0.005,
                      ),
                    })
                  }
                  onReset={() => updateOutputDifferenceMask({ thresholdHigh: 0.18 })}
                />
                <div className="border-t border-white/10 pt-3">
                  <div className="text-xs font-medium text-gray-300">Cleanup</div>
                  <div className="mt-0.5 text-[11px] leading-4 text-gray-500">
                    Remove isolated islands or close transparent holes without changing the main
                    mask edge.
                  </div>
                </div>
                <Slider
                  label="Remove small islands"
                  value={output.differenceMask.removeSpecks ?? 0}
                  min={0}
                  max={24}
                  step={1}
                  displayFormatter={(value) => (value === 0 ? 'Off' : `${value} px`)}
                  onInteractionStart={startMaskAdjustmentPreview}
                  onInteractionEnd={endMaskAdjustmentPreview}
                  onChange={(removeSpecks) => updateMaskWhileAdjusting({ removeSpecks })}
                  onReset={() => updateOutputDifferenceMask({ removeSpecks: 0 })}
                />
                <Slider
                  label="Fill small holes"
                  value={output.differenceMask.fillHoles ?? 0}
                  min={0}
                  max={24}
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
                  value={output.differenceMask.edgeAdjustment}
                  min={-32}
                  max={32}
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
                    checked={output.differenceMask.invert === true}
                    onChange={(event) =>
                      updateOutputDifferenceMask({ invert: event.target.checked })
                    }
                    className="peer sr-only"
                  />
                  <CheckboxIndicator checked={output.differenceMask.invert === true} />
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
