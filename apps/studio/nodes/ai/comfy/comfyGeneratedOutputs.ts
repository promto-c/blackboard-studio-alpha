import type { ComfyWorkflow, GeneratedOutput } from '@blackboard/types';
import { saveAsset } from '@/state/assetStorage';
import { readImageDimensions } from '@/state/editor/utils';
import { fetchComfyOutputFile, type ComfyOutputFile } from '@/services/comfy/client';
import { getMediaFileKind, isExrFileLike } from '@/utils/mediaFiles';
import { isNonEmptyString } from '@/utils/guards';
import { readVideoMetadata } from '@/utils/mediaUtils';
import {
  createScene3DAssetReference,
  getScene3DAssetFormat,
  inferScene3DAssetKind,
} from '@/nodes/builtin/scene_3d/scene3dModelAssets';

const DEFAULT_SEQUENCE_FPS = 30;

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
  signal,
}: {
  endpoint: string;
  files: ComfyOutputFile[];
  workflow: ComfyWorkflow | null;
  promptId: string;
  promptSummary?: string;
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
      const colorSpace = isExrFileLike(file, outputFile.filename) ? 'Linear' : 'sRGB';

      if (mediaKind === 'video') {
        const { width, height, duration } = await readVideoMetadata(file);
        return {
          file: outputFile,
          outputIndex,
          output: {
            id: getRecoveredOutputId({ promptId, file: outputFile, outputIndex }),
            src: assetId,
            mediaKind: 'video',
            width,
            height,
            duration,
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
          colorSpace,
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
