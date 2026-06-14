import React, { useCallback, useMemo, useState } from 'react';
import * as Icons from '@blackboard/icons';
import { useEditorSelector, useOptionalEditorActions } from '@/state/editorContext';
import { usePreferences } from '@/state/preferencesContext';
import { useInstalledOnnxModels } from '@/state/installedOnnxModelsContext';

import {
  NodeType,
  type InstalledOnnxModel,
  type OnnxBackend,
  type OnnxInputMetadata,
  type OnnxModelVariantMetadata,
  type OnnxOutputMetadata,
} from '@blackboard/types';
import {
  fetchHuggingFaceOnnxRepoFiles,
  GENERIC_ONNX_RECIPE,
  getVariantRequiredFiles,
  getVariantTotalSize,
  normalizeHuggingFaceRepoName,
  resolveOnnxVariantsFromRepoFiles,
  searchHuggingFaceOnnxModels,
  selectDefaultOnnxVariant,
} from '@/services/onnx/modelRegistry';
import {
  deleteInstalledOnnxModel,
  downloadAndCacheOnnxModel,
  type DownloadProgress,
  getOnnxDownloadUrl,
  updateInstalledOnnxModel,
} from '@/services/onnx/modelCache';
import {
  isBackgroundJobActive,
  type BackgroundJob,
  type BackgroundJobInput,
  type BackgroundJobUpdate,
} from '@/state/editor/services/backgroundJobs';
import type { BackgroundJobRunContext } from '@/state/editor/services/backgroundJobExecutor';
import {
  getCachedOnnxModelInputMetadata,
  loadOnnxModelMetadata,
  loadOnnxModelMetadataCached,
  loadOnnxModelOutputMetadataCached,
} from '@/services/onnx/onnxMetadataCache';
import { getOnnxRuntimeCompatibility } from '@/services/onnx/onnxRuntime';

type BrowseState = 'idle' | 'loading' | 'ready' | 'error';

const DEFAULT_ONNX_REPO = 'onnx-community/depth-anything-v2-small';

