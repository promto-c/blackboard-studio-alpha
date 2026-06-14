import type { GeneratedOutput } from '@blackboard/types';
import * as Icons from '@blackboard/icons';
import useAssetObjectUrl from '@/hooks/useAssetObjectUrl';
import useAssetPreviewUrl from '@/hooks/useAssetPreviewUrl';

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
  const imageUrl = useAssetPreviewUrl(!isVideo ? output.src : '', 320);
  const videoUrl = useAssetObjectUrl(isVideo ? output.src : null);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative h-14 w-14 shrink-0 overflow-hidden rounded-md border bg-gray-800 transition ${
        active
          ? 'border-primary-300 ring-1 ring-primary-300/50'
          : 'border-white/10 hover:border-white/30'
      }`}
      title={output.prompt || output.label || 'Comfy output'}
      aria-pressed={active}
    >
      {videoUrl && isVideo ? (
        <video src={videoUrl} className="h-full w-full object-cover" muted playsInline />
      ) : imageUrl ? (
        <img src={imageUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-gray-500">
          <Icons.Photo className="h-5 w-5" />
        </div>
      )}
      {isVideo || output.mediaKind === 'image_sequence' ? (
        <span className="absolute bottom-1 left-1 rounded bg-gray-950/75 p-0.5 text-white">
          {isVideo ? <Icons.Video className="h-3 w-3" /> : <Icons.FolderOpen className="h-3 w-3" />}
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
