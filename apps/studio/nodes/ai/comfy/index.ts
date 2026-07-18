import { BlendMode, ComfyNode, ComfyWorkflow, ImageFitMode, NodeType } from '@blackboard/types';
import { NodeDefinition } from '../../NodeDefinition';
import { mediaTransformAnimation } from '../../animationHelpers';
import { ComfyAdjustmentsPanel } from './ComfyAdjustments';
import { ComfyTool } from './ComfyTool';
import * as Icons from '@blackboard/icons';
import ComfyViewportToolPanel from './ComfyViewportToolPanel';
import { ComfyCropSvgOverlay, ComfyCropPromptOverlay } from './ComfyCropOverlay';
import ComfyItemsPanel from './ComfyItemsPanel';
import {
  getComfyWorkflowInputPortPresentation,
  getSelectedComfyWorkflowInputCandidates,
} from './comfyInputs';
import { getComfyInputPortName } from '../../portMapping';
import {
  getComfyCompositeLayers,
  getComfyGeneratedOutputTextureKey,
  getVisibleComfyGeneratedOutputs,
  isComfyGeneratedOutputVisible,
} from './comfyOutputLayers';
import { createSourceTransformUpdate, sourceMediaNodeFlags } from '../../sourceNodeBehavior';
import { isComfy3DGeneratedOutput } from './comfyOutputActivation';
import {
  ColorManagementDefaults,
  createProjectDefaultMediaColorManagement,
  getMediaSourceColorSpace,
  isDataMediaColorManagement,
} from '@/color-management';
import { DEFAULT_COMFY_ALIGNMENT_OPTIONS } from './comfyAlignmentOptions';

const getComfyNodeAssetIds = (node: ComfyNode): string[] =>
  Array.from(
    new Set([
      node.src,
      ...(node.frames ?? []),
      ...(node.generatedOutputs ?? []).map((output) => output.src),
      ...(node.generatedOutputs ?? []).flatMap((output) => output.frames ?? []),
      ...(node.generatedOutputs ?? []).map(
        (output) => output.differenceMask?.referenceAssetId ?? '',
      ),
      ...Object.values(node.workflowInputImages ?? {}).map((inputImage) => inputImage.assetId),
    ]),
  ).filter((src): src is string => Boolean(src));

const getActiveGeneratedOutput = (node: ComfyNode) =>
  (node.generatedOutputs ?? []).find(
    (output) =>
      !isComfy3DGeneratedOutput(output) &&
      isComfyGeneratedOutputVisible(node, output) &&
      (node.activeGeneratedOutputId
        ? output.id === node.activeGeneratedOutputId
        : output.src === node.src),
  );

const getComfyMediaKind = (node: ComfyNode): 'image' | 'image_sequence' | 'video' => {
  const activeOutput = getActiveGeneratedOutput(node);
  const outputMediaKind = activeOutput?.mediaKind;
  return (
    (outputMediaKind === 'model_3d' ? undefined : outputMediaKind) ??
    node.mediaKind ??
    (node.frames?.length ? 'image_sequence' : 'image')
  );
};

const getComfyFrameAsset = (node: ComfyNode, frame: number): string => {
  const frames = getActiveGeneratedOutput(node)?.frames ?? node.frames ?? [];
  if (frames.length === 0) return node.src || '';
  const index = Math.floor(frame);
  const safeIndex = ((index % frames.length) + frames.length) % frames.length;
  return frames[safeIndex] ?? node.src ?? '';
};

const getSelectedWorkflowOutputIds = (workflow: ComfyWorkflow): string[] => {
  const candidateIds = new Set((workflow.outputCandidates ?? []).map((candidate) => candidate.id));
  if (workflow.selectedOutputIds) {
    return workflow.selectedOutputIds.filter((id) => candidateIds.has(id));
  }
  const firstCandidate = workflow.outputCandidates?.[0];
  return firstCandidate ? [firstCandidate.id] : [];
};

const canRunComfyNode = (node: ComfyNode): boolean => {
  const selectedWorkflow =
    node.workflows.find((workflow) => workflow.id === node.selectedWorkflowId) ?? null;
  if (!selectedWorkflow) return false;

  const outputCandidates = selectedWorkflow.outputCandidates ?? [];
  if (selectedWorkflow.sourceGraph && outputCandidates.length === 0) return false;

  return outputCandidates.length === 0 || getSelectedWorkflowOutputIds(selectedWorkflow).length > 0;
};

