import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as Icons from '@blackboard/icons';
import type { MediaColorManagement, Scene3DAssetReference } from '@blackboard/types';
import { usePlayback } from '@/hooks/usePlayback';
import { ColorManagedImagePreview } from './ColorManagedImagePreview';
import { ColorManagedVideoPreview } from './ColorManagedVideoPreview';
import { ExecuteButton } from './ExecuteButton';

const Scene3DAssetPreview = lazy(() => import('./Scene3DAssetPreview'));

export type AssetViewerMediaKind = 'image' | 'image_sequence' | 'video' | 'model_3d';

export interface AssetViewerMedia {
  id: string;
  assetId: string;
  mediaKind?: AssetViewerMediaKind;
  frames?: string[];
  width?: number;
  height?: number;
  duration?: number;
  fps?: number;
  label?: string;
  detail?: string;
  source?: string;
  createdAt?: number;
  mediaColorManagement?: MediaColorManagement;
  scene3dAsset?: Scene3DAssetReference;
}

interface PlaybackState {
  isPlaying: boolean;
  playbackDirection: 1 | -1;
  fps: number;
  currentFrame: number;
  maxFrames: number;
}

interface AssetViewerProps {
  media: AssetViewerMedia | null;
  className?: string;
  onOpenProject?: () => void;
  autoDetectDisplayView?: boolean;
}

const formatDuration = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

const formatFrameLabel = (frame: number, maxFrames: number): string =>
  `${Math.min(frame + 1, maxFrames + 1)} / ${maxFrames + 1}`;

const viewerButtonClass =
  'flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-gray-200 transition hover:border-white/25 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40';

const resolveFrameAssetIds = (media: AssetViewerMedia | null): string[] => {
  if (!media?.assetId) return [];
  if (media.mediaKind === 'image_sequence') {
    const frames = media.frames?.filter(Boolean) ?? [];
    return frames.length > 0 ? frames : [media.assetId];
  }
  return [media.assetId];
};

