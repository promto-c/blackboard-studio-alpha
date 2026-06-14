import { ImageFitMode, NodeType, SceneNode } from '@blackboard/types';
import { getValueAtFrame, hasKeyframeAt } from '@blackboard/renderer';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import { ImageTransformSettings, type LinkedScaleUpdate } from './ImageTransformSettings';
import type { SourceTransformNode } from './sourceNodeBehavior';

const formatSize = (width: number, height: number): string =>
  width > 0 && height > 0 ? `${Math.round(width)} x ${Math.round(height)}` : 'No output';

function SourceTransformControls({ node }: { node: SourceTransformNode }) {
  const currentFrame = useEditorSelector((state) => state.currentFrame);
  const sceneNode = useEditorSelector((state) =>
    state.nodes.find((candidate): candidate is SceneNode => candidate.type === NodeType.SCENE),
  );
  const { updateNode, setKeyframe } = useEditorActions();

  const scaleXAtCurrentFrame = getValueAtFrame(node.transform.scaleX, currentFrame);
  const scaleYAtCurrentFrame = getValueAtFrame(node.transform.scaleY, currentFrame);
  const hasOutputSize = node.width > 0 && node.height > 0;
  const useOutputSizeAsScene = node.useOutputSizeAsScene === true;
  const sceneSizeLabel = sceneNode ? formatSize(sceneNode.width, sceneNode.height) : 'No scene';
  const outputSizeLabel = hasOutputSize ? formatSize(node.width, node.height) : 'Waiting';

  const handleFitModeChange = (mode: ImageFitMode) => {
    if (useOutputSizeAsScene) return;
    updateNode(node.id, { transform: { fitMode: mode } }, true);
  };

  const handleOutputSizeSceneChange = (checked: boolean) => {
    updateNode(node.id, { useOutputSizeAsScene: checked }, true);
  };

  const markCustomFitMode = () => {
    if (node.transform.fitMode === ImageFitMode.CUSTOM) return;
    updateNode(node.id, { transform: { fitMode: ImageFitMode.CUSTOM } }, false);
  };

  const commitScaleUpdate = ({ axis, scaleX, scaleY, linked }: LinkedScaleUpdate) => {
    if (useOutputSizeAsScene) return;
    markCustomFitMode();

    const shouldSetScaleX = axis === 'x' || linked;
    const shouldSetScaleY = axis === 'y' || linked;

    if (shouldSetScaleX) {
      setKeyframe(node.id, 'transform.scaleX', scaleX, !shouldSetScaleY);
    }
    if (shouldSetScaleY) {
      setKeyframe(node.id, 'transform.scaleY', scaleY);
    }
  };

  return (
    <ImageTransformSettings
      fitMode={node.transform.fitMode}
      scaleX={scaleXAtCurrentFrame}
      scaleY={scaleYAtCurrentFrame}
      sceneSizeLabel={sceneSizeLabel}
      outputSizeLabel={outputSizeLabel}
      useOutputSizeAsScene={useOutputSizeAsScene}
      scaleXKeyframed={hasKeyframeAt(node.transform.scaleX, currentFrame)}
      scaleYKeyframed={hasKeyframeAt(node.transform.scaleY, currentFrame)}
      onFitModeChange={handleFitModeChange}
      onUseOutputSizeAsSceneChange={handleOutputSizeSceneChange}
      onScaleChange={commitScaleUpdate}
      onScaleReset={commitScaleUpdate}
      onToggleScaleXKeyframe={() => setKeyframe(node.id, 'transform.scaleX')}
      onToggleScaleYKeyframe={() => setKeyframe(node.id, 'transform.scaleY')}
    />
  );
}

export default SourceTransformControls;
