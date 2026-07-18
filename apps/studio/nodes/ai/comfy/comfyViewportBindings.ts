import type {
  ComfyNode,
  ComfyViewportBindingField,
  ComfyWorkflow,
  ComfyWorkflowInputCandidate,
  ComfyWorkflowControlValue,
  ComfyWorkflowFieldTarget,
  FieldBinding,
  GeneratedOutput,
  SceneNode,
  ViewportPromptRegion,
  ViewportPromptRegionDefaults,
} from '@blackboard/types';
import { getSelectedComfyWorkflowInputCandidates } from './comfyInputs';
import {
  getComfyControlDescription,
  getComfyControlKey,
  getComfyWorkflowControlCandidates,
  isPromptLikeComfyTextInput,
  type ComfyWorkflowControlCandidate,
} from './comfyControls';
import { isJsonObject } from '@/utils/guards';
import { isComfyMaskWorkflowInput, normalizeComfyType } from '@/utils/comfyUtils';
import { collectComfyGraphExposedFields } from '@/services/comfy/client';
import { isDataChannel } from '@/color-management';

export const COMFY_CROP_VIEWPORT_TOOL = 'comfy_crop';

export type ComfyRunInputContext = 'props' | 'viewportTool';

export const COMFY_VIEWPORT_BINDING_FIELDS: ComfyViewportBindingField[] = [
  'width',
  'height',
  'x',
  'y',
  'prompt',
  'image',
  'mask',
];

export type ComfyRootBindingField = Extract<ComfyViewportBindingField, 'width' | 'height'>;

export const COMFY_ROOT_BINDING_FIELDS: ComfyRootBindingField[] = ['width', 'height'];

const COMFY_ROOT_BINDING_FIELD_SET = new Set<ComfyViewportBindingField>(COMFY_ROOT_BINDING_FIELDS);

export const comfyViewportBindingFieldLabels: Record<ComfyViewportBindingField, string> = {
  width: 'Width',
  height: 'Height',
  x: 'X',
  y: 'Y',
  prompt: 'Prompt',
  image: 'Image',
  mask: 'Mask',
};

export type ComfyViewportBindingSource = 'workflow' | 'workflowInput' | 'region';

export const getComfyViewportBindingSourceLabel = (
  source: ComfyViewportBindingSource,
  field?: ComfyViewportBindingField,
): string => {
  if (source === 'region' && field === 'prompt') return 'Region Prompt';
  if (source === 'region') return 'Region';
  if (source === 'workflowInput') return 'Input Port';
  return 'Props';
};

const getPromptNodeInputs = (
  workflow: ComfyWorkflow,
): Array<{
  nodeId: string;
  classType: string;
  inputName: string;
  value: unknown;
}> =>
  Object.entries(workflow.prompt).flatMap(([nodeId, promptNode]) => {
    if (!isJsonObject(promptNode) || typeof promptNode.class_type !== 'string') return [];
    const inputs = isJsonObject(promptNode.inputs) ? promptNode.inputs : {};
    return Object.entries(inputs).map(([inputName, value]) => ({
      nodeId,
      classType: promptNode.class_type as string,
      inputName,
      value,
    }));
  });

const targetFromPromptInput = (entry: {
  nodeId: string;
  classType: string;
  inputName: string;
}): ComfyWorkflowFieldTarget => ({
  kind: 'workflowField',
  nodeId: entry.nodeId,
  inputName: entry.inputName,
  classType: entry.classType,
  label: getComfyControlDescription(entry),
});

const isSameComfyBindingTarget = (
  left: ComfyWorkflowFieldTarget,
  right: ComfyWorkflowFieldTarget,
): boolean => {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'workflowInput' && right.kind === 'workflowInput') {
    if (left.inputCandidateId && right.inputCandidateId) {
      return left.inputCandidateId === right.inputCandidateId;
    }
  }
  return left.nodeId === right.nodeId && left.inputName === right.inputName;
};