export function AssetViewer({
  media,
  className = '',
  onOpenProject,
  autoDetectDisplayView = false,
}: AssetViewerProps) {
  const frameAssetIds = useMemo(() => resolveFrameAssetIds(media), [media]);
  const mediaKind = media?.mediaKind ?? 'image';
  const isSequence = mediaKind === 'image_sequence' && frameAssetIds.length > 1;
  const isVideo = mediaKind === 'video';
  const isModel3D = mediaKind === 'model_3d';
  const fps = Math.max(1, Math.round(media?.fps ?? 30));
  const renderLockRef = useRef(false);

  const [playbackState, setPlaybackState] = useState<PlaybackState>(() => ({
    isPlaying: false,
    playbackDirection: 1,
    fps,
    currentFrame: 0,
    maxFrames: Math.max(0, frameAssetIds.length - 1),
  }));
  const playbackStateRef = useRef(playbackState);
  playbackStateRef.current = playbackState;

  const playbackStore = useMemo(
    () => ({
      getState: () => playbackStateRef.current,
      setState: (fn: (prev: PlaybackState) => Partial<PlaybackState>) => {
        setPlaybackState((prev) => {
          const next = { ...prev, ...fn(prev) };
          playbackStateRef.current = next;
          return next;
        });
      },
    }),
    [],
  );

  usePlayback(
    playbackStore,
    isSequence && playbackState.isPlaying,
    'realtime',
    renderLockRef,
    'loop',
  );

  useEffect(() => {
    const nextState: PlaybackState = {
      isPlaying: false,
      playbackDirection: 1,
      fps,
      currentFrame: 0,
      maxFrames: Math.max(0, frameAssetIds.length - 1),
    };
    playbackStateRef.current = nextState;
    setPlaybackState(nextState);
  }, [fps, frameAssetIds, media?.id]);

  const currentFrame = Math.min(playbackState.currentFrame, Math.max(0, frameAssetIds.length - 1));
  const frameAssetId = frameAssetIds[currentFrame] ?? null;
  const stopSequencePlayback = () => {
    setPlaybackState((prev) => {
      const next = { ...prev, isPlaying: false };
      playbackStateRef.current = next;
      return next;
    });
  };

  const seekSequenceFrame = (frame: number) => {
    setPlaybackState((prev) => {
      const maxFrames = Math.max(0, frameAssetIds.length - 1);
      const next = {
        ...prev,
        isPlaying: false,
        currentFrame: Math.max(0, Math.min(maxFrames, frame)),
      };
      playbackStateRef.current = next;
      return next;
    });
  };

  const toggleSequencePlayback = () => {
    setPlaybackState((prev) => {
      const next = { ...prev, isPlaying: !prev.isPlaying, playbackDirection: 1 as const };
      playbackStateRef.current = next;
      return next;
    });
  };

  const displayTitle = media?.label || media?.detail || 'Gallery preview';
  const dimensions = media?.width && media.height ? `${media.width} x ${media.height}` : null;
  const durationLabel = isVideo && media?.duration ? formatDuration(media.duration) : null;
  const typeLabel = isModel3D
    ? media?.scene3dAsset?.kind === 'splat'
      ? 'Gaussian splat'
      : '3D model'
    : isVideo
      ? 'Video'
      : isSequence
        ? 'Image sequence'
        : 'Image';

  return (
    <section
      className={`flex min-h-0 flex-col overflow-hidden rounded-lg border border-white/10 bg-gray-950/80 ${className}`}
    >
      <div className="flex min-h-0 flex-1 items-center justify-center bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.06),transparent_38%),linear-gradient(45deg,rgba(255,255,255,0.035)_25%,transparent_25%,transparent_75%,rgba(255,255,255,0.035)_75%),linear-gradient(45deg,rgba(255,255,255,0.035)_25%,transparent_25%,transparent_75%,rgba(255,255,255,0.035)_75%)] bg-[length:auto,24px_24px,24px_24px] bg-[position:center,0_0,12px_12px] p-3">
        {!media ? (
          <div className="flex flex-col items-center gap-3 text-center text-gray-500">
            <Icons.Photo className="h-10 w-10" />
            <p className="text-sm font-medium text-gray-300">Select a gallery item</p>
          </div>
        ) : isModel3D && media.scene3dAsset ? (
          <Suspense
            fallback={
              <div className="flex h-full w-full items-center justify-center text-gray-500">
                <Icons.CubeTransparent className="h-8 w-8 animate-pulse text-cyan-300" />
              </div>
            }
          >
            <Scene3DAssetPreview asset={media.scene3dAsset} />
          </Suspense>
        ) : isModel3D ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center">
            <Icons.CubeTransparent className="h-8 w-8 text-rose-300" />
            <p className="text-xs text-rose-200">This gallery item has no 3D asset metadata.</p>
          </div>
        ) : isVideo ? (
          media.width && media.height && media.mediaColorManagement ? (
            <ColorManagedVideoPreview
              key={media.id}
              assetId={media.assetId}
              width={media.width}
              height={media.height}
              fps={media.fps}
              mediaColorManagement={media.mediaColorManagement}
              className="h-full"
              autoDetectDisplayView={autoDetectDisplayView}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center px-6 text-center text-xs text-rose-200">
              Video preview requires dimensions and an explicit color assignment.
            </div>
          )
        ) : frameAssetId && media.width && media.height && media.mediaColorManagement ? (
          <ColorManagedImagePreview
            assetId={frameAssetId}
            width={media.width}
            height={media.height}
            mediaColorManagement={media.mediaColorManagement}
            className="h-full w-full"
            autoDetectDisplayView={autoDetectDisplayView}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-gray-500">
            <Icons.CubeTransparent className="h-8 w-8 animate-pulse text-primary-300" />
          </div>
        )}
      </div>

      <div className="border-t border-white/10 bg-gray-950/95 px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/[0.06] text-gray-300">
                {isModel3D ? (
                  media.scene3dAsset?.kind === 'splat' ? (
                    <Icons.Sparkles className="h-3.5 w-3.5" />
                  ) : (
                    <Icons.CubeTransparent className="h-3.5 w-3.5" />
                  )
                ) : isVideo ? (
                  <Icons.Video className="h-3.5 w-3.5" />
                ) : isSequence ? (
                  <Icons.FolderOpen className="h-3.5 w-3.5" />
                ) : (
                  <Icons.Photo className="h-3.5 w-3.5" />
                )}
              </span>
              <h2 className="truncate text-sm font-semibold text-gray-100">{displayTitle}</h2>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-500">
              <span>{typeLabel}</span>
              {dimensions ? <span>{dimensions}</span> : null}
              {isSequence ? <span>{frameAssetIds.length} frames</span> : null}
              {durationLabel ? <span>{durationLabel}</span> : null}
              {media?.source ? <span>{media.source}</span> : null}
            </div>
          </div>
          {onOpenProject ? (
            <ExecuteButton
              onClick={onOpenProject}
              variant="prominent"
              icon={false}
              trailingIcon={<Icons.ChevronRight className="h-3.5 w-3.5 shrink-0" />}
              className="min-w-44 !min-h-11"
              actionClassName="justify-between !py-1.5"
            >
              <span className="min-w-0 text-left">
                <span className="block text-xs font-semibold">Open project</span>
                <span className="block text-[9px] font-normal text-primary-200/65">
                  Continue editing in Studio
                </span>
              </span>
            </ExecuteButton>
          ) : null}
        </div>

        {isSequence ? (
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => seekSequenceFrame(0)}
              className={viewerButtonClass}
              title="First frame"
              aria-label="First frame"
            >
              <Icons.SkipStart className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => seekSequenceFrame(currentFrame - 1)}
              className={viewerButtonClass}
              title="Previous frame"
              aria-label="Previous frame"
            >
              <Icons.StepBackward className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={toggleSequencePlayback}
              className={viewerButtonClass}
              title={playbackState.isPlaying ? 'Pause' : 'Play'}
              aria-label={playbackState.isPlaying ? 'Pause' : 'Play'}
            >
              {playbackState.isPlaying ? (
                <Icons.Pause className="h-3.5 w-3.5" />
              ) : (
                <Icons.Play className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => seekSequenceFrame(currentFrame + 1)}
              className={viewerButtonClass}
              title="Next frame"
              aria-label="Next frame"
            >
              <Icons.StepForward className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => seekSequenceFrame(frameAssetIds.length - 1)}
              className={viewerButtonClass}
              title="Last frame"
              aria-label="Last frame"
            >
              <Icons.SkipEnd className="h-3.5 w-3.5" />
            </button>
            <input
              type="range"
              min={0}
              max={Math.max(0, frameAssetIds.length - 1)}
              value={currentFrame}
              onMouseDown={stopSequencePlayback}
              onChange={(event) => seekSequenceFrame(Number(event.target.value))}
              className="min-w-0 flex-1 accent-primary-300"
              aria-label="Frame"
            />
            <span className="w-20 text-right font-mono text-[11px] text-gray-500">
              {formatFrameLabel(currentFrame, Math.max(0, frameAssetIds.length - 1))}
            </span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
