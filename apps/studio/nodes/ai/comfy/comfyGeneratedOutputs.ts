import type { ComfyWorkflow, GeneratedOutput } from '@blackboard/types';
import { saveAsset } from '@/state/assetStorage';
import { readImageDimensions } from '@/state/editor/utils';
import { fetchComfyOutputFile, type ComfyOutputFile } from '@/services/comfy/client';
import { getImportedImageColorManagement, getMediaFileKind } from '@/utils/mediaFiles';
import {
  colorManagementService,
  createPipelineMediaColorManagementOverride,
  createBrowserDecodedVideoColorManagement,
  getMediaSourceColorSpace,
  isDataColorSpace,
  isDataChannel,
  resolveMediaColorAssignmentPipeline,
} from '@/color-management';
import { isNonEmptyString } from '@/utils/guards';
import { readVideoMetadata } from '@/utils/mediaUtils';
import {
  createScene3DAssetReference,
  getScene3DAssetFormat,
  inferScene3DAssetKind,
} from '@/nodes/builtin/scene_3d/scene3dModelAssets';

const DEFAULT_SEQUENCE_FPS = 30;
const COMFY_COLOR_SPACE_INPUT_NAMES = [
  'output_color_space',
  'input_color_space',
  'ocio_color_space',
  'color_space',
  'colorspace',
] as const;
const COMFY_COLOR_SPACE_ROLE_ALIASES: Record<string, string> = {
  linear: 'scene_linear',
  scene_linear: 'scene_linear',
  srgb: 'texture_paint',
  data: 'data',
  raw: 'data',
};

const getPromptNodeInputs = (
  prompt: Record<string, unknown> | undefined,
  nodeId: string | undefined,
): Record<string, unknown> | null => {
  if (!prompt || !nodeId) return null;
  const node = prompt[nodeId];
  if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
  const inputs = (node as { inputs?: unknown }).inputs;
  return inputs && typeof inputs === 'object' && !Array.isArray(inputs)
    ? (inputs as Record<string, unknown>)
    : null;
};

const getComfyDeclaredColorSpace = (inputs: Record<string, unknown> | null): string | undefined => {
  if (!inputs) return undefined;
  for (const preferredName of COMFY_COLOR_SPACE_INPUT_NAMES) {
    const entry = Object.entries(inputs).find(([name]) => {
      const normalizedName = name
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_');
      return (
        normalizedName === preferredName ||
        normalizedName.endsWith(`.${preferredName}`) ||
        normalizedName.endsWith(`_${preferredName}`)
      );
    });
    if (typeof entry?.[1] === 'string' && entry[1].trim()) return entry[1].trim();
  }
  return undefined;
};

const resolveComfyColorSpace = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  try {
    return colorManagementService.resolveConfiguredColorSpaceName(value);
  } catch {
    const alias = COMFY_COLOR_SPACE_ROLE_ALIASES[value.trim().toLowerCase()];
    if (!alias) return undefined;
    try {
      return colorManagementService.resolveConfiguredColorSpaceName(alias);
    } catch {
      return undefined;
    }
  }
};

export const getComfyOutputColorSpace = ({
  outputFile,
  workflow,
  submittedPrompt,
}: {
  outputFile: ComfyOutputFile;
  workflow: ComfyWorkflow | null;
  submittedPrompt?: Record<string, unknown>;
}): string | undefined => {
  const submittedInputs = getPromptNodeInputs(submittedPrompt, outputFile.nodeId);
  const workflowInputs = getPromptNodeInputs(workflow?.prompt, outputFile.nodeId);
  return resolveComfyColorSpace(
    getComfyDeclaredColorSpace(submittedInputs) ?? getComfyDeclaredColorSpace(workflowInputs),
  );
};

const isTechnicalGeneratedOutput = (
  outputFile: ComfyOutputFile,
  label: string,
  outputName?: string,
  outputType?: string,
): boolean =>
  [label, outputFile.filename, outputName, outputType].some((value) => isDataChannel(value));

const getRecoveredOutputId = ({
  promptId,
  file,
  outputIndex,
  suffix,
}: {
  promptId: string;
  file: ComfyOutputFile;
  outputIndex: number;
  suffix?: string;
}): string => {
  const fileKey = [file.nodeId, file.filename, file.subfolder, file.type, suffix]
    .filter(isNonEmptyString)
    .join('_')
    .replace(/[^a-z0-9_-]+/gi, '_')
    .slice(0, 96);
  return `comfy_output_${promptId}_${fileKey || outputIndex}`;
};

