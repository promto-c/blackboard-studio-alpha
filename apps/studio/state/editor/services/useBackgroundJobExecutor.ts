import { useSyncComfyBackgroundJobs } from '@/nodes/ai/comfy/useSyncComfyBackgroundJobs';
import { useEffect, useMemo, useRef } from 'react';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import { useInstalledOnnxModels } from '@/state/installedOnnxModelsContext';
import { usePreferences } from '@/state/preferencesContext';
import {
  downloadAndCacheOnnxModel,
  getOnnxDownloadUrl,
  updateInstalledOnnxModel,
  type DownloadProgress,
} from '@/services/onnx/modelCache';
import {
  loadOnnxModelMetadata,
  loadOnnxModelOutputMetadataCached,
} from '@/services/onnx/onnxMetadataCache';
import { getOnnxRuntimeCompatibility } from '@/services/onnx/onnxRuntime';
import { isBackgroundJobActive, type BackgroundJob } from './backgroundJobs';
import {
  defaultBackgroundJobExecutor,
  type BackgroundJobRunContext,
} from './backgroundJobExecutor';
import type {
  ModelCatalogReference,
  OnnxBackend,
  OnnxModelVariantMetadata,
} from '@blackboard/types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readOnnxVariantPayload = (payload: unknown): OnnxModelVariantMetadata | null => {
  if (!isRecord(payload) || !isRecord(payload.variant)) return null;
  const variant = payload.variant;
  return typeof variant.id === 'string' &&
    typeof variant.repoName === 'string' &&
    typeof variant.filePath === 'string' &&
    typeof variant.label === 'string'
    ? (variant as unknown as OnnxModelVariantMetadata)
    : null;
};

const readCatalogReferencePayload = (payload: unknown): ModelCatalogReference | undefined => {
  if (!isRecord(payload) || !isRecord(payload.catalogRef)) return undefined;
  const catalogRef = payload.catalogRef;
  return typeof catalogRef.modelId === 'string' &&
    typeof catalogRef.modelName === 'string' &&
    typeof catalogRef.origin === 'string' &&
    typeof catalogRef.runtime === 'string'
    ? (catalogRef as unknown as ModelCatalogReference)
    : undefined;
};

const reportOnnxDownloadProgress = (
  job: BackgroundJobRunContext,
  progress: DownloadProgress,
  currentFileRef: { current: NonNullable<BackgroundJob['progressState']>['currentFile'] | null },
) => {
  if (progress.currentFile) {
    currentFileRef.current = {
      name: progress.currentFile,
      loaded: progress.currentFileLoaded ?? 0,
      size: progress.currentFileSize,
      index: progress.fileIndex,
      count: progress.fileCount,
    };
  } else if (currentFileRef.current && progress.currentFileLoaded !== undefined) {
    currentFileRef.current = {
      ...currentFileRef.current,
      loaded: progress.currentFileLoaded,
    };
  }

  job.progress({
    label: currentFileRef.current
      ? `Downloading ${currentFileRef.current.name}`
      : 'Downloading ONNX model',
    loaded: progress.loaded,
    total: progress.total,
    percent: progress.percent,
    ...(currentFileRef.current ? { currentFile: currentFileRef.current } : {}),
  });
};

const refreshOnnxModelMetadata = async (
  model: Awaited<ReturnType<typeof downloadAndCacheOnnxModel>>,
  backend: OnnxBackend,
) => {
  try {
    const [inputMeta, outputMeta] = await Promise.all([
      loadOnnxModelMetadata(model, backend),
      loadOnnxModelOutputMetadataCached(model, backend),
    ]);
    if (inputMeta.length > 0) {
      model.variant.inputShape = inputMeta[0].dims;
      model.variant.inputMetadata = inputMeta;
      model.variant.outputMetadata = outputMeta;
      await updateInstalledOnnxModel(model);
    }
  } catch {
    // metadata detection is best-effort
  }
};

export const useBackgroundJobExecutor = () => {
  useSyncComfyBackgroundJobs();
  const backgroundJobs = useEditorSelector((state) => state.backgroundJobs);
  const { updateBackgroundJob, finishBackgroundJob } = useEditorActions();
  const { refresh: refreshInstalledModels } = useInstalledOnnxModels();
  const { onnxRuntimeWebGpuEnabled, onnxRuntimeWasmEnabled } = usePreferences();
  const runningRestartJobIdsRef = useRef<Set<string>>(new Set());

  const effectiveBackend = useMemo((): OnnxBackend => {
    const compatibility = getOnnxRuntimeCompatibility({
      webgpuEnabled: onnxRuntimeWebGpuEnabled,
      wasmEnabled: onnxRuntimeWasmEnabled,
    });
    return compatibility.webgpu ? 'webgpu' : 'wasm';
  }, [onnxRuntimeWasmEnabled, onnxRuntimeWebGpuEnabled]);

  const restartableOnnxJobs = useMemo(
    () =>
      backgroundJobs
        .filter(
          (job) =>
            job.type === 'onnx-download' &&
            isBackgroundJobActive(job) &&
            job.source?.restoredFromStorage,
        )
        .map((job) => ({
          job,
          variant: readOnnxVariantPayload(job.payload),
          catalogRef: readCatalogReferencePayload(job.payload),
        }))
        .filter(
          (
            entry,
          ): entry is {
            job: BackgroundJob;
            variant: OnnxModelVariantMetadata;
            catalogRef: ModelCatalogReference | undefined;
          } => Boolean(entry.variant),
        ),
    [backgroundJobs],
  );

  useEffect(() => {
    restartableOnnxJobs.forEach(({ job, variant, catalogRef }) => {
      if (runningRestartJobIdsRef.current.has(job.id)) return;
      runningRestartJobIdsRef.current.add(job.id);
      const fileName = variant.filePath.split('/').pop() ?? variant.filePath;

      void defaultBackgroundJobExecutor
        .run(
          job,
          {
            update: updateBackgroundJob,
            finish: finishBackgroundJob,
          },
          async (run) => {
            const currentFileRef: {
              current: NonNullable<BackgroundJob['progressState']>['currentFile'] | null;
            } = { current: null };
            const model = await downloadAndCacheOnnxModel({
              variant,
              catalogRef,
              signal: run.signal,
              onProgress: (progress) => reportOnnxDownloadProgress(run, progress, currentFileRef),
            });

            run.update({
              detail: 'Reading model metadata',
              progress: 98,
              indeterminate: true,
              source: {
                modelId: model.id,
                repoName: model.repoName,
                variantId: model.variant.id,
                url: getOnnxDownloadUrl(model.variant),
                filename: fileName,
              },
            });
            await refreshOnnxModelMetadata(model, effectiveBackend);
            await refreshInstalledModels();
            return {
              status: 'complete',
              detail: `${model.name} installed`,
              progress: 100,
              source: {
                modelId: model.id,
                repoName: model.repoName,
                variantId: model.variant.id,
                url: getOnnxDownloadUrl(model.variant),
                filename: fileName,
              },
            };
          },
        )
        .finally(() => {
          runningRestartJobIdsRef.current.delete(job.id);
        });
    });
  }, [
    effectiveBackend,
    finishBackgroundJob,
    refreshInstalledModels,
    restartableOnnxJobs,
    updateBackgroundJob,
  ]);
};
