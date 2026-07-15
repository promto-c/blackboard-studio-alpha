import React from 'react';
import { type GalleryEntry } from '@blackboard/project-store';
import { Badge } from '@blackboard/ui';
import { GALLERY_THUMBNAIL_MAX_DIMENSION, useAssetPreview } from '@/hooks/useAssetPreviewUrl';
import { useViewportProximity } from '@/hooks/useNearViewport';
import { markAssetPreviewMilestone } from '@/services/assetPreview';
import { createInAppMediaDragPayload, writeInAppMediaDrag } from '@/utils/inAppMediaDrag';
import * as Icons from '@blackboard/icons';

export type { GalleryEntry };
export type { GallerySelection } from './gallerySelection';

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
  paramsTargetName,
  selected,
  selectable,
  onCardClick,
  loadingParams = false,
  autoDetectDisplayView = false,
}: {
  entry: GalleryEntry;
  onLoadParams?: () => void;
  paramsTargetName?: string;
  selected: boolean;
  selectable: boolean;
  onCardClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  loadingParams?: boolean;
  autoDetectDisplayView?: boolean;
}) {
  const cardRef = React.useRef<HTMLDivElement>(null);
  const [mediaFailed, setMediaFailed] = React.useState(false);
  const proximity = useViewportProximity(cardRef, { rootMargin: '320px' });
  const isVideo = entry.mediaKind === 'video';
  const isSequence = entry.mediaKind === 'image_sequence';
  const isModel3D = entry.mediaKind === 'model_3d';
  const previewSource = React.useMemo(
    () =>
      !isModel3D &&
      entry.assetId &&
      entry.width > 0 &&
      entry.height > 0 &&
      entry.mediaColorManagement
        ? {
            assetId: entry.assetId,
            width: entry.width,
            height: entry.height,
            mediaKind: isVideo ? ('video' as const) : ('image' as const),
            mediaColorManagement: entry.mediaColorManagement,
            fps: entry.fps,
          }
        : null,
    [
      entry.assetId,
      entry.fps,
      entry.height,
      entry.mediaColorManagement,
      entry.width,
      isModel3D,
      isVideo,
    ],
  );
  const preview = useAssetPreview(previewSource, {
    mode: 'gallery-thumbnail',
    maxDimension: GALLERY_THUMBNAIL_MAX_DIMENSION,
    priority: proximity === 'visible' ? 'visible-thumbnail' : 'prefetch-thumbnail',
    enabled: proximity !== 'outside',
    autoDetectDisplayView,
  });
  React.useEffect(() => {
    setMediaFailed(false);
  }, [preview.url]);
  React.useEffect(() => {
    if (proximity === 'visible' && preview.status === 'ready') {
      markAssetPreviewMilestone('firstVisibleThumbnailMs');
    }
  }, [preview.status, proximity]);
  const dimensions = entry.width && entry.height ? `${entry.width} x ${entry.height}` : null;
  const canLoadParams =
    entry.source === 'Comfy' && !!entry.assetId && !entry.deletedAt && !isModel3D;
  const dragPayload = React.useMemo(
    () =>
      entry.deletedAt
        ? null
        : createInAppMediaDragPayload({
            assetId: entry.assetId,
            mediaKind: entry.mediaKind ?? 'image',
            label: entry.label || entry.nodeName,
            width: entry.width,
            height: entry.height,
            duration: entry.duration,
            fps: entry.fps,
            frames: entry.frames,
            colorSpace: entry.colorSpace,
            mediaColorManagement: entry.mediaColorManagement,
            videoColorMetadata: entry.videoColorMetadata,
            scene3dAsset: entry.scene3dAsset,
          }),
    [entry],
  );

  return (
    <div
      ref={cardRef}
      draggable={!!dragPayload}
      onDragStart={(event) => {
        if (!dragPayload) {
          event.preventDefault();
          return;
        }
        writeInAppMediaDrag(event.dataTransfer, dragPayload);
      }}
      className={`group overflow-hidden rounded-lg border bg-gray-950/60 text-left transition ${
        selected
          ? 'border-primary-300/70 bg-primary-300/[0.06] ring-1 ring-primary-300/35'
          : entry.deletedAt
            ? 'border-rose-300/20 opacity-60'
            : 'border-white/10 hover:border-white/25 hover:bg-white/[0.04]'
      } ${dragPayload ? 'cursor-grab active:cursor-grabbing' : ''}`}
      title={
        isModel3D
          ? `Open ${entry.label || entry.scene3dAsset?.fileName || '3D output'} in Scene 3D`
          : entry.detail || entry.prompt || entry.label || entry.nodeName
      }
    >
      <button
        type="button"
        onClick={onCardClick}
        aria-pressed={selected}
        className={`block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-300/45 ${
          dragPayload ? 'cursor-grab active:cursor-grabbing' : ''
        }`}
      >
        <div className="relative aspect-square bg-gray-800">
          {isModel3D ? (
            <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-cyan-950/70 via-gray-900 to-gray-950 text-cyan-200">
              <Icons.CubeTransparent className="h-10 w-10" />
              <span className="mt-2 rounded bg-black/30 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-cyan-100/70">
                {entry.scene3dAsset?.format ?? '3D model'}
              </span>
            </div>
          ) : preview.url && isVideo && !mediaFailed ? (
            <video
              src={preview.url}
              className="h-full w-full object-cover"
              muted
              playsInline
              preload="metadata"
              onError={() => setMediaFailed(true)}
              aria-label={`${entry.label || entry.nodeName || 'Gallery'} video preview`}
            />
          ) : preview.url && !mediaFailed ? (
            <img
              src={preview.url}
              alt=""
              loading="lazy"
              onError={() => setMediaFailed(true)}
              className="h-full w-full object-cover"
            />
          ) : (
            <div
              className="flex h-full w-full items-center justify-center text-gray-500"
              aria-busy={preview.status === 'loading'}
              aria-label={
                preview.status === 'error' || mediaFailed
                  ? 'Preview unavailable'
                  : preview.status === 'loading'
                    ? 'Loading preview'
                    : 'Preview placeholder'
              }
            >
              {preview.status === 'loading' ? (
                <Icons.CubeTransparent className="h-6 w-6 animate-pulse text-primary-300" />
              ) : (
                <Icons.Photo className="h-6 w-6" />
              )}
            </div>
          )}
          <Badge
            size="sm"
            className="absolute left-1.5 top-1.5 text-[10px] font-semibold !bg-black/65 !text-gray-200"
            shrink
            noBorder
          >
            {entry.source}
          </Badge>
          {entry.deletedAt ? (
            <Badge
              size="sm"
              className="absolute right-1.5 top-1.5 text-[10px] font-semibold !bg-rose-300 !text-gray-950"
              shrink
              noBorder
            >
              Bin
            </Badge>
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
                  ? 'border-primary-100 bg-primary-300 text-gray-950 shadow-sm shadow-black/30'
                  : 'border-white/20 bg-black/60 text-transparent opacity-0 transition-opacity group-hover:opacity-100 group-hover:text-gray-300'
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
      {canLoadParams ? (
        <div className="flex border-t border-white/10">
          <button
            type="button"
            onClick={onLoadParams}
            disabled={loadingParams || !onLoadParams}
            className="inline-flex min-w-0 flex-1 items-center justify-center gap-1 px-2 py-1 text-[11px] font-medium text-primary-100/70 transition hover:bg-primary-300/10 hover:text-primary-50 disabled:cursor-wait disabled:opacity-60"
            title={
              paramsTargetName
                ? `Load workflow params into ${paramsTargetName}`
                : 'Select a Comfy node to load these workflow params'
            }
          >
            <Icons.Cog className={`h-3.5 w-3.5 ${loadingParams ? 'animate-spin' : ''}`} />
            <span className="truncate">{loadingParams ? 'Loading' : 'Params'}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
