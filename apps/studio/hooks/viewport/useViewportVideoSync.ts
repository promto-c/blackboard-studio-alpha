import { useEffect, useRef, type RefObject } from 'react';
import { getMediaDescriptor, nodeFlags } from '@/nodes/helpers';
import type { AnyNode } from '@blackboard/types';
import type { TextureCache } from '@/utils/textureCache';

interface UseViewportVideoSyncParams {
  nodes: AnyNode[];
  currentFrame: number;
  isPlaying: boolean;
  playbackDirection?: 1 | -1;
  fps: number;
  textureCacheRef: RefObject<Pick<TextureCache, 'get'>>;
}

/**
 * Synchronises video-like media elements (play/pause, seek) with the
 * current timeline frame. Runs as a side-effect whenever the frame,
 * playback state, or node list changes.
 */
export function useViewportVideoSync({
  nodes,
  currentFrame,
  isPlaying,
  playbackDirection = 1,
  fps,
  textureCacheRef,
}: UseViewportVideoSyncParams): void {
  const syncedVideosRef = useRef(new Set<HTMLVideoElement>());

  useEffect(() => {
    const frameRate = fps || 30;
    const syncedVideos = new Set<HTMLVideoElement>();
    // Adding a small epsilon to ensure we hit the frame start correctly and avoid rounding errors dropping to previous frame
    const targetTime = currentFrame / frameRate + 0.0001;

    nodes.forEach((node) => {
      // Video-like nodes need seeking / play-pause sync
      const flags = nodeFlags(node.type);
      const descriptor = getMediaDescriptor(node.type);
      const isVideoFile = !!(descriptor?.isVideoFile?.(node) ?? flags.isVideoFile);
      if (flags.isMediaNode && isVideoFile) {
        const src = (node as { src?: string }).src;
        if (!src) return;
        // If the frame is already cached, we skip seeking the video element to improve performance
        // The cache is populated by the `seeked` listener in useViewportMediaCache
        const frameKey = `${src}:${Math.round(currentFrame)}`;
        const isCached = !!textureCacheRef.current.get(frameKey);
        const entry = textureCacheRef.current.get(src);
        if (entry?.video) syncedVideos.add(entry.video);

        if (isCached) {
          // Cached CanvasTextures are the authoritative playback source. Stop
          // any hidden live video from continuing to decode the same frames.
          if (entry?.video && !entry.video.paused) entry.video.pause();
          return;
        }

        if (!entry || !entry.video) return;

        const video = entry.video;
        // Only seek if we are outside the tolerance threshold to prevent micro-stutters during playback
        if (Math.abs(video.currentTime - targetTime) > 0.5 / frameRate) {
          video.currentTime = targetTime;
        }

        if (isPlaying && playbackDirection > 0 && video.paused) {
          video.play().catch(() => {});
        } else if ((!isPlaying || playbackDirection < 0) && !video.paused) {
          video.pause();
        }
      }
    });

    syncedVideosRef.current.forEach((video) => {
      if (!syncedVideos.has(video) && !video.paused) video.pause();
    });
    syncedVideosRef.current = syncedVideos;
  }, [currentFrame, isPlaying, playbackDirection, nodes, fps, textureCacheRef]);

  useEffect(
    () => () => {
      syncedVideosRef.current.forEach((video) => {
        if (!video.paused) video.pause();
      });
      syncedVideosRef.current.clear();
    },
    [],
  );
}