const numericInputScore = (
  field: Extract<ComfyViewportBindingField, 'width' | 'height' | 'x' | 'y'>,
  entry: { classType: string; inputName: string; value: unknown },
): number => {
  if (typeof entry.value !== 'number') return -Infinity;

  const input = normalizeComfyType(entry.inputName);
  const classType = normalizeComfyType(entry.classType);
  let score = 0;

  if (field === 'width' || field === 'height') {
    if (input !== field && !input.endsWith(field)) return -Infinity;

    if (input === field) score += 8;
    else score += 4;
    if (classType.includes('emptylatentimage')) score += 5;
    if (classType.includes('latent') || classType.includes('image')) score += 2;
  }

  if (field === 'x') {
    if (input !== 'x' && input !== 'cropx' && !(input.includes('crop') && input.endsWith('x'))) {
      return -Infinity;
    }

    if (input === 'x' || input === 'cropx') score += 8;
    if (input.includes('crop') && input.endsWith('x')) score += 4;
    if (classType.includes('crop')) score += 5;
  }

  if (field === 'y') {
    if (input !== 'y' && input !== 'cropy' && !(input.includes('crop') && input.endsWith('y'))) {
      return -Infinity;
    }

    if (input === 'y' || input === 'cropy') score += 8;
    if (input.includes('crop') && input.endsWith('y')) score += 4;
    if (classType.includes('crop')) score += 5;
  }

  return score;
};

const isMaskWorkflowInputCandidate = (candidate: ComfyWorkflowInputCandidate): boolean =>
  isComfyMaskWorkflowInput(candidate) ||
  isDataChannel(candidate.inputName) ||
  isDataChannel(candidate.nodeType);

export const getComfyViewportBindingTargetOptions = (
  workflow: ComfyWorkflow | null | undefined,
  field: ComfyViewportBindingField,
): ComfyWorkflowFieldTarget[] => {
  if (!workflow) return [];

  if (field === 'image' || field === 'mask') {
    return getSelectedComfyWorkflowInputCandidates(workflow)
      .filter((candidate) => {
        const input = normalizeComfyType(candidate.inputName);
        const type = normalizeComfyType(candidate.nodeType);
        return field === 'mask'
          ? isMaskWorkflowInputCandidate(candidate)
          : input.includes('image') || input.includes('video') || type.includes('loadimage');
      })
      .map((candidate) => ({
        kind: 'workflowInput',
        nodeId: candidate.nodeId,
        inputName: candidate.inputName,
        classType: candidate.nodeType,
        inputCandidateId: candidate.id,
        label: candidate.label,
      }));
  }

  if (field === 'prompt') {
    const controlCandidates = getComfyWorkflowControlCandidates(workflow);
    const controlCandidatesByKey = new Map(
      controlCandidates.map((candidate) => [candidate.key, candidate]),
    );
    const exposedPromptTargets = collectComfyGraphExposedFields(workflow.sourceGraph)
      .filter((entry) =>
        isPromptLikeComfyTextInput({
          inputName: entry.inputName,
          label: entry.label,
          classType: entry.nodeType,
        }),
      )
      .flatMap((entry) => entry.promptTargets)
      .map((target) =>
        controlCandidatesByKey.get(getComfyControlKey(target.nodeId, target.inputName)),
      )
      .filter((candidate): candidate is ComfyWorkflowControlCandidate => candidate !== undefined)
      .map(targetFromPromptInput);

    if (exposedPromptTargets.length > 0) return exposedPromptTargets;

    return controlCandidates
      .filter((candidate) =>
        isPromptLikeComfyTextInput({
          inputName: candidate.inputName,
          label: candidate.label,
          classType: candidate.classType,
          description: candidate.description,
        }),
      )
      .map(targetFromPromptInput);
  }

  return getPromptNodeInputs(workflow)
    .map((entry) => ({ entry, score: numericInputScore(field, entry) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ entry }) => targetFromPromptInput(entry));
};

export const createComfyViewportFieldBinding = (
  workflow: ComfyWorkflow | null | undefined,
  field: ComfyViewportBindingField,
): FieldBinding => ({
  id: `comfy_viewport_binding_${field}`,
  field,
  target: getComfyViewportBindingTargetOptions(workflow, field)[0],
});

export const createComfyRootFieldBinding = (
  workflow: ComfyWorkflow | null | undefined,
  field: ComfyRootBindingField,
): FieldBinding => ({
  id: `comfy_root_binding_${field}`,
  field,
  target: getComfyViewportBindingTargetOptions(workflow, field)[0],
});

export const createComfyRootBindings = (
  workflow: ComfyWorkflow | null | undefined,
): FieldBinding[] =>
  COMFY_ROOT_BINDING_FIELDS.map((field) => createComfyRootFieldBinding(workflow, field));

export const createComfyViewportBindings = (
  workflow: ComfyWorkflow | null | undefined,
): FieldBinding[] =>
  COMFY_VIEWPORT_BINDING_FIELDS.map((field) => createComfyViewportFieldBinding(workflow, field));

