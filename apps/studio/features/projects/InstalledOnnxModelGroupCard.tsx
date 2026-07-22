import React, { useEffect, useMemo, useState } from 'react';
import * as Icons from '@blackboard/icons';
import type { InstalledOnnxModel, OnnxInputMetadata, OnnxOutputMetadata } from '@blackboard/types';
import type { InstalledOnnxModelGroup } from '@/services/models/installedModelGroups';
import type { ModelConsumer } from '@/services/models/modelUsageRegistry';
import ModelLibraryCardHeader from './ModelLibraryCardHeader';

export interface InstalledOnnxModelMetadataState {
  loading: boolean;
  error: string | null;
  inputs: OnnxInputMetadata[] | null;
  outputs: OnnxOutputMetadata[] | null;
}

interface InstalledOnnxModelGroupCardProps {
  group: InstalledOnnxModelGroup;
  expanded: boolean;
  metadataByModelId: Readonly<Record<string, InstalledOnnxModelMetadataState>>;
  consumers: readonly ModelConsumer[];
  downloadActive: boolean;
  onToggle: () => void;
  onRetryMetadata: (model: InstalledOnnxModel) => void;
  onRedownload: (model: InstalledOnnxModel) => void;
  onDelete: (model: InstalledOnnxModel) => void;
}

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

const getModelSize = (model: InstalledOnnxModel): number =>
  (model.sizeBytes ?? 0) +
  (model.externalData ?? []).reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0);

const getOriginLabel = (model: InstalledOnnxModel): string => {
  if (model.catalogRef?.origin === 'builtin') return 'Built-in';
  if (model.catalogRef?.origin === 'plugin') {
    return model.catalogRef.providerName ?? 'Plugin';
  }
  return 'Imported';
};

function IoList({
  title,
  items,
  fallbackShape,
}: {
  title: string;
  items: readonly (OnnxInputMetadata | OnnxOutputMetadata)[] | null | undefined;
  fallbackShape?: number[];
}) {
  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.015] p-3">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-gray-600">{title}</p>
      <div className="mt-2 space-y-1.5">
        {items?.length ? (
          items.map((item) => (
            <div key={item.name} className="flex min-w-0 items-center gap-2 text-[10px]">
              <span className="w-28 shrink-0 truncate font-mono text-gray-200">{item.name}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-gray-400">
                {item.dimsLabel}
              </span>
              {item.isDynamic ? <span className="text-amber-300">Dynamic</span> : null}
              {item.type !== 'unknown' ? (
                <span className="shrink-0 text-gray-600">{item.type}</span>
              ) : null}
            </div>
          ))
        ) : fallbackShape?.length ? (
          <p className="font-mono text-[10px] text-gray-400">{fallbackShape.join(' × ')}</p>
        ) : (
          <p className="text-[10px] text-gray-600">Metadata unavailable</p>
        )}
      </div>
    </div>
  );
}

