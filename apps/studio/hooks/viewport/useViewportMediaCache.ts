import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { getAsset } from '@/state/assetStorage';
import { NodeType, type AnyNode, type ImageSequenceNode, type VideoNode } from '@blackboard/types';
import { createExrTexture } from '@/utils/exr';
import {
  type MediaBlobLike,
  getBlobName,
  isExrFileLike,
  isVideoFileLike,
} from '@/utils/mediaFiles';
import { TextureCache } from '@/utils/textureCache';
import { getRecommendedCacheSizeMB, usePreferences } from '@/state/preferencesContext';
import { getInputPorts, nodeFlags, getNodeAssetIds } from '@/effects/effectHelpers';

interface CacheStatus {
  memoryUsed: number;
  memoryLimit: number;
  cachedFrames: boolean[];
  cachingFrames: boolean[];
}

interface UseViewportMediaCacheOptions {
  nodes: AnyNode[];
  currentFrame: number;
  selectedNode?: AnyNode;
  maxFrames: number;
  updateCacheStatus: (status: CacheStatus) => void;
  fps?: number;
}

const getNumericUniformValue = (node: AnyNode, uniformName: string | undefined): number | null => {
  if (!uniformName || !('uniforms' in node)) return null;
  const value = (node as { uniforms?: Record<string, { value?: unknown }> }).uniforms?.[uniformName]
    ?.value;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const isTemporalInputPort = (port: ReturnType<typeof getInputPorts>[number]): boolean =>
  typeof port.frameOffset === 'number' ||
  typeof port.absoluteFrame === 'number' ||
  !!port.frameOffsetUniform ||
  !!port.absoluteFrameUniform;

export const useViewportMediaCache = ({
  nodes,
  currentFrame,
  selectedNode,
  maxFrames,
  updateCacheStatus,
  fps = 30,
}: UseViewportMediaCacheOptions) => {
  const {
    maxCacheSizeMB,
    maxCachedFrames,
    cacheBudgetMode,
    backgroundPrefetchMode,
    backgroundPrefetchFrameWindow,
  } = usePreferences();
  const effectiveMaxCacheSizeMB =
    cacheBudgetMode === 'auto_memory' ? getRecommendedCacheSizeMB() : maxCacheSizeMB;
  const effectiveFrameLimit = cacheBudgetMode === 'frame_count' ? maxCachedFrames : null;
  const textureCacheRef = useRef(new TextureCache(effectiveMaxCacheSizeMB, effectiveFrameLimit));
  const textureLoaderRef = useRef(new THREE.TextureLoader());
  const pendingLoadsRef = useRef(new Map<string, Promise<void>>());
  const pendingVideoFrameLoadsRef = useRef(new Map<string, Promise<void>>());
  const pendingVideoFramesRef = useRef(new Set<string>());
  const pendingVideoFrameBySrcRef = useRef(new Map<string, string>());
  const [mediaUpdateTrigger, setMediaUpdateTrigger] = useState(0);

  // Keep FPS in a ref to access it inside the cached loadAsset function without re-creating it
  const fpsRef = useRef(fps);
  useEffect(() => {
    fpsRef.current = fps;
  }, [fps]);

  const bumpMediaUpdateTrigger = useCallback(() => {
    setMediaUpdateTrigger((value) => value + 1);
  }, []);

  // Update cache limit if preference changes
  useEffect(() => {
    textureCacheRef.current.setLimit(effectiveMaxCacheSizeMB);
    textureCacheRef.current.setFrameLimit(effectiveFrameLimit);
    bumpMediaUpdateTrigger();
  }, [bumpMediaUpdateTrigger, effectiveFrameLimit, effectiveMaxCacheSizeMB]);

  const assetIdsInProject = useMemo(() => {
    const ids = new Set<string>();
    nodes.forEach((node) => {
      getNodeAssetIds(node).forEach((id) => ids.add(id));
    });
    return ids;
  }, [nodes]);

  const sequenceNodes = useMemo(() => {
    return nodes.filter((node) => node.type === NodeType.IMAGE_SEQUENCE) as ImageSequenceNode[];
  }, [nodes]);
  const videoNodes = useMemo(() => {
    return nodes.filter((node) => node.type === NodeType.VIDEO) as VideoNode[];
  }, [nodes]);
  const activeTimelineCacheNode = useMemo(() => {
    if (selectedNode?.type === NodeType.IMAGE_SEQUENCE || selectedNode?.type === NodeType.VIDEO) {
      return selectedNode as ImageSequenceNode | VideoNode;
    }
    return sequenceNodes[0] ?? videoNodes[0];
  }, [selectedNode, sequenceNodes, videoNodes]);

  const getSequenceFrameIndex = useCallback((node: ImageSequenceNode, frame: number) => {
    if (node.frames.length === 0) return null;
    const idx = Math.floor(frame) % node.frames.length;
    return (idx + node.frames.length) % node.frames.length;
  }, []);
  const getVideoFrameKey = useCallback((src: string, frame: number) => {
    return `${src}:${Math.round(frame)}`;
  }, []);

  const buildTimelineStatus = useCallback(
    (assetIds: string[], predicate: (assetId: string) => boolean) => {
      if (assetIds.length === 0) return [];
      let status = assetIds.map((assetId) => predicate(assetId));
      if (maxFrames > assetIds.length) {
        const baseStatus = status;
        status = new Array(maxFrames + 1).fill(false);
        for (let i = 0; i <= maxFrames; i += 1) {
          status[i] = baseStatus[i % assetIds.length];
        }
      }
      return status;
    },
    [maxFrames],
  );
  const buildVideoTimelineStatus = useCallback(
    (src: string, predicate: (frameKey: string) => boolean) => {
      if (!src) return [];
      const status = new Array(maxFrames + 1).fill(false);
      for (let frame = 0; frame <= maxFrames; frame += 1) {
        status[frame] = predicate(getVideoFrameKey(src, frame));
      }
      return status;
    },
    [getVideoFrameKey, maxFrames],
  );

  const captureVideoFrame = useCallback(
    (src: string, video: HTMLVideoElement) => {
      const cache = textureCacheRef.current;
      const currentFps = fpsRef.current || 30;
      const frame = Math.round(video.currentTime * currentFps);
      const frameKey = getVideoFrameKey(src, frame);

      if (!cache.get(frameKey)) {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0);
          const frameTex = new THREE.CanvasTexture(canvas);
          frameTex.colorSpace = THREE.NoColorSpace;
          frameTex.minFilter = THREE.LinearFilter;
          frameTex.magFilter = THREE.LinearFilter;
          frameTex.generateMipmaps = false;

          cache.add(frameKey, frameTex, undefined, undefined, frame);
        }
      }

      return frame;
    },
    [getVideoFrameKey],
  );

  const setPendingVideoFrame = useCallback(
    (src: string, frame: number | null) => {
      const pendingVideoFrames = pendingVideoFramesRef.current;
      const pendingVideoFrameBySrc = pendingVideoFrameBySrcRef.current;
      const previousKey = pendingVideoFrameBySrc.get(src);
      const nextKey = frame === null ? null : getVideoFrameKey(src, frame);
      if (previousKey === nextKey) return;

      if (previousKey) {
        pendingVideoFrames.delete(previousKey);
        pendingVideoFrameBySrc.delete(src);
      }

      if (nextKey) {
        pendingVideoFrames.add(nextKey);
        pendingVideoFrameBySrc.set(src, nextKey);
      }

      bumpMediaUpdateTrigger();
    },
    [bumpMediaUpdateTrigger, getVideoFrameKey],
  );

  const loadAsset = useCallback(
    async (src: string, frameIndex?: number) => {
      const cache = textureCacheRef.current;
      if (!src) return;
      if (cache.get(src)) return;

      const existingLoad = pendingLoadsRef.current.get(src);
      if (existingLoad) {
        await existingLoad;
        return;
      }

      const pendingLoad = (async () => {
        let objectUrl: string | null = null;
        try {
          const blob = await getAsset(src);
          if (!blob) return;
          const assetBlob = blob as MediaBlobLike;

          if (isVideoFileLike(assetBlob, getBlobName(assetBlob))) {
            const createdUrl = URL.createObjectURL(blob);
            objectUrl = createdUrl;
            const video = document.createElement('video');
            video.src = createdUrl;
            video.muted = true;
            video.playsInline = true;
            video.loop = true;
            video.style.display = 'none';
            document.body.appendChild(video);

            await new Promise<void>((resolve, reject) => {
              video.onloadeddata = () => resolve();
              video.onerror = () => reject(new Error('Video failed to load.'));
              video.load();
            });

            const texture = new THREE.VideoTexture(video);
            // Use NoColorSpace to ensure raw data access; color mgmt is handled in shaders
            texture.colorSpace = THREE.NoColorSpace;

            const onSeeking = () => {
              const currentFps = fpsRef.current || 30;
              setPendingVideoFrame(src, Math.round(video.currentTime * currentFps));
            };
            const onSeeked = () => {
              // Snapshot the current frame to cache for better performance
              captureVideoFrame(src, video);

              setPendingVideoFrame(src, null);
              texture.needsUpdate = true;
              bumpMediaUpdateTrigger();
            };

            video.addEventListener('seeking', onSeeking);
            video.addEventListener('seeked', onSeeked);

            cache.add(src, texture, video, createdUrl);

            // Seek to the start to guarantee the first frame is fully decoded
            // before the render loop picks up this texture. Without this,
            // QuickTime / H.264 videos may not have a painted frame after
            // `loadeddata`, causing a black viewport on first load.
            // The `onSeeked` handler will call `bumpMediaUpdateTrigger` once
            // the frame is actually decoded, so we skip the immediate bump
            // for video assets.
            setPendingVideoFrame(src, 0);
            video.currentTime = 0;
          } else if (isExrFileLike(assetBlob, getBlobName(assetBlob))) {
            const texture = await createExrTexture(assetBlob, { cacheKey: src });
            cache.add(src, texture, undefined, undefined, frameIndex);
            bumpMediaUpdateTrigger();
          } else {
            const createdUrl = URL.createObjectURL(blob);
            objectUrl = createdUrl;
            const texture = await new Promise<THREE.Texture>((resolve, reject) => {
              textureLoaderRef.current.load(
                createdUrl,
                (tex) => {
                  // Use NoColorSpace to ensure raw data access; color mgmt is handled in shaders
                  tex.colorSpace = THREE.NoColorSpace;
                  resolve(tex);
                },
                undefined,
                (error) => reject(error),
              );
            });
            cache.add(src, texture, undefined, createdUrl, frameIndex);
            bumpMediaUpdateTrigger();
          }
        } catch (error) {
          if (objectUrl) {
            URL.revokeObjectURL(objectUrl);
          }
          console.error('Failed to load asset into viewport cache:', src, error);
        } finally {
          pendingLoadsRef.current.delete(src);
          bumpMediaUpdateTrigger();
        }
      })();

      pendingLoadsRef.current.set(src, pendingLoad);
      bumpMediaUpdateTrigger();
      await pendingLoad;
    },
    [bumpMediaUpdateTrigger, captureVideoFrame, setPendingVideoFrame],
  );

  const requestVideoFrame = useCallback(
    async (src: string, frame: number) => {
      if (!src) return;

      const roundedFrame = Math.round(frame);
      const frameKey = getVideoFrameKey(src, roundedFrame);
      if (textureCacheRef.current.has(frameKey)) return;

      const existingLoad = pendingVideoFrameLoadsRef.current.get(frameKey);
      if (existingLoad) {
        await existingLoad;
        return;
      }

      const pendingLoad = (async () => {
        let objectUrl: string | null = null;
        let video: HTMLVideoElement | null = null;

        try {
          setPendingVideoFrame(src, roundedFrame);

          const blob = await getAsset(src);
          if (!blob) return;

          objectUrl = URL.createObjectURL(blob);
          video = document.createElement('video');
          video.src = objectUrl;
          video.muted = true;
          video.playsInline = true;
          video.preload = 'auto';
          video.crossOrigin = 'anonymous';

          await new Promise<void>((resolve, reject) => {
            video.onloadeddata = () => resolve();
            video.onerror = () => reject(new Error('Video failed to load.'));
            video.load();
          });

          const currentFps = fpsRef.current || 30;
          const targetTime = Math.max(
            0,
            Math.min(roundedFrame / currentFps + 0.0001, video.duration || Infinity),
          );
          const tolerance = 0.5 / currentFps;

          if (Math.abs(video.currentTime - targetTime) > tolerance) {
            await new Promise<void>((resolve, reject) => {
              video.onseeked = () => resolve();
              video.onerror = () => reject(new Error('Video failed to seek.'));
              video.currentTime = targetTime;
            });
          }

          if (textureCacheRef.current.has(frameKey)) return;

          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;

          ctx.drawImage(video, 0, 0);
          const frameTex = new THREE.CanvasTexture(canvas);
          frameTex.colorSpace = THREE.NoColorSpace;
          frameTex.minFilter = THREE.LinearFilter;
          frameTex.magFilter = THREE.LinearFilter;
          frameTex.generateMipmaps = false;
          textureCacheRef.current.add(frameKey, frameTex, undefined, undefined, roundedFrame);
        } catch (error) {
          console.error('Failed to capture temporal video frame:', src, roundedFrame, error);
        } finally {
          setPendingVideoFrame(src, null);
          pendingVideoFrameLoadsRef.current.delete(frameKey);
          if (video) {
            video.pause();
            video.src = '';
            video.load();
          }
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          bumpMediaUpdateTrigger();
        }
      })();

      pendingVideoFrameLoadsRef.current.set(frameKey, pendingLoad);
      bumpMediaUpdateTrigger();
      await pendingLoad;
    },
    [bumpMediaUpdateTrigger, getVideoFrameKey, setPendingVideoFrame],
  );

  useEffect(() => {
    nodes.forEach((node) => {
      const flags = nodeFlags(node.type);
      if (flags.isMediaNode && !flags.isLooping) {
        // Static media (images) — load by src
        const src = (node as any).src;
        if (src) loadAsset(src);
      } else if (flags.isMediaNode && flags.isLooping && (node as any).src) {
        // Video-like — load by src (seeking handled separately)
        loadAsset((node as any).src);
      }
    });
  }, [nodes, loadAsset]);

  useEffect(() => {
    if (sequenceNodes.length === 0) return;
    const frameIndex = Math.floor(currentFrame);
    sequenceNodes.forEach((node) => {
      const idx = getSequenceFrameIndex(node, frameIndex);
      if (idx === null) return;
      loadAsset(node.frames[idx], idx);
    });
  }, [sequenceNodes, currentFrame, getSequenceFrameIndex, loadAsset]);

  useEffect(() => {
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    let previousMediaNode: AnyNode | null = null;

    nodes.forEach((node) => {
      const fallbackSourceNode = previousMediaNode;
      const inputs = (node as { inputs?: Record<string, string> }).inputs;

      getInputPorts(node).forEach((port) => {
        if (port.type !== 'texture') return;

        const sourceNode =
          (inputs?.[port.name] ? nodesById.get(inputs[port.name]) : undefined) ??
          (fallbackSourceNode && isTemporalInputPort(port) ? fallbackSourceNode : undefined);
        if (!sourceNode) return;
        const absoluteUniformValue = getNumericUniformValue(node, port.absoluteFrameUniform);
        const relativeUniformValue = getNumericUniformValue(node, port.frameOffsetUniform);
        const targetFrame =
          absoluteUniformValue !== null
            ? Math.round(absoluteUniformValue)
            : typeof port.absoluteFrame === 'number' && Number.isFinite(port.absoluteFrame)
              ? port.absoluteFrame
              : currentFrame +
                (relativeUniformValue !== null
                  ? Math.round(relativeUniformValue)
                  : (port.frameOffset ?? 0));

        if (sourceNode.type === NodeType.VIDEO) {
          void requestVideoFrame((sourceNode as VideoNode).src, targetFrame);
          return;
        }

        if (sourceNode.type !== NodeType.IMAGE_SEQUENCE) return;

        const sequenceNode = sourceNode as ImageSequenceNode;
        const frameIndex = getSequenceFrameIndex(sequenceNode, targetFrame);
        if (frameIndex === null) return;

        loadAsset(sequenceNode.frames[frameIndex], frameIndex);
      });

      if (nodeFlags(node.type).isMediaNode) {
        previousMediaNode = node;
      }
    });
  }, [currentFrame, getSequenceFrameIndex, loadAsset, nodes, requestVideoFrame]);

  useEffect(() => {
    if (backgroundPrefetchMode === 'on_demand') return;
    if (backgroundPrefetchFrameWindow <= 0) return;
    if (sequenceNodes.length === 0) return;

    const targetNodes =
      selectedNode?.type === NodeType.IMAGE_SEQUENCE
        ? [selectedNode as ImageSequenceNode]
        : sequenceNodes;

    const offsets: number[] = [];
    for (let step = 1; step <= backgroundPrefetchFrameWindow; step += 1) {
      if (backgroundPrefetchMode === 'forward') {
        offsets.push(step);
      } else {
        offsets.push(step, -step);
      }
    }

    const maxCandidates =
      cacheBudgetMode === 'frame_count'
        ? Math.max(0, maxCachedFrames - targetNodes.length)
        : Number.POSITIVE_INFINITY;

    if (maxCandidates === 0) return;

    const scheduled = new Set<string>();
    const candidates: Array<{ assetId: string; frameIndex: number }> = [];

    for (const offset of offsets) {
      for (const node of targetNodes) {
        const frameIndex = getSequenceFrameIndex(node, currentFrame + offset);
        if (frameIndex === null) continue;

        const assetId = node.frames[frameIndex];
        if (!assetId || scheduled.has(assetId)) continue;
        if (textureCacheRef.current.has(assetId) || pendingLoadsRef.current.has(assetId)) continue;

        scheduled.add(assetId);
        candidates.push({ assetId, frameIndex });

        if (candidates.length >= maxCandidates) break;
      }

      if (candidates.length >= maxCandidates) break;
    }

    if (candidates.length === 0) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        for (const candidate of candidates) {
          if (cancelled) return;
          await loadAsset(candidate.assetId, candidate.frameIndex);
          if (cancelled) return;
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, 0);
          });
        }
      })();
    }, 40);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    backgroundPrefetchMode,
    backgroundPrefetchFrameWindow,
    cacheBudgetMode,
    currentFrame,
    getSequenceFrameIndex,
    loadAsset,
    maxCachedFrames,
    selectedNode,
    sequenceNodes,
  ]);

  useEffect(() => {
    textureCacheRef.current.prune(assetIdsInProject);
  }, [assetIdsInProject]);

  useEffect(() => {
    const activeVideoSrcs = new Set(videoNodes.map((node) => node.src).filter(Boolean));
    let changed = false;

    pendingVideoFrameBySrcRef.current.forEach((frameKey, src) => {
      if (activeVideoSrcs.has(src)) return;
      pendingVideoFrameBySrcRef.current.delete(src);
      pendingVideoFramesRef.current.delete(frameKey);
      changed = true;
    });

    if (changed) {
      bumpMediaUpdateTrigger();
    }
  }, [bumpMediaUpdateTrigger, videoNodes]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const cache = textureCacheRef.current;
      const memoryStatus = cache.getMemoryStatus();

      let cachedFrames: boolean[] = [];
      let cachingFrames: boolean[] = [];
      if (activeTimelineCacheNode?.type === NodeType.IMAGE_SEQUENCE) {
        cachedFrames = buildTimelineStatus(activeTimelineCacheNode.frames, (assetId) =>
          cache.has(assetId),
        );
        cachingFrames = buildTimelineStatus(activeTimelineCacheNode.frames, (assetId) => {
          return pendingLoadsRef.current.has(assetId) && !cache.has(assetId);
        });
      } else if (activeTimelineCacheNode?.type === NodeType.VIDEO) {
        const { src } = activeTimelineCacheNode;
        cachedFrames = buildVideoTimelineStatus(src, (frameKey) => cache.has(frameKey));
        cachingFrames = buildVideoTimelineStatus(src, (frameKey) => {
          return pendingVideoFramesRef.current.has(frameKey) && !cache.has(frameKey);
        });
      }

      updateCacheStatus({
        memoryUsed: memoryStatus.used,
        memoryLimit: memoryStatus.limit,
        cachedFrames,
        cachingFrames,
      });
    }, 120);

    return () => clearTimeout(timer);
  }, [
    activeTimelineCacheNode,
    buildTimelineStatus,
    buildVideoTimelineStatus,
    mediaUpdateTrigger,
    updateCacheStatus,
  ]);

  return { textureCacheRef, mediaUpdateTrigger, bumpMediaUpdateTrigger };
};
