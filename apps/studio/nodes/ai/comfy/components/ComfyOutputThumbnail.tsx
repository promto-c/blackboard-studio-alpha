import { useMemo } from 'react';
import type { GeneratedOutput } from '@blackboard/types';
import * as Icons from '@blackboard/icons';
import { useAssetPreview } from '@/hooks/useAssetPreviewUrl';
import { createInAppMediaDragPayload, writeInAppMediaDrag } from '@/utils/inAppMediaDrag';

export function ComfyOutputThumbnail({
  output,
  active,
  onClick,
}: {
  output: GeneratedOutput;
  active: boolean;
  onClick: () => void;
}) {
  const isVideo = output.mediaKind === 'video';
  const isModel3D = output.mediaKind === 'model_3d';
  const previewSource = useMemo(
    () =>
      !isModel3D &&
      output.src &&
      output.width > 0 &&
      output.height > 0 &&
      output.mediaColorManagement
        ? {
            assetId: output.src,
            width: output.width,
            height: output.height,
            mediaKind: isVideo ? ('video' as const) : ('image' as const),
            mediaColorManagement: output.mediaColorManagement,
          }
        : null,
    [isModel3D, isVideo, output.height, output.mediaColorManagement, output.src, output.width],
  );
  const preview = useAssetPreview(previewSource, {
    mode: 'gallery-thumbnail',
    maxDimension: 320,
    priority: 'visible-thumbnail',
  });
  const dragPayload = useMemo(
    () =>
      createInAppMediaDragPayload({
        assetId: output.src,
        mediaKind: output.mediaKind ?? 'image',
        label: output.label,
        width: output.width,
        height: output.height,
        duration: output.duration,
        fps: output.fps,
        frames: output.frames,
        colorSpace: output.colorSpace,
        mediaColorManagement: output.mediaColorManagement,
        videoColorMetadata: output.videoColorMetadata,
        scene3dAsset: output.scene3dAsset,
        useOutputSizeAsScene: output.useOutputSizeAsScene,
      }),
    [output],
  );

  return (
    <button
      type="button"
      draggable={!!dragPayload}
      onDragStart={(event) => {
        if (!dragPayload) {
          event.preventDefault();
          return;
        }
        writeInAppMediaDrag(event.dataTransfer, dragPayload);
      }}
      onClick={onClick}
      className={`relative h-14 w-14 shrink-0 overflow-hidden rounded-md border bg-gray-800 transition ${
        active
          ? 'border-primary-300 ring-1 ring-primary-300/50'
          : 'border-white/10 hover:border-white/30'
      } ${dragPayload ? 'cursor-grab active:cursor-grabbing' : ''}`}
      title={
        isModel3D
          ? `Open ${output.label || output.scene3dAsset?.fileName || '3D output'} in Scene 3D`
          : output.prompt || output.label || 'Comfy output'
      }
      aria-pressed={active}
    >
      {isModel3D ? (
        <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-cyan-950/70 to-gray-950 text-cyan-200">
          <Icons.CubeTransparent className="h-6 w-6" />
          <span className="mt-1 max-w-12 truncate text-[8px] font-semibold uppercase tracking-wide text-cyan-100/70">
            {output.scene3dAsset?.format ?? '3D'}
          </span>
        </div>
      ) : preview.url && isVideo ? (
        <video
          src={preview.url}
          className="h-full w-full object-cover"
          muted
          playsInline
          preload="metadata"
          aria-label={output.label || 'Comfy video output'}
        />
      ) : preview.url ? (
        <img src={preview.url} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-gray-500">
          <Icons.Photo className="h-5 w-5" />
        </div>
      )}
      {isVideo || output.mediaKind === 'image_sequence' || isModel3D ? (
        <span className="absolute bottom-1 left-1 rounded bg-gray-950/75 p-0.5 text-white">
          {isModel3D ? (
            <Icons.CubeTransparent className="h-3 w-3" />
          ) : isVideo ? (
            <Icons.Video className="h-3 w-3" />
          ) : (
            <Icons.FolderOpen className="h-3 w-3" />
          )}
        </span>
      ) : null}
      {active ? (
        <span className="absolute right-1 top-1 rounded-full bg-primary-300 p-0.5 text-gray-950">
          <Icons.Check className="h-2.5 w-2.5" />
        </span>
      ) : null}
    </button>
  );
}