export default function InstalledOnnxModelGroupCard({
  group,
  expanded,
  metadataByModelId,
  consumers,
  downloadActive,
  onToggle,
  onRetryMetadata,
  onRedownload,
  onDelete,
}: InstalledOnnxModelGroupCardProps) {
  const [selectedModelId, setSelectedModelId] = useState(group.models[0]?.id ?? '');

  useEffect(() => {
    if (!group.models.some((model) => model.id === selectedModelId)) {
      setSelectedModelId(group.models[0]?.id ?? '');
    }
  }, [group.models, selectedModelId]);

  const selectedModel =
    group.models.find((model) => model.id === selectedModelId) ?? group.models[0];
  const selectedMetadata = selectedModel ? metadataByModelId[selectedModel.id] : undefined;
  const inputs = selectedMetadata?.inputs ?? selectedModel?.variant.inputMetadata;
  const outputs = selectedMetadata?.outputs ?? selectedModel?.variant.outputMetadata;
  const totalSize = useMemo(
    () => group.models.reduce((sum, model) => sum + getModelSize(model), 0),
    [group.models],
  );
  const backends = useMemo(
    () =>
      Array.from(new Set(group.models.flatMap((model) => model.variant.supportedBackends))).join(
        ' / ',
      ),
    [group.models],
  );
  const locations = new Set(
    group.models.map((model) => (model.storageMountId ? 'Mounted' : 'Browser')),
  );
  const locationLabel = locations.size === 1 ? Array.from(locations)[0] : 'Multiple locations';
  const firstModel = group.models[0];

  if (!firstModel || !selectedModel) return null;

  return (
    <div
      className={`overflow-hidden rounded-xl border bg-black/20 transition-colors ${
        expanded ? 'border-white/20' : 'border-white/10 hover:border-white/15'
      }`}
    >
      <ModelLibraryCardHeader
        name={group.name}
        originLabel={getOriginLabel(firstModel)}
        targetLabel={group.targetLabel}
        badges={[
          `${group.models.length} variant${group.models.length === 1 ? '' : 's'}`,
          formatBytes(totalSize),
          backends,
          locationLabel,
        ]}
        repoName={group.repoName}
        expanded={expanded}
        consumers={consumers}
        onToggle={onToggle}
      />

      {expanded ? (
        <div className="border-t border-white/[0.07] px-3 pb-3 pt-3">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-gray-600">
            Variants
          </p>
          <div className="mt-2 grid gap-1.5 md:grid-cols-2 xl:grid-cols-3">
            {group.models.map((model) => {
              const selected = model.id === selectedModel.id;
              const metadata = metadataByModelId[model.id];
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => setSelectedModelId(model.id)}
                  className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                    selected
                      ? 'border-primary-400/30 bg-primary-500/10'
                      : 'border-white/[0.08] bg-white/[0.015] hover:border-white/15'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] font-medium text-gray-200">
                      {model.variant.label}
                    </span>
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        metadata?.error
                          ? 'bg-red-400'
                          : metadata?.loading
                            ? 'bg-amber-300'
                            : 'bg-emerald-400'
                      }`}
                    />
                  </div>
                  <p className="mt-1 truncate text-[9px] uppercase tracking-wide text-gray-600">
                    {formatBytes(getModelSize(model))} ·{' '}
                    {model.variant.supportedBackends.join(' / ')} ·{' '}
                    {model.storageMountId ? 'Mounted' : 'Browser'}
                  </p>
                </button>
              );
            })}
          </div>

          {selectedMetadata?.error ? (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-red-400/15 bg-red-400/5 px-3 py-2 text-[10px] text-red-200">
              <span className="truncate">{selectedMetadata.error}</span>
              <button
                type="button"
                onClick={() => onRetryMetadata(selectedModel)}
                className="shrink-0 font-medium hover:text-white"
              >
                Retry
              </button>
            </div>
          ) : null}

          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            <IoList
              title="Inputs"
              items={inputs}
              fallbackShape={selectedModel.variant.inputShape}
            />
            <IoList
              title="Outputs"
              items={outputs}
              fallbackShape={selectedModel.variant.outputShape}
            />
          </div>

          {selectedModel.externalData?.length ? (
            <div className="mt-2 rounded-lg border border-white/[0.08] bg-white/[0.015] p-3">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-gray-600">
                External data
              </p>
              <div className="mt-2 space-y-1">
                {selectedModel.externalData.map((file) => (
                  <div
                    key={file.path}
                    className="flex items-center justify-between gap-3 font-mono text-[10px] text-gray-500"
                  >
                    <span className="truncate">{file.path.split('/').pop()}</span>
                    <span className="shrink-0">{formatBytes(file.sizeBytes)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/[0.07] pt-3">
            <button
              type="button"
              onClick={() => onRedownload(selectedModel)}
              disabled={downloadActive}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] text-gray-400 transition hover:bg-white/[0.05] hover:text-gray-200 disabled:opacity-50"
            >
              <Icons.RotateLoop className="h-3 w-3" />
              Redownload
            </button>
            <button
              type="button"
              onClick={() => onDelete(selectedModel)}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] text-gray-500 transition hover:bg-red-500/10 hover:text-red-200"
            >
              <Icons.Trash className="h-3 w-3" />
              Delete variant
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
