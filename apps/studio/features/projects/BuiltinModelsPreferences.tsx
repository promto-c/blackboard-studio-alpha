import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as Icons from '@blackboard/icons';
import { Badge, StyledDropdown } from '@blackboard/ui';
import type {
  AnyNode,
  InstalledOnnxModel,
  ModelCatalogReference,
  OnnxModelVariantMetadata,
} from '@blackboard/types';
import { usePreferences } from '@/state/preferencesContext';
import {
  BUILTIN_MODEL_BUNDLES,
  createBuiltinOnnxCatalogReference,
  SAM3_MODEL_VARIANTS,
  SAM3_TRACKER_MODEL,
  SAM3_VISION_ENCODER_TARGET,
} from '@/services/models/builtinModelRegistry';
import {
  getDeclaredModelRequirements,
  getModelConsumers,
} from '@/services/models/modelUsageRegistry';
import {
  deleteTransformersModelCache,
  getTransformersModelCacheInfo,
  type TransformersModelCacheInfo,
} from '@/services/models/transformersModelCache';
import { resetSam3Runtime } from '@/services/segmentation/sam3TrackerRuntime';
import { resetAllSegmentationSessions } from '@/services/segmentation/segmentationSession';
import ModelLibraryCardHeader from './ModelLibraryCardHeader';
import ModelUsageChips from './ModelUsageChips';

interface BuiltinModelsPreferencesProps {
  installedModels: readonly InstalledOnnxModel[];
  projectNodes: readonly AnyNode[];
  installingVariantId?: string;
  onInstallOnnxGraph: (
    variant: OnnxModelVariantMetadata,
    catalogRef: ModelCatalogReference,
  ) => void;
  onBrowseRepository: (repoName: string) => void;
}

const formatBytes = (bytes: number): string => {
  if (bytes <= 0) return 'Not cached';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
};

