import React from 'react';
import { type GalleryEntry } from '@blackboard/project-store';
import useAssetObjectUrl from '@/hooks/useAssetObjectUrl';
import useAssetPreviewUrl from '@/hooks/useAssetPreviewUrl';
import * as Icons from '@blackboard/icons';

export type { GalleryEntry };
export type GallerySelection = Map<string, GalleryEntry>;

export {
  makeProjectTag,
  makeNodeTag,
  makeWorkflowTag,
  makeBranchTag,
  makeSourceTag,
  getTagValue,
  hasTag,
} from '@blackboard/project-store';

export const formatGalleryTime = (timestamp: number): string =>
  new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export function GalleryCard({
  entry,
  onLoadParams,
  selected,
  selectable,
  onCardClick,
  onToggleSelected,
  loadingParams = false,
}: {
  entry: GalleryEntry;
  onLoadParams?: () => void;
  selected: boolean;
  selectable: boolean;
  onCardClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onToggleSelected: (event: React.MouseEvent<HTMLButtonElement>) => void;
  loadingParams?: boolean;
}) {
  const isVideo = entry.mediaKind === 'video';
  const isSequence = entry.mediaKind === 'image_sequence';
  const isModel3D = entry.mediaKind === 'model_3d';
  const imageUrl = useAssetPreviewUrl(!isVideo && !isModel3D ? (entry.assetId ?? '') : '', 512);
  const videoUrl = useAssetObjectUrl(isVideo ? (entry.assetId ?? null) : null);
  const dimensions = entry.width && entry.height ? `${entry.width} x ${entry.height}` : null;
  const canLoadParams =
    entry.source === 'Comfy' && !!entry.assetId && !entry.deletedAt && !isModel3D;

  return (
    <div
      className={`group overflow-hidden rounded-lg border bg-gray-950/60 text-left transition ${
        selected
          ? 'border-rose-300/70 ring-1 ring-rose-300/40'
          : entry.deletedAt
            ? 'border-rose-300/20 opacity-60'
            : 'border-white/10 hover:border-white/25 hover:bg-white/[0.04]'
      }`}
      title={
        isModel3D
          ? `Open ${entry.label || entry.scene3dAsset?.fileName || '3D output'} in Scene 3D`
          : entry.detail || entry.prompt || entry.label || entry.nodeName
      }
    >
      <button type="button" onClick={onCardClick} className="block w-full text-left">
        <div className="relative aspect-square bg-gray-800">
          {isModel3D ? (
            <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-cyan-950/70 via-gray-900 to-gray-950 text-cyan-200">
              <Icons.CubeTransparent className="h-10 w-10" />
              <span className="mt-2 rounded bg-black/30 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-cyan-100/70">
                {entry.scene3dAsset?.format ?? '3D model'}
              </span>
            </div>
          ) : videoUrl && isVideo ? (
            <video src={videoUrl} className="h-full w-full object-cover" muted playsInline />
          ) : imageUrl ? (
            <img src={imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-gray-500">
              <Icons.Photo className="h-6 w-6" />
            </div>
          )}
          <div className="absolute left-1.5 top-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold text-gray-200">
            {entry.source}
          </div>
          {entry.deletedAt ? (
            <div className="absolute right-1.5 top-1.5 rounded bg-rose-300 px-1.5 py-0.5 text-[10px] font-semibold text-gray-950">
              Bin
            </div>
          ) : null}
          {isVideo || isSequence || isModel3D ? (
            <span className="absolute bottom-1.5 left-1.5 rounded bg-black/70 p-1 text-gray-100">
              {isModel3D ? (
                <Icons.CubeTransparent className="h-3 w-3" />
              ) : isVideo ? (
                <Icons.Video className="h-3 w-3" />
              ) : (
                <Icons.FolderOpen className="h-3 w-3" />
              )}
            </span>
          ) : null}
          {selectable ? (
            <span
              className={`absolute bottom-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded border ${
                selected
                  ? 'border-rose-200 bg-rose-300 text-gray-950'
                  : 'border-white/20 bg-black/60 text-transparent group-hover:text-gray-300'
              }`}
            >
              <Icons.Check className="h-3 w-3" />
            </span>
          ) : null}
        </div>
        <div className="space-y-1 p-2">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="truncate text-xs font-medium text-gray-200">
              {entry.nodeName || 'Unknown'}
            </span>
            <span className="shrink-0 text-[10px] text-gray-500">
              {formatGalleryTime(entry.createdAt)}
            </span>
          </div>
          <p className="line-clamp-2 min-h-8 text-[11px] leading-4 text-gray-400">
            {entry.detail || entry.prompt || entry.label || 'Generated output'}
          </p>
          {dimensions ? <p className="font-mono text-[10px] text-gray-600">{dimensions}</p> : null}
        </div>
      </button>
      {selectable || canLoadParams ? (
        <div className="flex border-t border-white/10">
          {canLoadParams ? (
            <button
              type="button"
              onClick={onLoadParams}
              disabled={loadingParams}
              className="inline-flex min-w-0 flex-1 items-center justify-center gap-1 px-2 py-1 text-[11px] font-medium text-primary-100/70 transition hover:bg-primary-300/10 hover:text-primary-50 disabled:cursor-wait disabled:opacity-60"
              title="Load workflow params from image metadata"
            >
              <Icons.Cog className={`h-3.5 w-3.5 ${loadingParams ? 'animate-spin' : ''}`} />
              <span className="truncate">{loadingParams ? 'Loading' : 'Params'}</span>
            </button>
          ) : null}
          {selectable ? (
            <button
              type="button"
              onClick={onToggleSelected}
              className={`min-w-0 flex-1 px-2 py-1 text-[11px] font-medium text-gray-400 transition hover:bg-white/[0.04] hover:text-gray-100 ${
                canLoadParams ? 'border-l border-white/10' : ''
              }`}
            >
              {selected ? 'Selected' : 'Select'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
