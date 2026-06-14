import { useMemo } from 'react';
import type { ComfyNode, GeneratedOutput, ImageTransform } from '@blackboard/types';
import { ImageFitMode, NodeType, SceneNode } from '@blackboard/types';
import { getValueAtFrame, hasKeyframeAt } from '@blackboard/renderer';
import { calculateTransformForFitMode } from '@/state/editor/selectors';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import { ImageTransformSettings, type LinkedScaleUpdate } from '@/nodes/ImageTransformSettings';
import { isAutoImageFitMode } from '@/nodes/imageFitMode';

const formatSize = (width: number, height: number): string =>
  width > 0 && height > 0 ? `${Math.round(width)} x ${Math.round(height)}` : 'No output';

interface ComfyOutputTransformSectionProps {
  node: ComfyNode;
  output: GeneratedOutput;
  sceneSizeLabel: string;
}

export function ComfyOutputTransformSection({
  node,
  output,
  sceneSizeLabel,
}: ComfyOutputTransformSectionProps) {
  const currentFrame = useEditorSelector((state) => state.currentFrame);
  const sceneNode = useEditorSelector((state) =>
    state.nodes.find((candidate): candidate is SceneNode => candidate.type === NodeType.SCENE),
  );
  const { updateNode, setKeyframe } = useEditorActions();

  const outputTransform = output.transform ?? node.transform;
  const outputUseOutputSizeAsScene = output.useOutputSizeAsScene === true;
  const fitMode = outputTransform.fitMode;

  const scaleXAtCurrentFrame = getValueAtFrame(outputTransform.scaleX, currentFrame);
  const scaleYAtCurrentFrame = getValueAtFrame(outputTransform.scaleY, currentFrame);
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

  return (
    <ImageTransformSettings
      fitMode={outputTransform.fitMode}
      scaleX={displayScaleX}
      scaleY={displayScaleY}
      sceneSizeLabel={sceneSizeLabel}
      outputSizeLabel={outputSizeLabel}
      useOutputSizeAsScene={outputUseOutputSizeAsScene}
      scaleXKeyframed={!isAutoFitActive && hasKeyframeAt(outputTransform.scaleX, currentFrame)}
      scaleYKeyframed={!isAutoFitActive && hasKeyframeAt(outputTransform.scaleY, currentFrame)}
      onFitModeChange={handleFitModeChange}
      onUseOutputSizeAsSceneChange={handleOutputSizeSceneChange}
      onScaleChange={commitScaleUpdate}
      onScaleReset={commitScaleUpdate}
      onToggleScaleXKeyframe={() => setKeyframe(node.id, getOutputTransformKeyframePath('scaleX'))}
      onToggleScaleYKeyframe={() => setKeyframe(node.id, getOutputTransformKeyframePath('scaleY'))}
    />
  );
}
