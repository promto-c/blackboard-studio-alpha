import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import * as Icons from '@blackboard/icons';
import { configureRawStraightAlphaTexture, createStudioRenderer } from '@blackboard/renderer';
import type { MediaColorManagement } from '@blackboard/types';
import { resolveProjectDisplayOutput } from '@/color-management';
import useAssetObjectUrl from '@/hooks/useAssetObjectUrl';
import { renderViewportFrameWithSharedPipeline } from '@/renderer/pipeline';
import { createViewportPipelineResources } from '@/renderer/viewportPipelineResources';
import { useEditorSelector } from '@/state/editorContext';
import { createMediaPreviewGraph } from '@/utils/thumbnailRenderer';
import { createAssetPreviewCacheKey, markAssetPreviewMilestone } from '@/services/assetPreview';

export interface ColorManagedVideoPreviewProps {
  assetId: string;
  width: number;
  height: number;
  mediaColorManagement: MediaColorManagement;
  fps?: number;
  className?: string;
  maxDimension?: number;
}

const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const wholeSeconds = Math.floor(seconds);
  return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, '0')}`;
};

export function ColorManagedVideoPreview({
  assetId,
  width,
  height,
  mediaColorManagement,
  fps = 30,
  className = '',
  maxDimension = 2048,
}: ColorManagedVideoPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const objectUrl = useAssetObjectUrl(assetId);
  const projectColorManagement = useEditorSelector((state) => state.colorManagement);
  const previewSource = useMemo(
    () => ({
      assetId,
      width,
      height,
      mediaKind: 'video' as const,
      mediaColorManagement,
      fps,
    }),
    [assetId, fps, height, mediaColorManagement, width],
  );
  const previewKey = createAssetPreviewCacheKey(previewSource, projectColorManagement, {
    mode: 'viewer-preview',
    maxDimension,
  });
  const renderInputRef = useRef({ previewSource, projectColorManagement });
  renderInputRef.current = { previewSource, projectColorManagement };
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || !objectUrl) return;

    let disposed = false;
    let frameCallback = 0;
    let animationFrame = 0;
    let texture: THREE.VideoTexture | null = null;
    let renderer: THREE.WebGLRenderer | null = null;
    let resources: ReturnType<typeof createViewportPipelineResources> | null = null;
    let previewGraph: ReturnType<typeof createMediaPreviewGraph> | null = null;
    const current = renderInputRef.current;
    const output = resolveProjectDisplayOutput(current.projectColorManagement.viewer);

    const cancelScheduledFrame = () => {
      if (frameCallback && typeof video.cancelVideoFrameCallback === 'function') {
        video.cancelVideoFrameCallback(frameCallback);
      }
      if (animationFrame) cancelAnimationFrame(animationFrame);
      frameCallback = 0;
      animationFrame = 0;
    };

    const renderFrame = () => {
      if (disposed || !renderer || !resources || !texture) return;
      if (!previewGraph) return;

      try {
        const result = renderViewportFrameWithSharedPipeline({
          resources,
          nodes: previewGraph.nodes,
          sceneNode: previewGraph.sceneNode,
          frame: video.currentTime * (current.previewSource.fps ?? 30),
          viewerSettings: output.viewerSettings!,
          displayView: output.displayView!,
          projectColorManagement: current.projectColorManagement,
          getMediaTexture: () => texture ?? undefined,
          getTextTexture: () => undefined,
        });
        resources.renderTargets = result.renderTargets;
        setCurrentTime(video.currentTime);
        markAssetPreviewMilestone('viewerPreviewMs');
      } catch (cause) {
        video.pause();
        setError(cause instanceof Error ? cause.message : 'Could not render video preview.');
      }
    };

    const scheduleFrame = () => {
      cancelScheduledFrame();
      if (disposed || video.paused || video.ended) return;
      if (typeof video.requestVideoFrameCallback === 'function') {
        frameCallback = video.requestVideoFrameCallback(() => {
          frameCallback = 0;
          renderFrame();
          scheduleFrame();
        });
      } else {
        animationFrame = requestAnimationFrame(() => {
          animationFrame = 0;
          renderFrame();
          scheduleFrame();
        });
      }
    };

    const initialize = () => {
      if (texture || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      try {
        renderer = createStudioRenderer({
          canvas,
          alpha: true,
          preserveDrawingBuffer: true,
          antialias: false,
          depth: false,
          stencil: false,
        });
        resources = createViewportPipelineResources(renderer);
        texture = configureRawStraightAlphaTexture(new THREE.VideoTexture(video));
        previewGraph = createMediaPreviewGraph(
          {
            ...current.previewSource,
            width: video.videoWidth || current.previewSource.width,
            height: video.videoHeight || current.previewSource.height,
          },
          current.projectColorManagement,
          maxDimension,
        );
        setDuration(Number.isFinite(video.duration) ? video.duration : 0);
        setError(null);
        renderFrame();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not initialize video preview.');
      }
    };

    const handleLoadedData = () => initialize();
    const handleSeeked = () => renderFrame();
    const handlePlay = () => {
      setIsPlaying(true);
      scheduleFrame();
    };
    const handlePause = () => {
      setIsPlaying(false);
      cancelScheduledFrame();
      renderFrame();
    };
    const handleEnded = () => {
      setIsPlaying(false);
      cancelScheduledFrame();
      renderFrame();
    };
    const handleError = () => setError('Could not decode this video asset.');

    video.addEventListener('loadeddata', handleLoadedData);
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('error', handleError);
    video.load();
    initialize();

    return () => {
      disposed = true;
      cancelScheduledFrame();
      video.pause();
      video.removeEventListener('loadeddata', handleLoadedData);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('error', handleError);
      texture?.dispose();
      resources?.dispose();
      renderer?.dispose();
    };
  }, [maxDimension, objectUrl, previewKey]);

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  };

  const seek = (nextTime: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  return (
    <div className={`flex min-h-0 w-full flex-col ${className}`}>
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <canvas ref={canvasRef} className="max-h-full max-w-full rounded-md object-contain" />
        <video
          ref={videoRef}
          src={objectUrl ?? undefined}
          className="hidden"
          muted
          playsInline
          loop
          preload="metadata"
        />
        {error ? (
          <p role="alert" className="px-4 text-center text-xs text-rose-200">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-2 border-t border-white/10 bg-gray-950/90 px-3 py-2">
        <button
          type="button"
          onClick={togglePlayback}
          disabled={!objectUrl || !!error}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-200 transition hover:bg-white/10 disabled:opacity-40"
          title={isPlaying ? 'Pause' : 'Play'}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Icons.Pause className="h-4 w-4" /> : <Icons.Play className="h-4 w-4" />}
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(duration, 0)}
          step="any"
          value={Math.min(currentTime, duration || 0)}
          onChange={(event) => seek(Number(event.target.value))}
          disabled={duration <= 0 || !!error}
          className="min-w-0 flex-1 accent-primary-300"
          aria-label="Video position"
        />
        <span className="w-24 shrink-0 text-right font-mono text-[11px] text-gray-400">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>
    </div>
  );
}