const mergeComfyViewportBindingList = (
  workflow: ComfyWorkflow | null | undefined,
  bindings: FieldBinding[] | undefined,
): FieldBinding[] => {
  const existingByField = new Map((bindings ?? []).map((binding) => [binding.field, binding]));

  return COMFY_VIEWPORT_BINDING_FIELDS.map((field) => {
    const existing = existingByField.get(field);
    const fallback = createComfyViewportFieldBinding(workflow, field);
    const existingTarget = existing?.target;
    const target = existingTarget
      ? getComfyViewportBindingTargetOptions(workflow, field).some((candidate) =>
          isSameComfyBindingTarget(candidate, existingTarget),
        )
        ? existingTarget
        : fallback.target
      : existing
        ? undefined
        : fallback.target;
    return {
      id: existing?.id ?? fallback.id,
      field,
      target,
    };
  });
};

const mergeComfyRootBindingList = (bindings: FieldBinding[] | undefined): FieldBinding[] => {
  const existingByField = new Map((bindings ?? []).map((binding) => [binding.field, binding]));

  return COMFY_ROOT_BINDING_FIELDS.map((field) => {
    const existing = existingByField.get(field);
    const fallback = createComfyRootFieldBinding(null, field);
    return {
      id: existing?.id ?? fallback.id,
      field,
      target: existing?.target,
    };
  });
};

export const createComfyViewportPromptRegion = (
  workflow: ComfyWorkflow | null | undefined,
  rect: ViewportPromptRegion['rect'],
  defaults?: ViewportPromptRegionDefaults,
): ViewportPromptRegion => ({
  id: `viewport_region_${Date.now().toString(36)}`,
  rect,
  prompt: defaults?.prompt ?? '',
  bindings: mergeComfyViewportBindingList(workflow, defaults?.bindings),
  regionInputAlphaMode: defaults?.regionInputAlphaMode,
});

export const getSelectedComfyViewportPromptRegion = (
  node: ComfyNode,
): ViewportPromptRegion | null => {
  const regions = node.viewportPromptRegions ?? [];
  if (regions.length === 0) return null;
  return (
    regions.find((region) => region.id === node.selectedViewportPromptRegionId) ??
    regions.find((region) => region.visible !== false) ??
    regions[0] ??
    null
  );
};

export const getExplicitSelectedComfyViewportPromptRegion = (
  node: ComfyNode,
): ViewportPromptRegion | null => {
  const selectedRegionId = node.selectedViewportPromptRegionId;
  if (!selectedRegionId) return null;
  return (
    (node.viewportPromptRegions ?? []).find(
      (region) => region.id === selectedRegionId && region.visible !== false,
    ) ?? null
  );
};

export interface ComfyViewportPromptRegionDeleteUpdate {
  viewportPromptRegions: ViewportPromptRegion[];
  generatedOutputs: GeneratedOutput[];
  selectedViewportPromptRegionId: string | undefined;
  activeGeneratedOutputId: string | undefined;
}

export const createComfyViewportPromptRegionDeleteUpdate = (
  node: Pick<
    ComfyNode,
    | 'activeGeneratedOutputId'
    | 'generatedOutputs'
    | 'selectedViewportPromptRegionId'
    | 'viewportPromptRegions'
  >,
  regionIds: readonly string[],
): ComfyViewportPromptRegionDeleteUpdate | null => {
  const regionIdSet = new Set(regionIds);
  const regions = node.viewportPromptRegions ?? [];
  if (regions.every((region) => !regionIdSet.has(region.id))) {
    return null;
  }

  const outputs = node.generatedOutputs ?? [];
  const nextRegions = regions.filter((region) => !regionIdSet.has(region.id));
  const nextOutputs = outputs.filter(
    (output) => !output.regionId || !regionIdSet.has(output.regionId),
  );
  const activeOutputDeleted = outputs.some(
    (output) =>
      output.id === node.activeGeneratedOutputId &&
      Boolean(output.regionId && regionIdSet.has(output.regionId)),
  );

  return {
    viewportPromptRegions: nextRegions,
    generatedOutputs: nextOutputs,
    selectedViewportPromptRegionId: nextRegions[0]?.id,
    activeGeneratedOutputId: activeOutputDeleted ? undefined : node.activeGeneratedOutputId,
  };
};

export const getComfyViewportPromptRegionLabel = (
  regions: readonly ViewportPromptRegion[] | undefined,
  regionId: string | undefined,
): string => {
  const index = (regions ?? []).findIndex((region) => region.id === regionId);
  return `Region ${index >= 0 ? index + 1 : 1}`;
};