export default function BuiltinModelsPreferences({
  installedModels,
  projectNodes,
  installingVariantId,
  onInstallOnnxGraph,
  onBrowseRepository,
}: BuiltinModelsPreferencesProps) {
  const { onnxRuntimeWebGpuEnabled, onnxRuntimeWasmEnabled } = usePreferences();
  const [cacheInfo, setCacheInfo] = useState<TransformersModelCacheInfo>({
    fileCount: 0,
    sizeBytes: 0,
    files: [],
  });
  const [selectedGraphVariantId, setSelectedGraphVariantId] = useState(
    SAM3_VISION_ENCODER_TARGET.variants[0]?.id ?? '',
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isClearing, setIsClearing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setCacheInfo(await getTransformersModelCacheInfo(SAM3_TRACKER_MODEL.id));
      setError(null);
    } catch (cacheError) {
      setError(cacheError instanceof Error ? cacheError.message : String(cacheError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const cachedFileSet = useMemo(() => new Set(cacheInfo.files), [cacheInfo.files]);
  const cachedVariants = useMemo(
    () =>
      new Set(
        SAM3_MODEL_VARIANTS.filter(
          (variant) =>
            variant.id !== 'auto' &&
            variant.cacheFiles.every((filePath) => cachedFileSet.has(filePath)),
        ).map((variant) => variant.id),
      ),
    [cachedFileSet],
  );
  const consumers = useMemo(
    () => getModelConsumers([SAM3_TRACKER_MODEL.id], projectNodes),
    [projectNodes],
  );
  const selectedGraphVariant =
    SAM3_VISION_ENCODER_TARGET.variants.find((variant) => variant.id === selectedGraphVariantId) ??
    SAM3_VISION_ENCODER_TARGET.variants[0];
  const selectedInstalledGraph = selectedGraphVariant
    ? installedModels.find((model) => model.variant.id === selectedGraphVariant.id)
    : undefined;
  const graphCatalogRef = createBuiltinOnnxCatalogReference(
    SAM3_TRACKER_MODEL,
    SAM3_VISION_ENCODER_TARGET,
  );
  const knownModelIds = useMemo(
    () =>
      new Set([
        ...BUILTIN_MODEL_BUNDLES.map((model) => model.id),
        ...installedModels.flatMap((model) => [
          model.id,
          model.repoName,
          ...(model.catalogRef ? [model.catalogRef.modelId] : []),
        ]),
      ]),
    [installedModels],
  );
  const externalRequirements = useMemo(
    () =>
      getDeclaredModelRequirements().filter(
        ({ requirement }) =>
          !knownModelIds.has(requirement.modelId) &&
          !(requirement.repoName && knownModelIds.has(requirement.repoName)),
      ),
    [knownModelIds],
  );
  const runtimeBackends = useMemo(
    () =>
      Array.from(new Set(SAM3_MODEL_VARIANTS.flatMap((variant) => variant.supportedBackends))).join(
        ' / ',
      ),
    [],
  );
  const cacheLabel = isLoading
    ? 'Checking cache…'
    : cacheInfo.fileCount > 0
      ? `${formatBytes(cacheInfo.sizeBytes)} cached`
      : 'On demand';

  const clearCache = async () => {
    if (
      !window.confirm(
        'Remove the SAM3 Smart Mask runtime cache? Installed ONNX graph copies are managed separately.',
      )
    ) {
      return;
    }
    setIsClearing(true);
    try {
      resetAllSegmentationSessions();
      await resetSam3Runtime();
      await deleteTransformersModelCache(SAM3_TRACKER_MODEL.id);
      await refresh();
    } catch (cacheError) {
      setError(cacheError instanceof Error ? cacheError.message : String(cacheError));
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div className="space-y-2">
      <div
        className={`overflow-hidden rounded-xl border bg-black/20 transition-colors ${
          expanded ? 'border-white/20' : 'border-white/10 hover:border-white/15'
        }`}
      >
        <ModelLibraryCardHeader
          name={SAM3_TRACKER_MODEL.name}
          originLabel="Built-in"
          badges={[
            `${SAM3_MODEL_VARIANTS.length} variants`,
            cacheLabel,
            runtimeBackends,
            'Browser',
          ]}
          repoName={SAM3_TRACKER_MODEL.repoName}
          expanded={expanded}
          consumers={consumers}
          onToggle={() => setExpanded((current) => !current)}
        />

        {expanded ? (
          <div className="border-t border-white/[0.07] px-3 pb-3 pt-3">
            <p className="max-w-2xl text-[10px] leading-4 text-gray-500">
              {SAM3_TRACKER_MODEL.description}
            </p>

            <p className="mt-3 text-[9px] font-semibold uppercase tracking-wider text-gray-600">
              Runtime variants
            </p>
            <div className="mt-2 grid gap-1.5 md:grid-cols-2 xl:grid-cols-3">
              {SAM3_MODEL_VARIANTS.map((variant) => {
                const cached =
                  variant.id === 'auto' ? cachedVariants.size > 0 : cachedVariants.has(variant.id);
                const backendDisabled = variant.supportedBackends.every((backend) =>
                  backend === 'webgpu' ? !onnxRuntimeWebGpuEnabled : !onnxRuntimeWasmEnabled,
                );
                return (
                  <div
                    key={variant.id}
                    className="min-w-0 rounded-lg border border-white/[0.08] bg-white/[0.015] px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[11px] font-medium text-gray-200">
                        {variant.shortLabel}
                      </span>
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${cached ? 'bg-emerald-400' : 'bg-gray-700'}`}
                        title={cached ? 'Cached' : 'Downloaded on first use'}
                      />
                    </div>
                    <p className="mt-1 truncate text-[9px] uppercase tracking-wide text-gray-600">
                      {formatBytes(variant.approximateSizeBytes)} ·{' '}
                      {variant.supportedBackends.join(' / ')}
                      {backendDisabled ? ' · disabled' : ''}
                    </p>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 rounded-lg border border-white/[0.08] bg-white/[0.015] p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-[11px] font-medium text-gray-200">
                    ONNX Node · {SAM3_VISION_ENCODER_TARGET.label}
                  </p>
                  <p className="mt-1 text-[10px] leading-4 text-gray-500">
                    Advanced encoder graph with tensor outputs. Install here, then select it inside
                    an ONNX node.
                  </p>
                </div>
                {selectedInstalledGraph ? (
                  <Badge variant="success" size="sm" shrink>
                    Installed
                  </Badge>
                ) : null}
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <StyledDropdown
                  value={selectedGraphVariant?.id ?? ''}
                  options={SAM3_VISION_ENCODER_TARGET.variants.map((variant) => ({
                    value: variant.id,
                    label: variant.label,
                    secondaryLabel: variant.supportedBackends.join(' / '),
                  }))}
                  onChange={(value) => setSelectedGraphVariantId(String(value))}
                  widthClass="min-w-52 flex-1"
                  popoverWidthClass="w-[min(28rem,calc(100vw-2rem))]"
                />
                {!selectedInstalledGraph ? (
                  <button
                    type="button"
                    disabled={
                      !selectedGraphVariant || installingVariantId === selectedGraphVariant.id
                    }
                    onClick={() =>
                      selectedGraphVariant &&
                      onInstallOnnxGraph(selectedGraphVariant, graphCatalogRef)
                    }
                    className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.05] px-2.5 py-1.5 text-[10px] font-medium text-gray-200 transition hover:bg-white/[0.08] disabled:opacity-50"
                  >
                    <Icons.ArrowDownTray className="h-3 w-3" />
                    {installingVariantId === selectedGraphVariant?.id ? 'Installing…' : 'Install'}
                  </button>
                ) : null}
              </div>
            </div>

            {error ? <p className="mt-2 text-xs text-red-300">{error}</p> : null}

            {cacheInfo.fileCount > 0 ? (
              <div className="mt-3 flex border-t border-white/[0.07] pt-3">
                <button
                  type="button"
                  onClick={() => void clearCache()}
                  disabled={isClearing}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] text-gray-500 transition hover:bg-red-500/10 hover:text-red-200 disabled:opacity-50"
                >
                  <Icons.Trash className="h-3 w-3" />
                  {isClearing ? 'Clearing…' : 'Clear runtime cache'}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {externalRequirements.length > 0 ? (
        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-white">External requirements</p>
              <p className="mt-1 text-xs leading-5 text-gray-400">
                Models requested by installed nodes or plugins but not yet available.
              </p>
            </div>
            <span className="text-[10px] text-amber-300">
              {externalRequirements.length} unresolved
            </span>
          </div>
          <div className="mt-3 divide-y divide-white/[0.07] overflow-hidden rounded-lg border border-white/[0.08]">
            {externalRequirements.map(({ requirement, consumers: requirementConsumers }) => (
              <div
                key={requirement.modelId}
                className="flex flex-wrap items-center justify-between gap-3 bg-white/[0.015] p-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs font-medium text-gray-100">{requirement.modelName}</p>
                    {!requirement.optional ? (
                      <Badge variant="warning" size="sm">
                        Required
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[10px] text-gray-500">{requirement.purpose}</p>
                  <div className="mt-2">
                    <ModelUsageChips consumers={requirementConsumers} />
                  </div>
                </div>
                {requirement.repoName ? (
                  <button
                    type="button"
                    onClick={() => onBrowseRepository(requirement.repoName!)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[10px] font-medium text-gray-300 transition hover:bg-white/[0.08]"
                  >
                    <Icons.MagnifyingGlass className="h-3 w-3" />
                    Find model
                  </button>
                ) : requirement.sourceUrl ? (
                  <a
                    href={requirement.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[10px] font-medium text-gray-300 transition hover:bg-white/[0.08]"
                  >
                    <Icons.Link className="h-3 w-3" />
                    Open source
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
