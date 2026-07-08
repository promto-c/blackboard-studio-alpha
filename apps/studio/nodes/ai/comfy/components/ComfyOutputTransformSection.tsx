import { useMemo, useState } from 'react';
import type { ComfyNode, GeneratedOutput, ImageTransform } from '@blackboard/types';
import { ImageFitMode, NodeType, SceneNode } from '@blackboard/types';
import { getValueAtFrame, hasKeyframeAt } from '@blackboard/renderer';
import { CollapsibleSection } from '@blackboard/ui';
import { calculateTransformForFitMode } from '@/state/editor/selectors';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import { ImageTransformSettings, type LinkedScaleUpdate } from '@/nodes/ImageTransformSettings';
import { isAutoImageFitMode } from '@/nodes/imageFitMode';
import { MediaColorManagementControls } from '@/components';
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
      setAlignmentMessage('Aligned with explicit scale and offsets.');
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

      <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-medium text-gray-300">Image-to-image alignment</div>
            <div className="mt-1 text-[11px] leading-4 text-gray-500">
              Match this output to its input and store the result as editable scale and offsets.
            </div>
          </div>
          <button
            type="button"
            disabled={isAligning || outputUseOutputSizeAsScene}
            onClick={() => void handleAlignToInput()}
            className="shrink-0 rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-xs font-medium text-gray-200 transition hover:border-gray-600 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {isAligning ? 'Aligning...' : 'Align to input'}
          </button>
        </div>
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-gray-400">
          <input
            type="checkbox"
            checked={node.autoAlignOutputs === true}
            onChange={(event) =>
              updateNode(node.id, { autoAlignOutputs: event.target.checked }, true)
            }
            className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-800 text-primary-500"
          />
          Auto-align new image outputs
        </label>
        {node.autoAlignOutputs ? <ComfyAlignmentOptionsSection node={node} /> : null}
        {alignmentMessage ? (
          <div className="mt-2 text-[11px] leading-4 text-gray-400">{alignmentMessage}</div>
        ) : null}
      </div>

      <ImageTransformSettings
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