export const mergeComfyViewportBindings = (
  workflow: ComfyWorkflow | null | undefined,
  bindings: FieldBinding[] | undefined,
): FieldBinding[] => mergeComfyViewportBindingList(workflow, bindings);

export const mergeComfyRootBindings = (bindings: FieldBinding[] | undefined): FieldBinding[] =>
  mergeComfyRootBindingList(bindings);

export const resolveComfyViewportBindingSource = (
  binding: Pick<FieldBinding, 'field'>,
  options: { inputContext?: ComfyRunInputContext } = {},
): ComfyViewportBindingSource => {
  if (binding.field === 'image' || binding.field === 'mask') return 'workflowInput';
  return (options.inputContext ?? 'viewportTool') === 'viewportTool' ? 'region' : 'workflow';
};

export const getComfyViewportBindingValue = (
  binding: FieldBinding,
  region: ViewportPromptRegion,
  options: { inputContext?: ComfyRunInputContext } = {},
): ComfyWorkflowControlValue | undefined => {
  if (resolveComfyViewportBindingSource(binding, options) !== 'region') return undefined;

  if (binding.field === 'prompt') return region.prompt;

  if (binding.field === 'x') return Math.round(region.rect.x);
  if (binding.field === 'y') return Math.round(region.rect.y);
  if (binding.field === 'width') return Math.round(region.rect.width);
  if (binding.field === 'height') return Math.round(region.rect.height);

  return undefined;
};

const getComfyRootBindingSize = (
  node: Pick<ComfyNode, 'width' | 'height'>,
  sceneNode: Pick<SceneNode, 'width' | 'height'> | null | undefined,
): { width: number; height: number; sourceLabel: string } | null => {
  if (
    sceneNode &&
    Number.isFinite(sceneNode.width) &&
    Number.isFinite(sceneNode.height) &&
    sceneNode.width > 0 &&
    sceneNode.height > 0
  ) {
    return {
      width: Math.round(sceneNode.width),
      height: Math.round(sceneNode.height),
      sourceLabel: 'Scene',
    };
  }

  if (
    Number.isFinite(node.width) &&
    Number.isFinite(node.height) &&
    node.width > 0 &&
    node.height > 0
  ) {
    return {
      width: Math.round(node.width),
      height: Math.round(node.height),
      sourceLabel: 'Output',
    };
  }

  return null;
};

export const getComfyRootBindingValue = (
  binding: FieldBinding,
  node: Pick<ComfyNode, 'width' | 'height'>,
  sceneNode: Pick<SceneNode, 'width' | 'height'> | null | undefined,
): ComfyWorkflowControlValue | undefined => {
  if (!COMFY_ROOT_BINDING_FIELD_SET.has(binding.field)) return undefined;
  const size = getComfyRootBindingSize(node, sceneNode);
  if (!size) return undefined;
  return size[binding.field as ComfyRootBindingField];
};

export const getComfyRootBindingSourceLabel = (
  node: Pick<ComfyNode, 'width' | 'height'>,
  sceneNode: Pick<SceneNode, 'width' | 'height'> | null | undefined,
): string => getComfyRootBindingSize(node, sceneNode)?.sourceLabel ?? 'Size';

export const getComfyViewportControlSourceSummaries = (
  node: ComfyNode,
  workflow: ComfyWorkflow | null | undefined,
  options: { inputContext?: ComfyRunInputContext } = {},
): Record<string, { label: string; value?: ComfyWorkflowControlValue }> => {
  const region = getSelectedComfyViewportPromptRegion(node);
  if (!region || !workflow) return {};

  const bindings = mergeComfyViewportBindings(workflow, region.bindings);
  const summaries: Record<string, { label: string; value?: ComfyWorkflowControlValue }> = {};

  for (const binding of bindings) {
    if (!binding.target?.nodeId || !binding.target.inputName) continue;
    const source = resolveComfyViewportBindingSource(binding, options);
    if (source !== 'region') continue;

    const key = getComfyControlKey(binding.target.nodeId, binding.target.inputName);
    summaries[key] = {
      label: getComfyViewportBindingSourceLabel(source, binding.field),
      value: getComfyViewportBindingValue(binding, region, options),
    };
  }

  return summaries;
};