const formatBytes = (bytes?: number): string => {
  if (!bytes) return 'Unknown size';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

function StatusBadge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'accent';
}) {
  const toneClassName =
    tone === 'success'
      ? 'border-green-400/20 bg-green-500/10 text-green-100'
      : tone === 'warning'
        ? 'border-amber-400/20 bg-amber-500/10 text-amber-100'
        : tone === 'danger'
          ? 'border-red-400/20 bg-red-500/10 text-red-100'
          : tone === 'accent'
            ? 'border-primary-400/20 bg-primary-500/10 text-primary-100'
            : 'border-white/10 bg-white/[0.05] text-gray-300';

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${toneClassName}`}
    >
      {children}
    </span>
  );
}

const baseFieldClassName =
  'block w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-gray-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] outline-none transition placeholder:text-gray-500 focus:border-primary-400/40 focus:ring-2 focus:ring-primary-500/20';

function OnnxModelsPreferences() {
  const editorActions = useOptionalEditorActions() as {
    addNodeWithProps?: (
      nodeType: string,
      props: Record<string, unknown>,
      options?: { name?: string },
    ) => void;
    runBackgroundJob?: (
      input: BackgroundJobInput,
      runner: (context: BackgroundJobRunContext) => Promise<BackgroundJobUpdate | void>,
    ) => string;
    requestBackgroundJobCancel?: (jobId: string) => void;
  } | null;
  const { onnxRuntimeWebGpuEnabled, onnxRuntimeWasmEnabled, setPreferences } = usePreferences();
  const [repoNameDraft, setRepoNameDraft] = useState(DEFAULT_ONNX_REPO);
  const [searchDraft, setSearchDraft] = useState('depth anything');
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [variants, setVariants] = useState<OnnxModelVariantMetadata[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const { models: installedModels, refresh: refreshInstalledModels } = useInstalledOnnxModels();
  const backgroundJobs = useEditorSelector((state) => state.backgroundJobs);
  const [browseState, setBrowseState] = useState<BrowseState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [downloadJobId, setDownloadJobId] = useState<string | null>(null);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);

  interface PerModelMetadata {
    loading: boolean;
    error: string | null;
    inputs: OnnxInputMetadata[] | null;
    outputs: OnnxOutputMetadata[] | null;
  }

  const compatibility = useMemo(
    () =>
      getOnnxRuntimeCompatibility({
        webgpuEnabled: onnxRuntimeWebGpuEnabled,
        wasmEnabled: onnxRuntimeWasmEnabled,
      }),
    [onnxRuntimeWasmEnabled, onnxRuntimeWebGpuEnabled],
  );

  const effectiveBackend = useMemo(
    (): OnnxBackend => (compatibility.webgpu ? 'webgpu' : 'wasm'),
    [compatibility.webgpu],
  );

  const [modelsMetadata, setModelsMetadata] = useState<Record<string, PerModelMetadata>>({});

  const setModelMeta = useCallback((modelId: string, update: Partial<PerModelMetadata>) => {
    setModelsMetadata((prev) => ({
      ...prev,
      [modelId]: { ...prev[modelId], ...update },
    }));
  }, []);

  const loadModelMetadata = useCallback(
    async (model: InstalledOnnxModel) => {
      if (getCachedOnnxModelInputMetadata(model)) {
        setModelMeta(model.id, {
          loading: false,
          error: null,
          inputs: model.variant.inputMetadata!,
          outputs: model.variant.outputMetadata ?? null,
        });
        return;
      }
      setModelMeta(model.id, { loading: true, error: null, inputs: null, outputs: null });
      try {
        const [inputs, outputs] = await Promise.all([
          loadOnnxModelMetadataCached(model, effectiveBackend),
          loadOnnxModelOutputMetadataCached(model, effectiveBackend),
        ]);
        setModelMeta(model.id, { loading: false, error: null, inputs, outputs });
      } catch (caught) {
        setModelMeta(model.id, {
          loading: false,
          error: caught instanceof Error ? caught.message : 'Failed to load metadata',
          inputs: null,
          outputs: null,
        });
      }
    },
    [effectiveBackend, setModelMeta],
  );

  React.useEffect(() => {
    const timer = setTimeout(() => {
      for (const model of installedModels) {
        void loadModelMetadata(model);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [installedModels, loadModelMetadata]);

  const selectedVariant =
    variants.find((variant) => variant.id === selectedVariantId) ??
    selectDefaultOnnxVariant(variants);
  const grandTotal = selectedVariant
    ? (getVariantTotalSize(selectedVariant) ?? selectedVariant.sizeBytes ?? 0)
    : 0;
  const activeDownloadJob = useMemo((): BackgroundJob | null => {
    if (downloadJobId) {
      return backgroundJobs.find((job) => job.id === downloadJobId) ?? null;
    }
    return (
      backgroundJobs.find(
        (job) =>
          job.type === 'onnx-download' &&
          isBackgroundJobActive(job) &&
          (!selectedVariant || job.source?.variantId === selectedVariant.id),
      ) ?? null
    );
  }, [backgroundJobs, downloadJobId, selectedVariant]);
  const activeDownloadProgress = activeDownloadJob?.progressState;
  const downloadProgress = activeDownloadJob?.progress ?? activeDownloadProgress?.percent ?? null;
  const downloadLoaded =
    activeDownloadProgress?.loaded ??
    ((downloadProgress ?? 0) > 0 && (activeDownloadProgress?.total ?? grandTotal) > 0
      ? Math.round(((downloadProgress ?? 0) / 100) * (activeDownloadProgress?.total ?? grandTotal))
      : 0);
  const downloadTotal = activeDownloadProgress?.total ?? grandTotal;
  const downloadFile = activeDownloadProgress?.currentFile
    ? {
        name: activeDownloadProgress.currentFile.name,
        loaded: activeDownloadProgress.currentFile.loaded ?? 0,
        size: activeDownloadProgress.currentFile.size ?? 0,
        index: activeDownloadProgress.currentFile.index ?? 0,
        count: activeDownloadProgress.currentFile.count ?? 1,
      }
    : null;
  const isDownloadActive = activeDownloadJob ? isBackgroundJobActive(activeDownloadJob) : false;

  React.useEffect(() => {
    if (!activeDownloadJob) return;
    if (activeDownloadJob.status === 'error') {
      setError(activeDownloadJob.error ?? activeDownloadJob.detail ?? 'Model download failed.');
    }
  }, [activeDownloadJob]);

  const browseRepo = useCallback(async (repoName: string) => {
    const normalizedRepoName = normalizeHuggingFaceRepoName(repoName);
    setRepoNameDraft(normalizedRepoName);
    setBrowseState('loading');
    setError(null);
    setVariants([]);
    setSelectedVariantId('');

    try {
      const files = await fetchHuggingFaceOnnxRepoFiles(normalizedRepoName);
      const detectedVariants = resolveOnnxVariantsFromRepoFiles({
        repoName: normalizedRepoName,
        files,
        recipe: GENERIC_ONNX_RECIPE,
      });
      if (detectedVariants.length === 0) {
        throw new Error('No .onnx files were found in this repo.');
      }
      setVariants(detectedVariants);
      setSelectedVariantId(detectedVariants[0].id);
      setBrowseState('ready');
    } catch (caughtError) {
      setBrowseState('error');
      setError(caughtError instanceof Error ? caughtError.message : 'Could not browse repo.');
    }
  }, []);

  const searchRepos = useCallback(async () => {
    setBrowseState('loading');
    setError(null);
    try {
      const results = await searchHuggingFaceOnnxModels(searchDraft);
      setSearchResults(results);
      setBrowseState('idle');
    } catch (caughtError) {
      setBrowseState('error');
      setError(caughtError instanceof Error ? caughtError.message : 'Hugging Face search failed.');
    }
  }, [searchDraft]);

  const refreshInstalledModelMetadata = useCallback(
    async (model: InstalledOnnxModel) => {
      try {
        const [inputMeta, outputMeta] = await Promise.all([
          loadOnnxModelMetadata(model, effectiveBackend),
          loadOnnxModelOutputMetadataCached(model, effectiveBackend),
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
    },
    [effectiveBackend],
  );

  const startOnnxDownloadJob = useCallback(
    (
      variant: OnnxModelVariantMetadata,
      options: { redownload?: boolean; selectWhenComplete?: boolean } = {},
    ) => {
      if (!editorActions?.runBackgroundJob) {
        setError('Background job executor is unavailable.');
        return;
      }

      const modelId = `generic:${variant.repoName}:${variant.filePath}`;
      const fileName = variant.filePath.split('/').pop() ?? variant.filePath;
      setError(null);

      const jobId = editorActions.runBackgroundJob(
        {
          type: 'onnx-download',
          title: `${options.redownload ? 'Redownload' : 'Download'} ${variant.label}`,
          subtitle: variant.repoName,
          detail: `Queued ${fileName}`,
          status: 'queued',
          progress: 0,
          indeterminate: false,
          cancellable: true,
          source: {
            modelId,
            repoName: variant.repoName,
            variantId: variant.id,
            url: getOnnxDownloadUrl(variant),
            filename: fileName,
          },
          payload: { variant },
        },
        async (job) => {
          let currentFile: NonNullable<BackgroundJob['progressState']>['currentFile'] | undefined;
          const reportProgress = (progress: DownloadProgress) => {
            if (progress.currentFile) {
              currentFile = {
                name: progress.currentFile,
                loaded: progress.currentFileLoaded ?? 0,
                size: progress.currentFileSize,
                index: progress.fileIndex,
                count: progress.fileCount,
              };
            } else if (currentFile && progress.currentFileLoaded !== undefined) {
              currentFile = { ...currentFile, loaded: progress.currentFileLoaded };
            }

            job.progress({
              label: currentFile ? `Downloading ${currentFile.name}` : 'Downloading ONNX model',
              loaded: progress.loaded,
              total: progress.total,
              percent: progress.percent,
              ...(currentFile ? { currentFile } : {}),
            });
          };

          const model = await downloadAndCacheOnnxModel({
            variant,
            onProgress: reportProgress,
            signal: job.signal,
          });

          job.update({
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
          await refreshInstalledModelMetadata(model);
          await refreshInstalledModels();
          if (options.selectWhenComplete) {
            setSelectedVariantId(model.variant.id);
          }
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
      );
      setDownloadJobId(jobId);
    },
    [editorActions, refreshInstalledModelMetadata, refreshInstalledModels],
  );

  const cancelDownload = useCallback(() => {
    if (activeDownloadJob) {
      editorActions?.requestBackgroundJobCancel?.(activeDownloadJob.id);
    }
  }, [activeDownloadJob, editorActions]);

  const downloadSelectedVariant = useCallback(async () => {
    if (!selectedVariant) return;
    startOnnxDownloadJob(selectedVariant, { selectWhenComplete: true });
  }, [selectedVariant, startOnnxDownloadJob]);

  const redownloadModel = useCallback(
    async (model: InstalledOnnxModel) => {
      startOnnxDownloadJob(model.variant, { redownload: true });
    },
    [startOnnxDownloadJob],
  );

  const createNodeFromModel = useCallback(
    (model: InstalledOnnxModel) => {
      editorActions?.addNodeWithProps?.(
        NodeType.ONNX_MODEL,
        {
          modelId: model.id,
          modelName: model.name,
          modelRepo: model.repoName,
          variantId: model.variant.id,
          variantLabel: model.variant.label,
          backend: effectiveBackend,
          inputSize:
            model.variant.inputShape?.[2] && model.variant.inputShape?.[3]
              ? { width: model.variant.inputShape[3], height: model.variant.inputShape[2] }
              : { ...GENERIC_ONNX_RECIPE.defaultInputSize },
          task: GENERIC_ONNX_RECIPE.task,
        },
        { name: `${model.name} ONNX` },
      );
    },
    [effectiveBackend, editorActions],
  );

  const copyText = useCallback(async (value: string) => {
    await navigator.clipboard?.writeText(value);
    setCopiedValue(value);
    window.setTimeout(() => setCopiedValue(null), 1400);
  }, []);

  return (
    <div className="space-y-3 bg-gray-950">
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-white">Browser ONNX Runtime</p>
            <p className="mt-1 text-xs leading-5 text-gray-400">
              Install browser inference models once, then reference them from ONNX nodes.
            </p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setPreferences({ onnxRuntimeWebGpuEnabled: !onnxRuntimeWebGpuEnabled })}
            className={`relative rounded-xl border p-3 text-left transition ${
              onnxRuntimeWebGpuEnabled
                ? 'border-primary-400/40 bg-primary-500/10'
                : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
            }`}
          >
            <span
              className={`absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full border transition ${
                onnxRuntimeWebGpuEnabled
                  ? 'border-primary-500 bg-primary-500'
                  : 'border-white/20 bg-transparent'
              }`}
            >
              {onnxRuntimeWebGpuEnabled ? (
                <svg
                  className="h-3 w-3 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={3}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : null}
            </span>
            <span className="text-xs font-medium text-gray-200">WebGPU</span>
            <p className="mt-1.5 text-[11px] leading-4 text-gray-500">
              Primary backend. Automatically used when available.
            </p>
          </button>
          <button
            type="button"
            onClick={() => setPreferences({ onnxRuntimeWasmEnabled: !onnxRuntimeWasmEnabled })}
            className={`relative rounded-xl border p-3 text-left transition ${
              onnxRuntimeWasmEnabled
                ? 'border-primary-400/40 bg-primary-500/10'
                : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
            }`}
          >
            <span
              className={`absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full border transition ${
                onnxRuntimeWasmEnabled
                  ? 'border-primary-500 bg-primary-500'
                  : 'border-white/20 bg-transparent'
              }`}
            >
              {onnxRuntimeWasmEnabled ? (
                <svg
                  className="h-3 w-3 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={3}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : null}
            </span>
            <span className="text-xs font-medium text-gray-200">WASM</span>
            <p className="mt-1.5 text-[11px] leading-4 text-gray-500">
              Fallback backend. Used when WebGPU is unavailable.
            </p>
          </button>
        </div>
        {!compatibility.webgpu && !compatibility.wasm ? (
          <p className="mt-3 text-xs leading-5 text-red-300">
            Enable at least one ONNX backend before running browser inference.
          </p>
        ) : null}
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-white">Hugging Face ONNX Import</p>
            <p className="mt-1 text-xs leading-6 text-gray-400">
              Paste a repo name or search for ONNX models.
            </p>
          </div>
          <StatusBadge tone="accent">{GENERIC_ONNX_RECIPE.name}</StatusBadge>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <input
            value={repoNameDraft}
            onChange={(event) => setRepoNameDraft(event.target.value)}
            className={`${baseFieldClassName} font-mono`}
            placeholder={`e.g. ${DEFAULT_ONNX_REPO}`}
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => void browseRepo(repoNameDraft)}
            disabled={browseState === 'loading'}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-gray-200 transition hover:border-white/20 hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Icons.MagnifyingGlass className="h-3.5 w-3.5" />
            {browseState === 'loading' ? 'Browsing...' : 'Browse Repo'}
          </button>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <input
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            className={baseFieldClassName}
            placeholder="Search Hugging Face ONNX models"
          />
          <button
            type="button"
            onClick={() => void searchRepos()}
            disabled={browseState === 'loading'}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-gray-200 transition hover:border-white/20 hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Icons.Link className="h-3.5 w-3.5" />
            Search
          </button>
        </div>

        {searchResults.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {searchResults.map((repo) => (
              <button
                key={repo}
                type="button"
                onClick={() => void browseRepo(repo)}
                className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-xs text-gray-300 hover:border-primary-300/30 hover:text-primary-100"
              >
                {repo}
              </button>
            ))}
          </div>
        ) : null}

        {variants.length > 0 ? (
          <div className="mt-4 space-y-3">
            <p className="text-xs font-medium text-gray-400">Available variants</p>
            <div className="grid gap-1.5">
              {variants.map((variant) => {
                const isSelected = selectedVariant?.id === variant.id;
                const totalSize = formatBytes(getVariantTotalSize(variant) ?? variant.sizeBytes);
                return (
                  <button
                    key={variant.id}
                    type="button"
                    onClick={() => setSelectedVariantId(variant.id)}
                    className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-xs transition ${
                      isSelected
                        ? 'border-primary-400/35 bg-primary-500/10 text-white'
                        : 'border-white/10 bg-black/20 text-gray-300 hover:border-white/20'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{variant.label}</span>
                        <span className="shrink-0 text-gray-500">{totalSize}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        {variant.precision !== 'unknown' || variant.scale !== 'unknown' ? (
                          <>
                            <span className="text-[10px] text-gray-500">
                              {variant.precision !== 'unknown' && variant.scale !== 'unknown'
                                ? `${variant.precision} · ${variant.scale}`
                                : variant.precision !== 'unknown'
                                  ? variant.precision
                                  : variant.scale}
                            </span>
                            <span className="text-[10px] text-gray-500">·</span>
                          </>
                        ) : null}
                        <span className="text-[10px] text-gray-500">
                          {variant.supportedBackends.join(', ')}
                        </span>
                        {variant.externalDataFiles?.length ? (
                          <>
                            <span className="text-[10px] text-gray-500">·</span>
                            <span className="text-[10px] text-amber-300/70">
                              {variant.externalDataFiles.length} ext
                            </span>
                          </>
                        ) : null}
                      </div>
                    </div>
                    <span className="shrink-0 text-gray-600">
                      {isSelected ? (
                        <Icons.ChevronRight className="h-3.5 w-3.5" />
                      ) : (
                        <Icons.ChevronRight className="h-3.5 w-3.5 opacity-0" />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
            {selectedVariant && selectedVariant.externalDataFiles?.length ? (
              <div className="mt-2 rounded-lg border border-white/10 bg-black/20 p-2">
                <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">
                  Required files
                </p>
                <div className="mt-1 space-y-0.5">
                  {getVariantRequiredFiles(selectedVariant).map((file) => (
                    <div
                      key={file.path}
                      className="flex items-center justify-between gap-2 font-mono text-[10px] text-gray-400"
                    >
                      <span className="truncate">
                        {file.type === 'onnx' ? '●' : '◈'} {file.path.split('/').pop()}
                      </span>
                      <span className="shrink-0 text-gray-600">{formatBytes(file.size)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void downloadSelectedVariant()}
                disabled={!selectedVariant || isDownloadActive}
                className="inline-flex items-center gap-2 rounded-lg border border-primary-400/30 bg-primary-500/15 px-3 py-2 text-xs font-medium text-primary-100 transition hover:bg-primary-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Icons.ArrowDownTray className="h-3.5 w-3.5" />
                {isDownloadActive ? 'Downloading...' : 'Download'}
              </button>
              {selectedVariant ? (
                <button
                  type="button"
                  onClick={() => void copyText(getOnnxDownloadUrl(selectedVariant))}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-gray-200 transition hover:border-white/20 hover:bg-white/[0.07]"
                >
                  <Icons.Copy className="h-3.5 w-3.5" />
                  {copiedValue === getOnnxDownloadUrl(selectedVariant) ? 'Copied' : 'Copy URL'}
                </button>
              ) : null}
            </div>
            {isDownloadActive ? (
              <div className="mt-3 space-y-2">
                {downloadFile ? (
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="truncate text-gray-300">
                      {downloadFile.count > 1
                        ? `[${downloadFile.index + 1}/${downloadFile.count}] `
                        : ''}
                      {downloadFile.name}
                    </span>
                    <span className="shrink-0 pl-3 text-gray-500">
                      {downloadFile.size ? formatBytes(downloadFile.size) : 'Unknown size'}
                    </span>
                  </div>
                ) : null}
                <div className="flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-primary-400 transition-all"
                      style={{ width: `${downloadProgress ?? 0}%` }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={cancelDownload}
                    className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] font-medium text-gray-300 transition hover:border-red-300/30 hover:bg-red-500/10 hover:text-red-200"
                  >
                    <Icons.XMark className="h-3 w-3" />
                    Cancel
                  </button>
                </div>
                <p className="text-[11px] text-gray-500">
                  {formatBytes(downloadLoaded)}
                  {' / '}
                  {formatBytes(downloadTotal)}
                  {' — '}
                  {downloadFile ? formatBytes(downloadFile.loaded) : 0}
                  {' of '}
                  {downloadFile?.size ? formatBytes(downloadFile.size) : '?'}
                  {' (this file)'}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        {error ? <p className="mt-3 text-xs leading-5 text-red-300">{error}</p> : null}
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div>
          <p className="text-sm font-medium text-white">Installed Models</p>
          <p className="mt-1 text-xs leading-6 text-gray-400">
            Cached locally in IndexedDB. Nodes store a model reference, not model bytes.
          </p>
        </div>

        <div className="mt-4 space-y-2">
          {installedModels.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 bg-black/20 p-4 text-sm text-gray-400">
              No ONNX models installed yet.
            </div>
          ) : (
            installedModels.map((model) => {
              const isSelected = selectedModelId === model.id;
              const meta = modelsMetadata[model.id];
              const inputs = meta?.inputs ?? model.variant.inputMetadata;
              const outputs = meta?.outputs ?? model.variant.outputMetadata;
              const totalSize = formatBytes(
                (model.sizeBytes ?? 0) +
                  (model.externalData ?? []).reduce((s, e) => s + (e.sizeBytes ?? 0), 0),
              );
              const hasMetadata = (inputs && inputs.length > 0) || (outputs && outputs.length > 0);
              const hasExternal = model.externalData?.length ?? 0 > 0;

              return (
                <div
                  key={model.id}
                  onClick={() => setSelectedModelId(isSelected ? null : model.id)}
                  className={`group rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'border-primary-400/40 bg-primary-500/8'
                      : 'border-white/10 bg-black/20 hover:border-white/20'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-white truncate">{model.name}</p>
                        <StatusBadge tone="accent">{model.variant.label}</StatusBadge>
                        <span
                          className={`shrink-0 transition-transform duration-200 ${isSelected ? 'rotate-90 text-primary-400' : 'text-gray-600 group-hover:text-gray-400'}`}
                        >
                          <Icons.ChevronRight className="h-3.5 w-3.5" />
                        </span>
                      </div>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-gray-500">
                        {model.repoName}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-gray-400">
                        <span>{totalSize}</span>
                        <span className="text-gray-600">·</span>
                        <span>{model.variant.supportedBackends.join(', ')}</span>
                        {(inputs?.length ?? 0) > 0 || (outputs?.length ?? 0) > 0 ? (
                          <>
                            <span className="text-gray-600">·</span>
                            <span>
                              {inputs?.length ?? 0} in / {outputs?.length ?? 0} out
                            </span>
                          </>
                        ) : null}
                        {hasExternal && (
                          <>
                            <span className="text-gray-600">·</span>
                            <span className="text-amber-300/70">
                              {model.externalData!.length} ext
                            </span>
                          </>
                        )}
                        {meta?.loading ? (
                          <span className="text-[11px] text-gray-500">Loading metadata...</span>
                        ) : meta?.error ? (
                          <span className="text-[11px] text-red-300">
                            Metadata error: {meta.error}
                            <button
                              type="button"
                              onClick={async (e) => {
                                e.stopPropagation();
                                model.variant.metadataError = undefined;
                                await updateInstalledOnnxModel(model);
                                setModelMeta(model.id, {
                                  loading: false,
                                  error: null,
                                  inputs: null,
                                  outputs: null,
                                });
                                void loadModelMetadata(model);
                              }}
                              className="ml-2 underline"
                            >
                              Retry
                            </button>
                          </span>
                        ) : null}
                      </div>
                      {isSelected && (
                        <>
                          {(hasMetadata || meta?.error) && (
                            <div className="mt-2 space-y-3">
                              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                                  Inputs
                                </p>
                                {inputs && inputs.length > 0 ? (
                                  <div className="space-y-1">
                                    {inputs.map((input, i) => (
                                      <div key={i} className="flex items-center gap-2 text-[11px]">
                                        <span className="w-32 shrink-0 truncate font-mono text-gray-100">
                                          {input.name}
                                        </span>
                                        <span className="font-mono text-gray-300">
                                          {input.dimsLabel}
                                        </span>
                                        <span
                                          className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium ${
                                            input.isDynamic
                                              ? 'border border-amber-400/20 bg-amber-500/10 text-amber-200'
                                              : 'border border-green-400/20 bg-green-500/10 text-green-100'
                                          }`}
                                        >
                                          {input.isDynamic ? 'Dynamic' : 'Fixed'}
                                        </span>
                                        {input.type !== 'unknown' && (
                                          <span className="shrink-0 text-gray-500">
                                            {input.type}
                                          </span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                ) : model.variant.inputShape?.length ? (
                                  <p className="font-mono text-[11px] text-gray-100">
                                    {model.variant.inputShape.join(' \u00d7 ')}
                                  </p>
                                ) : (
                                  <p className="text-[11px] text-gray-500">Not inspected yet</p>
                                )}
                              </div>
                              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                                  Outputs
                                </p>
                                {outputs && outputs.length > 0 ? (
                                  <div className="space-y-1">
                                    {outputs.map((output, i) => (
                                      <div key={i} className="flex items-center gap-2 text-[11px]">
                                        <span className="w-32 shrink-0 truncate font-mono text-gray-100">
                                          {output.name}
                                        </span>
                                        <span className="font-mono text-gray-300">
                                          {output.dimsLabel}
                                        </span>
                                        <span
                                          className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium ${
                                            output.isDynamic
                                              ? 'border border-amber-400/20 bg-amber-500/10 text-amber-200'
                                              : 'border border-green-400/20 bg-green-500/10 text-green-100'
                                          }`}
                                        >
                                          {output.isDynamic ? 'Dynamic' : 'Fixed'}
                                        </span>
                                        {output.type !== 'unknown' && (
                                          <span className="shrink-0 text-gray-500">
                                            {output.type}
                                          </span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                ) : model.variant.outputShape?.length ? (
                                  <p className="font-mono text-[11px] text-gray-100">
                                    {model.variant.outputShape.join(' \u00d7 ')}
                                  </p>
                                ) : (
                                  <p className="text-[11px] text-gray-500">Not inspected yet</p>
                                )}
                              </div>
                            </div>
                          )}
                          {hasExternal && (
                            <div className="mt-2 rounded-lg border border-white/10 bg-black/20 p-3">
                              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                                Cached files
                              </p>
                              <div className="space-y-0.5">
                                {model.externalData!.map((ext) => (
                                  <div
                                    key={ext.path}
                                    className="flex items-center justify-between gap-2 font-mono text-[11px] text-gray-400"
                                  >
                                    <span className="truncate text-amber-200/70">
                                      ◈ {ext.path.split('/').pop()}
                                    </span>
                                    <span className="shrink-0 text-gray-600">
                                      {formatBytes(ext.sizeBytes)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          createNodeFromModel(model);
                        }}
                        disabled={!editorActions?.addNodeWithProps}
                        className="inline-flex items-center gap-1.5 rounded-md border border-primary-400/30 bg-primary-500/15 px-2.5 py-1.5 text-[11px] font-medium text-primary-100 transition hover:bg-primary-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Icons.Plus className="h-3 w-3" />
                        Add Node
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(
                            `https://huggingface.co/${model.repoName}`,
                            '_blank',
                            'noopener,noreferrer',
                          );
                        }}
                        className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-medium text-gray-300 transition hover:border-white/20 hover:bg-white/[0.07]"
                      >
                        <Icons.Link className="h-3 w-3" />
                        HF
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void copyText(model.cacheKey);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-medium text-gray-300 transition hover:border-white/20 hover:bg-white/[0.07]"
                      >
                        <Icons.Copy className="h-3 w-3" />
                        {copiedValue === model.cacheKey ? 'Copied' : 'Key'}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void redownloadModel(model);
                        }}
                        disabled={isDownloadActive}
                        className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-medium text-gray-300 transition hover:border-white/20 hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Icons.RotateLoop className="h-3 w-3" />
                        Redownload
                      </button>
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          await deleteInstalledOnnxModel(model.id);
                          await refreshInstalledModels();
                        }}
                        className="inline-flex items-center gap-1.5 rounded-md border border-red-300/20 bg-red-500/10 px-2.5 py-1.5 text-[11px] font-medium text-red-100 transition hover:bg-red-500/15"
                      >
                        <Icons.Trash className="h-3 w-3" />
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export default OnnxModelsPreferences;