export const createGeneratedOutputsFromComfyFiles = async ({
  endpoint,
  files,
  workflow,
  promptId,
  promptSummary,
  submittedPrompt,
  signal,
}: {
  endpoint: string;
  files: ComfyOutputFile[];
  workflow: ComfyWorkflow | null;
  promptId: string;
  promptSummary?: string;
  submittedPrompt?: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<GeneratedOutput[]> => {
  const createdAt = Date.now();
  const outputCandidateByPreviewId = new Map(
    (workflow?.outputCandidates ?? []).map((candidate) => [candidate.previewNodeId, candidate]),
  );

  const downloaded = await Promise.all(
    files.map(async (outputFile, outputIndex) => {
      const blob = await fetchComfyOutputFile({ endpoint, file: outputFile, signal });
      const file = new File([blob], outputFile.filename, { type: blob.type });
      const assetId = await saveAsset(file);
      const outputCandidate = outputFile.nodeId
        ? outputCandidateByPreviewId.get(outputFile.nodeId)
        : null;
      const label = outputCandidate
        ? `${outputCandidate.label} · ${outputFile.filename}`
        : outputFile.filename;
      const isTechnicalOutput = isTechnicalGeneratedOutput(
        outputFile,
        label,
        outputCandidate?.outputName,
        outputCandidate?.outputType,
      );

      if (outputFile.kind === '3d') {
        const format = getScene3DAssetFormat(file.name);
        if (!format) {
          throw new Error(`ComfyUI returned an unsupported 3D format: ${file.name}`);
        }
        const assetKind = await inferScene3DAssetKind(file, format);
        const scene3dAsset = createScene3DAssetReference(file, assetId, assetKind);
        if (!scene3dAsset) {
          throw new Error(`Could not create a 3D asset from ${file.name}.`);
        }
        return {
          file: outputFile,
          outputIndex,
          output: {
            id: getRecoveredOutputId({ promptId, file: outputFile, outputIndex }),
            src: assetId,
            mediaKind: 'model_3d',
            scene3dAsset,
            width: 0,
            height: 0,
            createdAt: createdAt + outputIndex,
            label,
            prompt: promptSummary,
            promptId,
            workflowId: workflow?.id,
            workflowName: workflow?.name,
          } satisfies GeneratedOutput,
        };
      }

      const detectedKind = getMediaFileKind(file, outputFile.filename);
      const mediaKind = outputFile.kind === 'video' ? 'video' : detectedKind;
      const fileColorManagement = isTechnicalOutput
        ? resolveMediaColorAssignmentPipeline({
            pipeline: {
              sourceColorSpace: colorManagementService.getRendererColorManagement().dataColorSpace,
              isData: true,
              detail: `Comfy output: ${label}`,
            },
          })
        : await getImportedImageColorManagement(file, outputFile.filename);
      const comfyOutputColorSpace = isTechnicalOutput
        ? undefined
        : getComfyOutputColorSpace({ outputFile, workflow, submittedPrompt });
      const mediaColorManagement = comfyOutputColorSpace
        ? createPipelineMediaColorManagementOverride(fileColorManagement, comfyOutputColorSpace, {
            isData: isDataColorSpace(
              colorManagementService.getSnapshot().colorSpaces,
              comfyOutputColorSpace,
            ),
          })
        : fileColorManagement;
      const colorSpace = getMediaSourceColorSpace(mediaColorManagement);

      if (mediaKind === 'video') {
        const { width, height, duration, color } = await readVideoMetadata(file);
        const videoColorManagement = isTechnicalOutput
          ? mediaColorManagement
          : createBrowserDecodedVideoColorManagement();
        return {
          file: outputFile,
          outputIndex,
          output: {
            id: getRecoveredOutputId({ promptId, file: outputFile, outputIndex }),
            src: assetId,
            mediaKind: 'video',
            colorSpace: getMediaSourceColorSpace(videoColorManagement),
            mediaColorManagement: videoColorManagement,
            width,
            height,
            duration,
            videoColorMetadata: color,
            createdAt: createdAt + outputIndex,
            label,
            prompt: promptSummary,
            promptId,
            workflowId: workflow?.id,
            workflowName: workflow?.name,
          } satisfies GeneratedOutput,
        };
      }

      const { width, height } = await readImageDimensions(file);
      return {
        file: outputFile,
        outputIndex,
        output: {
          id: getRecoveredOutputId({ promptId, file: outputFile, outputIndex }),
          src: assetId,
          mediaKind: 'image',
          ...(colorSpace ? { colorSpace } : {}),
          mediaColorManagement,
          width,
          height,
          createdAt: createdAt + outputIndex,
          label,
          prompt: promptSummary,
          promptId,
          workflowId: workflow?.id,
          workflowName: workflow?.name,
        } satisfies GeneratedOutput,
      };
    }),
  );

  const groupedFrames = new Map<string, typeof downloaded>();
  const passthroughOutputs: GeneratedOutput[] = [];

  for (const item of downloaded) {
    if (item.output.mediaKind !== 'image') {
      passthroughOutputs.push(item.output);
      continue;
    }

    const key = item.file.nodeId ?? `file-${item.outputIndex}`;
    groupedFrames.set(key, [...(groupedFrames.get(key) ?? []), item]);
  }

  for (const group of groupedFrames.values()) {
    if (group.length <= 1) {
      passthroughOutputs.push(group[0]!.output);
      continue;
    }

    const first = group[0]!;
    const frames = group.map((item) => item.output.src);
    passthroughOutputs.push({
      ...first.output,
      id: getRecoveredOutputId({
        promptId,
        file: first.file,
        outputIndex: first.outputIndex,
        suffix: 'sequence',
      }),
      mediaKind: 'image_sequence',
      src: frames[0] ?? first.output.src,
      frames,
      fps: DEFAULT_SEQUENCE_FPS,
      label: first.output.label?.replace(first.file.filename, `${group.length} frames`),
    });
  }

  return passthroughOutputs.sort((left, right) => left.createdAt - right.createdAt);
};
