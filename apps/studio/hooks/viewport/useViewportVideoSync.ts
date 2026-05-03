import { useEffect, type MutableRefObject } from 'react';
import { nodeFlags } from '@/effects/effectHelpers';
import type { AnyNode } from '@blackboard/types';

interface CacheEntry {
  texture?: unknown;
  video?: HTMLVideoElement;
}

interface UseViewportVideoSyncParams {
  nodes: AnyNode[];
  currentFrame: number;
  isPlaying: boolean;
  fps: number;
  textureCacheRef: MutableRefObject<Map<string, CacheEntry>>;
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
  fps,
  textureCacheRef,
}: UseViewportVideoSyncParams): void {
  useEffect(() => {
    const frameRate = fps || 30;
    // Adding a small epsilon to ensure we hit the frame start correctly and avoid rounding errors dropping to previous frame
    const targetTime = currentFrame / frameRate + 0.0001;

    nodes.forEach((node) => {
      // Video-like nodes need seeking / play-pause sync
      const flags = nodeFlags(node.type);
      if (flags.isMediaNode && flags.isLooping) {
        const src = (node as any).src;
        if (!src) return;
        // If the frame is already cached, we skip seeking the video element to improve performance
        // The cache is populated by the `seeked` listener in useViewportMediaCache
        const frameKey = `${src}:${Math.round(currentFrame)}`;
        const isCached = !!textureCacheRef.current.get(frameKey);

        if (!isCached) {
          const entry = textureCacheRef.current.get(src);
          if (entry && entry.video) {
            const video = entry.video;
            // Only seek if we are outside the tolerance threshold to prevent micro-stutters during playback
            if (Math.abs(video.currentTime - targetTime) > 0.5 / frameRate) {
              video.currentTime = targetTime;
            }

            if (isPlaying && video.paused) {
              video.play().catch(() => {});
            } else if (!isPlaying && !video.paused) {
              video.pause();
            }
          }
        }
      }
    });
  }, [currentFrame, isPlaying, nodes, fps]);
}
