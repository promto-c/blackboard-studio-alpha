import {
  BlendMode,
  ComfyNode,
  ImageFitMode,
  ImageTransform,
  NodeType,
  SceneNode,
} from '@blackboard/types';
import { EffectDefinition } from '../EffectDefinition';
import { mediaTransformAnimation } from '../effectAnimationHelpers';
import { calculateTransformForFitMode } from '@/state/editor/selectors';
import ComfyAdjustments from './ComfyAdjustments';
import { ComfyTool } from './ComfyTool';
import { getComfyWorkflowInputCandidates, getComfyWorkflowInputPortName } from './comfyInputs';
import * as Icons from '@blackboard/icons';

const getComfyNodeAssetIds = (node: ComfyNode): string[] =>
  Array.from(
    new Set([
      node.src,
      ...(node.generatedOutputs ?? []).map((output) => output.src),
      ...Object.values(node.workflowInputImages ?? {}).map((inputImage) => inputImage.assetId),
    ]),
  ).filter((src): src is string => Boolean(src));

export const comfyEffect: EffectDefinition = {
  type: NodeType.COMFY,
  name: 'Comfy',
  category: 'Image',
  renderMode: 'media',
  description: 'Connect to ComfyUI, select a workflow, and render the output into Studio.',
  IconComponent: Icons.ComputerDesktop,
  ToolComponent: ComfyTool,
  AdjustmentComponent: ComfyAdjustments,
  animation: mediaTransformAnimation,
  flags: {
    isSource: true,
    isRenderable: true,
    isMediaNode: true,
    showDataWindow: true,
    hasThumbnail: true,
  },
  getInitialNodeProps: (): Omit<ComfyNode, 'id' | 'name' | 'visible' | 'type'> => ({
    workflows: [],
    selectedWorkflowId: undefined,
    workflowControls: [],
    workflowInputImages: {},
    generatedOutputs: [],
    activeGeneratedOutputId: undefined,
    src: '',
    width: 0,
    height: 0,
    opacity: 100,
    operator: BlendMode.OVER,
    transform: { x: 0, y: 0, scale: 1, fitMode: ImageFitMode.FIT },
    colorSpace: 'sRGB',
    lastPromptId: undefined,
    lastRunAt: undefined,
    lastError: undefined,
  }),
  inputPorts: (node) => {
    const comfyNode = node as ComfyNode;
    const workflow =
      comfyNode.workflows.find((candidate) => candidate.id === comfyNode.selectedWorkflowId) ??
      comfyNode.workflows[0];

    return getComfyWorkflowInputCandidates(workflow).map((candidate) => ({
      name: getComfyWorkflowInputPortName(workflow.id, candidate),
      label: candidate.label,
      type: 'texture' as const,
      required: false,
      description: `${candidate.nodeType} #${candidate.nodeId} · ${candidate.inputName}`,
    }));
  },
  getAssetIds: (node) => {
    return getComfyNodeAssetIds(node as ComfyNode);
  },
  mediaDescriptor: {
    getAssetIds: (node) => {
      return getComfyNodeAssetIds(node as ComfyNode);
    },
    checkFrameReady: (node, _frame, caches) => {
      const src = (node as ComfyNode).src;
      return !src || caches.imageCache.has(src);
    },
    getMediaTextureKey: (node) => (node as ComfyNode).src || '',
    getColorSpace: (node) => (node as ComfyNode).colorSpace,
  },
  onNodeUpdate: (node, changes, context) => {
    const comfyNode = node as ComfyNode;

    if ('transform' in changes && changes.transform && context.sceneNode) {
      const oldTransform = comfyNode.transform;
      const newTransformPartial = changes.transform as Partial<ImageTransform>;
      const label = `Transform ${node.name}`;
      const sceneNode = context.sceneNode as SceneNode;

      if (newTransformPartial.fitMode && newTransformPartial.fitMode !== oldTransform.fitMode) {
        const { scale } = calculateTransformForFitMode(
          { width: comfyNode.width, height: comfyNode.height },
          { width: sceneNode.width, height: sceneNode.height },
          newTransformPartial.fitMode,
        );
        return {
          changes: {
            ...changes,
            transform: { ...oldTransform, ...newTransformPartial, scale, x: 0, y: 0 },
          },
          label,
        };
      }

      return {
        changes: {
          ...changes,
          transform: { ...oldTransform, ...newTransformPartial },
        },
        label,
      };
    }

    return { changes };
  },
};
