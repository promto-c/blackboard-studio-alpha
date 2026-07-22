import React, { useCallback, useMemo, useState } from 'react';
import * as Icons from '@blackboard/icons';
import { TextInput, ToggleButton } from '@blackboard/ui';
import { useEditorSelector, useOptionalEditorActions } from '@/state/editorContext';
import { usePreferences } from '@/state/preferencesContext';
import { useInstalledOnnxModels } from '@/state/installedOnnxModelsContext';

import {
  type InstalledOnnxModel,
  type ModelCatalogReference,
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
import { groupInstalledOnnxModels } from '@/services/models/installedModelGroups';
import { getModelConsumers } from '@/services/models/modelUsageRegistry';
import BuiltinModelsPreferences from './BuiltinModelsPreferences';
import InstalledOnnxModelGroupCard from './InstalledOnnxModelGroupCard';

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

function OnnxModelsPreferences() {
  const editorActions = useOptionalEditorActions() as {
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
  const projectNodes = useEditorSelector((state) => state.nodes);
  const [browseState, setBrowseState] = useState<BrowseState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [downloadJobId, setDownloadJobId] = useState<string | null>(null);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [selectedModelGroupId, setSelectedModelGroupId] = useState<string | null>(null);

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
  const installedModelGroups = useMemo(
    () => groupInstalledOnnxModels(installedModels),
    [installedModels],
  );

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
      options: {
        redownload?: boolean;
        selectWhenComplete?: boolean;
        catalogRef?: ModelCatalogReference;
      } = {},
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
          payload: { variant, catalogRef: options.catalogRef },
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
            catalogRef: options.catalogRef,
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
      startOnnxDownloadJob(model.variant, { redownload: true, catalogRef: model.catalogRef });
    },
    [startOnnxDownloadJob],
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
        <div className="mt-3 grid grid-cols-2 gap-1">
          <ToggleButton
            label="WebGPU"
            active={onnxRuntimeWebGpuEnabled}
            onClick={() => setPreferences({ onnxRuntimeWebGpuEnabled: !onnxRuntimeWebGpuEnabled })}
            title="Primary backend. Automatically used when available."
            icon={<Icons.CubeTransparent className="h-4 w-4" />}
          />
          <ToggleButton
            label="WASM"
            active={onnxRuntimeWasmEnabled}
            onClick={() => setPreferences({ onnxRuntimeWasmEnabled: !onnxRuntimeWasmEnabled })}
            title="Fallback backend. Used when WebGPU is unavailable."
            icon={<Icons.CodeBracket className="h-4 w-4" />}
          />
        </div>
        {!compatibility.webgpu && !compatibility.wasm ? (
          <p className="mt-3 text-xs leading-5 text-red-300">
            Enable at least one ONNX backend before running browser inference.
          </p>
        ) : null}
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div>
          <p className="text-sm font-medium text-white">Hugging Face ONNX Import</p>
          <p className="mt-1 text-xs leading-6 text-gray-400">
            Paste a repo name or search for ONNX models.
          </p>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <TextInput
            value={repoNameDraft}
            onValueChange={setRepoNameDraft}
            placeholder={`e.g. ${DEFAULT_ONNX_REPO}`}
            spellCheck={false}
            className="rounded-xl bg-black/20 px-3 py-2.5 text-sm text-gray-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] font-mono focus:border-primary-400/40 focus:ring-2 focus:ring-primary-500/20"
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
          <TextInput
            value={searchDraft}
            onValueChange={setSearchDraft}
            placeholder="Search Hugging Face ONNX models"
            className="rounded-xl bg-black/20 px-3 py-2.5 text-sm text-gray-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] focus:border-primary-400/40 focus:ring-2 focus:ring-primary-500/20"
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
          <p className="text-sm font-medium text-white">Model Library</p>
          <p className="mt-1 text-xs leading-6 text-gray-400">
            Manage built-in bundles, plugin requirements, and imported ONNX graphs.
          </p>
        </div>

        <div className="mt-4">
          <BuiltinModelsPreferences
            installedModels={installedModels}
            projectNodes={projectNodes}
            installingVariantId={
              activeDownloadJob && isBackgroundJobActive(activeDownloadJob)
                ? activeDownloadJob.source?.variantId
                : undefined
            }
            onInstallOnnxGraph={(variant, catalogRef) =>
              startOnnxDownloadJob(variant, { catalogRef })
            }
            onBrowseRepository={(repoName) => void browseRepo(repoName)}
          />
        </div>

        <div className="mt-5 border-t border-white/[0.08] pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-medium text-gray-200">Installed ONNX graphs</p>
              <p className="mt-0.5 text-[10px] text-gray-500">
                Browser cache and connected model mounts
              </p>
            </div>
            <span className="text-[10px] text-gray-600">
              {installedModelGroups.length} model{installedModelGroups.length === 1 ? '' : 's'} ·{' '}
              {installedModels.length} variant{installedModels.length === 1 ? '' : 's'}
            </span>
          </div>
        </div>

        <div className="mt-3 space-y-2">
          {installedModels.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 bg-black/20 p-4 text-sm text-gray-400">
              No ONNX graphs installed yet. Built-in runtime bundles remain available above.
            </div>
          ) : (
            installedModelGroups.map((group) => {
              const expanded = selectedModelGroupId === group.id;
              const modelKeys = new Set(
                group.models.flatMap((model) => [
                  model.id,
                  model.repoName,
                  ...(model.catalogRef ? [model.catalogRef.modelId] : []),
                ]),
              );
              const consumers = getModelConsumers(modelKeys, projectNodes);
              const activeConsumerCount = consumers.filter((consumer) => consumer.active).length;

              return (
                <InstalledOnnxModelGroupCard
                  key={group.id}
                  group={group}
                  expanded={expanded}
                  metadataByModelId={modelsMetadata}
                  consumers={consumers}
                  downloadActive={isDownloadActive}
                  onToggle={() => setSelectedModelGroupId(expanded ? null : group.id)}
                  onRetryMetadata={(model) => {
                    void (async () => {
                      model.variant.metadataError = undefined;
                      await updateInstalledOnnxModel(model);
                      setModelMeta(model.id, {
                        loading: false,
                        error: null,
                        inputs: null,
                        outputs: null,
                      });
                      await loadModelMetadata(model);
                    })();
                  }}
                  onRedownload={(model) => void redownloadModel(model)}
                  onDelete={(model) => {
                    const usageWarning =
                      activeConsumerCount > 0
                        ? ` It is referenced by ${activeConsumerCount} node${activeConsumerCount === 1 ? '' : 's'} in this project.`
                        : '';
                    if (
                      !window.confirm(
                        `Delete ${model.name} (${model.variant.label}) from local model storage?${usageWarning}`,
                      )
                    ) {
                      return;
                    }
                    void deleteInstalledOnnxModel(model.id).then(refreshInstalledModels);
                  }}
                />
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export default OnnxModelsPreferences;