export const getComfyRootControlSourceSummaries = (
  node: ComfyNode,
  workflow: ComfyWorkflow | null | undefined,
  sceneNode: Pick<SceneNode, 'width' | 'height'> | null | undefined,
): Record<string, { label: string; value?: ComfyWorkflowControlValue }> => {
  if (!workflow) return {};

  const bindings = mergeComfyRootBindings(node.rootBindings);
  const summaries: Record<string, { label: string; value?: ComfyWorkflowControlValue }> = {};
  const sourceLabel = getComfyRootBindingSourceLabel(node, sceneNode);

  for (const binding of bindings) {
    if (!binding.target?.nodeId || !binding.target.inputName) continue;

    const value = getComfyRootBindingValue(binding, node, sceneNode);
    if (value === undefined) continue;

    const key = getComfyControlKey(binding.target.nodeId, binding.target.inputName);
    summaries[key] = {
      label: sourceLabel,
      value,
    };
  }

  return summaries;
};

const matchesWorkflowInputTarget = (
  target: ComfyWorkflowFieldTarget | undefined,
  candidate: ComfyWorkflowInputCandidate,
): boolean => {
  if (target?.kind !== 'workflowInput') return false;
  if (target.inputCandidateId && target.inputCandidateId === candidate.id) return true;
  return target.nodeId === candidate.nodeId && target.inputName === candidate.inputName;
};

export const shouldUseComfyWorkflowInputSource = ({
  node,
  workflow,
  candidate,
  inputContext,
  regionId,
}: {
  node: ComfyNode;
  workflow: ComfyWorkflow;
  candidate: ComfyWorkflowInputCandidate;
  inputContext: ComfyRunInputContext;
  regionId?: string;
}): boolean => {
  const region = regionId
    ? ((node.viewportPromptRegions ?? []).find((candidate) => candidate.id === regionId) ?? null)
    : getSelectedComfyViewportPromptRegion(node);
  if (!region) return true;

  const matchingBindings = mergeComfyViewportBindings(workflow, region.bindings).filter((binding) =>
    matchesWorkflowInputTarget(binding.target, candidate),
  );
  if (matchingBindings.length === 0) return true;

  return matchingBindings.some(
    (binding) => resolveComfyViewportBindingSource(binding, { inputContext }) === 'workflowInput',
  );
};

const clonePrompt = (prompt: Record<string, unknown>): Record<string, unknown> =>
  JSON.parse(JSON.stringify(prompt)) as Record<string, unknown>;

export const applyComfyRootBindings = (
  prompt: Record<string, unknown>,
  node: ComfyNode,
  sceneNode: Pick<SceneNode, 'width' | 'height'> | null | undefined,
  workflow?: ComfyWorkflow | null,
): Record<string, unknown> => {
  const nextPrompt = clonePrompt(prompt);
  const bindings =
    node.rootBindings && node.rootBindings.length > 0
      ? mergeComfyRootBindings(node.rootBindings)
      : createComfyRootBindings(workflow);

  for (const binding of bindings) {
    if (!binding.target?.nodeId || !binding.target.inputName) continue;

    const value = getComfyRootBindingValue(binding, node, sceneNode);
    if (value === undefined) continue;

    const promptNode = nextPrompt[binding.target.nodeId];
    if (!isJsonObject(promptNode)) continue;

    const inputs = isJsonObject(promptNode.inputs) ? promptNode.inputs : {};
    promptNode.inputs = inputs;
    inputs[binding.target.inputName] = value;
  }

  return nextPrompt;
};

export const applyComfyViewportPromptRegionBindings = (
  prompt: Record<string, unknown>,
  node: ComfyNode,
  workflow: ComfyWorkflow,
  options: { inputContext?: ComfyRunInputContext; regionId?: string } = {},
): Record<string, unknown> => {
  const region =
    (options.inputContext ?? 'viewportTool') === 'viewportTool'
      ? options.regionId
        ? ((node.viewportPromptRegions ?? []).find(
            (candidate) => candidate.id === options.regionId && candidate.visible !== false,
          ) ?? null)
        : getExplicitSelectedComfyViewportPromptRegion(node)
      : getSelectedComfyViewportPromptRegion(node);
  if (!region) return prompt;

  const nextPrompt = clonePrompt(prompt);
  const bindings = mergeComfyViewportBindings(workflow, region.bindings);

  for (const binding of bindings) {
    if (resolveComfyViewportBindingSource(binding, options) !== 'region') continue;
    if (!binding.target?.nodeId || !binding.target.inputName) continue;

    const value = getComfyViewportBindingValue(binding, region, options);
    if (value === undefined) continue;

    const promptNode = nextPrompt[binding.target.nodeId];
    if (!isJsonObject(promptNode)) continue;

    const inputs = isJsonObject(promptNode.inputs) ? promptNode.inputs : {};
    promptNode.inputs = inputs;
    inputs[binding.target.inputName] = value;
  }

  return nextPrompt;
};