export const comfyNode: NodeDefinition = {
  type: NodeType.COMFY,
  name: 'Comfy',
  category: 'Image',
  renderMode: 'media',
  processingDomain: 'scene_linear',
  description: 'Run ComfyUI workflows and bring image, video, mesh, or splat outputs into Studio.',
  IconComponent: Icons.ComputerDesktop,
  ToolComponent: ComfyTool,
  AdjustmentComponent: ComfyAdjustmentsPanel,
  ItemsComponent: ComfyItemsPanel,
  viewportTools: [
    { id: 'select', label: 'Select Tool', icon: Icons.CursorArrow, hotkey: 'Q' },
    { kind: 'separator' },
    {
      id: 'comfy_crop',
      label: 'Crop Region',
      icon: Icons.Rectangle,
      hotkey: 'R',
      panelId: 'binding',
    },
  ],
  ViewportToolPanelComponent: ComfyViewportToolPanel,
  defaultViewportTool: 'select',
  getOverlayVisibility: (_node, ctx) => {
    if (ctx.viewport.showOverlays) return { forceShowSvg: false };
    return {
      forceShowSvg:
        ctx.viewport.activeViewportTool === 'select' ||
        ctx.viewport.activeViewportTool === 'comfy_crop',
    };
  },
  animation: mediaTransformAnimation,
  flags: {
    ...sourceMediaNodeFlags,
  },
  nodeExecution: {
    label: 'Run',
    canExecute: (node) => canRunComfyNode(node as ComfyNode),
  },
  getInitialNodeProps: (): Omit<ComfyNode, 'id' | 'name' | 'enabled' | 'type'> => ({
    workflows: [],
    selectedWorkflowId: undefined,
    workflowControls: [],
    workflowInputImages: {},
    viewportPromptRegions: [],
    viewportPromptRegionDefaults: { prompt: '', bindings: [] },
    rootBindings: [],
    selectedViewportPromptRegionId: undefined,
    generatedOutputs: [],
    activeGeneratedOutputId: undefined,
    src: '',
    width: 0,
    height: 0,
    opacity: 100,
    operator: BlendMode.OVER,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.FIT },
    colorSpace: ColorManagementDefaults.TEXTURE_SPACE,
    mediaColorManagement: createProjectDefaultMediaColorManagement(),
    useOutputSizeAsScene: false,
    hiddenInputPortIds: [],
    autoAlignOutputs: true,
    alignmentOptions: { ...DEFAULT_COMFY_ALIGNMENT_OPTIONS },
    lastPromptId: undefined,
    lastRunAt: undefined,
    lastError: undefined,
  }),
  inputPorts: (node) => {
    const comfyNode = node as ComfyNode;
    const workflow =
      comfyNode.workflows.find((candidate) => candidate.id === comfyNode.selectedWorkflowId) ??
      comfyNode.workflows[0];

    if (!workflow) {
      // Show ports for any existing input connections (e.g., from auto-connection).
      // If no inputs exist, return empty — the node appears clean until either
      // a workflow is selected or something is manually connected.
      const inputKeys = comfyNode.inputs
        ? Object.keys(comfyNode.inputs).filter((k) => k !== 'pipe')
        : [];
      if (inputKeys.length === 0) return [];
      return inputKeys.map((portName) => ({
        name: portName,
        label: portName.charAt(0).toUpperCase() + portName.slice(1),
        type: 'texture' as const,
        required: false,
        description: `Connected input — select a workflow to configure named inputs.`,
      }));
    }

    const inputCandidates = getSelectedComfyWorkflowInputCandidates(workflow);
    return inputCandidates.map((candidate) => {
      return {
        name: getComfyInputPortName(workflow.id, candidate, Object.keys(comfyNode.inputs ?? {}), {
          allowSingleReservedPort: inputCandidates.length === 1,
        }),
        ...getComfyWorkflowInputPortPresentation(candidate),
        required: false,
        description: `${candidate.nodeType} #${candidate.nodeId} · ${candidate.inputName}${
          candidate.inputType ? ` (${candidate.inputType})` : ''
        }`,
      };
    });
  },
  toolHotkeys: {
    q: 'select',
    r: 'comfy_crop',
  },
  mediaDescriptor: {
    getAssetIds: (node) => {
      return getComfyNodeAssetIds(node as ComfyNode);
    },
    checkFrameReady: (node, frame, caches) => {
      const comfyNode = node as ComfyNode;
      const hiddenPortIds = new Set(comfyNode.hiddenInputPortIds ?? []);
      const visibleInputImages = Object.entries(comfyNode.workflowInputImages ?? {}).filter(
        ([portName]) => !hiddenPortIds.has(portName),
      );
      if (!visibleInputImages.every(([, img]) => caches.imageCache.has(img.assetId))) {
        return false;
      }

      const hasGeneratedOutputs = (comfyNode.generatedOutputs ?? []).some(
        (output) => !output.deletedAt,
      );
      const visibleOutputs = getVisibleComfyGeneratedOutputs(comfyNode);
      if (visibleOutputs.length > 0) {
        return visibleOutputs.every((output) => {
          if (
            output.differenceMask?.enabled &&
            !caches.imageCache.has(output.differenceMask.referenceAssetId)
          ) {
            return false;
          }
          const texture = getComfyGeneratedOutputTextureKey(output, frame);
          if (!texture) return true;
          if (texture.isVideoFile) {
            if (caches.imageCache.has(texture.textureKey)) return true;
            const entry = caches.videoElements.get(texture.assetId);
            if (!entry) return false;
            if (entry.seeking || entry.readyState < 2) return false;
            return true;
          }
          return caches.imageCache.has(texture.textureKey);
        });
      }
      if (hasGeneratedOutputs) return true;

      const src = comfyNode.src;
      if (!src) return true;
      const mediaKind = getComfyMediaKind(comfyNode);
      if (mediaKind === 'video') {
        const frameKey = `${src}:${Math.round(frame)}`;
        if (caches.imageCache.has(frameKey)) return true;
        const entry = caches.videoElements.get(src);
        if (!entry) return false;
        if (entry.seeking || entry.readyState < 2) return false;
        return true;
      }
      if (mediaKind === 'image_sequence') {
        const frameAsset = getComfyFrameAsset(comfyNode, frame);
        return !frameAsset || caches.imageCache.has(frameAsset);
      }
      return caches.imageCache.has(src);
    },
    getMediaTextureKey: (node, frame) => {
      const comfyNode = node as ComfyNode;
      const hasGeneratedOutputs = (comfyNode.generatedOutputs ?? []).some(
        (output) => !output.deletedAt,
      );
      const activeOutput = getActiveGeneratedOutput(comfyNode);
      if (activeOutput) {
        if (activeOutput.mediaKind === 'video') {
          return activeOutput.src ? `${activeOutput.src}:${Math.round(frame)}` : '';
        }
        if (activeOutput.mediaKind === 'image_sequence') {
          const frames = activeOutput.frames ?? [];
          if (frames.length === 0) return activeOutput.src || '';
          const index = Math.floor(frame);
          const safeIndex = ((index % frames.length) + frames.length) % frames.length;
          return frames[safeIndex] ?? activeOutput.src ?? '';
        }
        return activeOutput.src || '';
      }
      if (hasGeneratedOutputs) return '';
      if (getComfyMediaKind(comfyNode) === 'video') {
        return comfyNode.src ? `${comfyNode.src}:${Math.round(frame)}` : '';
      }
      if (getComfyMediaKind(comfyNode) === 'image_sequence') {
        return getComfyFrameAsset(comfyNode, frame);
      }
      return comfyNode.src || '';
    },
    isVideoFile: (node) => getComfyMediaKind(node as ComfyNode) === 'video',
    getColorSpace: (node) => {
      const comfyNode = node as ComfyNode;
      const activeOutput = getActiveGeneratedOutput(comfyNode);
      return (
        getMediaSourceColorSpace(activeOutput?.mediaColorManagement) ??
        activeOutput?.colorSpace ??
        getMediaSourceColorSpace(comfyNode.mediaColorManagement) ??
        comfyNode.colorSpace
      );
    },
    isData: (node) => {
      const comfyNode = node as ComfyNode;
      const activeOutput = getActiveGeneratedOutput(comfyNode);
      return (
        isDataMediaColorManagement(activeOutput?.mediaColorManagement) ||
        (!activeOutput && isDataMediaColorManagement(comfyNode.mediaColorManagement))
      );
    },
    getCompositeLayers: (node, frame, context) =>
      getComfyCompositeLayers(node as ComfyNode, frame, context.sceneNode, context.nodes),
  },
  ViewportOverlayDirectComponent: ComfyCropSvgOverlay,
  ViewportHtmlOverlayComponent: ComfyCropPromptOverlay,
  onNodeUpdate: (node, changes, context) => {
    return createSourceTransformUpdate(node as ComfyNode, changes, context) ?? { changes };
  },
};
