import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { getAsset } from '@/state/assetStorage';
import {
  NodeType,
  type AnyNode,
  type ImageSequenceNode,
  type MediaSourceNode,
} from '@blackboard/types';
import { createExrTexture } from '@/utils/exr';
import {
  type MediaBlobLike,
  getBlobName,
  isExrFileLike,
  isVideoFileLike,
} from '@/utils/mediaFiles';
import { isNonEmptyString, getNonEmptyString } from '@/utils/guards';
import { TextureCache } from '@/utils/textureCache';
import { type BackgroundPrefetchMode, getRecommendedCacheSizeMB } from '@/state/preferences';
import { usePreferences } from '@/state/preferencesContext';
import { getInputPorts, getMediaDescriptor, getNodeAssetIds, nodeFlags } from '@/nodes/helpers';

interface CacheStatus {
  memoryUsed: number;
  memoryLimit: number;
  cachedFrames: boolean[];
  cachingFrames: boolean[];
}

interface VideoDecodeSession {
  video: HTMLVideoElement;
  objectUrl: string;
  ready: Promise<void>;
  queue: Promise<void>;
  disposed: boolean;
}

interface QueuedVideoDecodeWindow {
  src: string;
  frames: number[];
  promise: Promise<void>;
  started: boolean;
  anchorFrame: number;
  priority: VideoFrameRequestPriority;
}

type VideoFrameRequestPriority = 'required' | 'prefetch';

interface VideoFrameRequestOptions {
  priority?: VideoFrameRequestPriority;
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

const isVideoFileNode = (node: AnyNode): boolean => {
  const descriptor = getMediaDescriptor(node.type);
  return !!(descriptor?.isVideoFile?.(node) ?? nodeFlags(node.type).isVideoFile);
};

const getFrameAssetIds = (node: AnyNode): string[] => {
  const frames = (node as { frames?: unknown }).frames;
  return Array.isArray(frames) ? frames.filter(isNonEmptyString) : [];
};

const getFrameAssetIdAt = (node: AnyNode, frame: number): string | null => {
  const frames = getFrameAssetIds(node);
  if (frames.length === 0) return null;
  const index = Math.floor(frame);
  const safeIndex = ((index % frames.length) + frames.length) % frames.length;
  return frames[safeIndex] ?? null;
};

const getNodeSrc = (node: AnyNode): string | null => {
  const src = (node as { src?: unknown }).src;
  return getNonEmptyString(src) ?? null;
};

const getGeneratedOutputAssetIdsAt = (node: AnyNode, frame: number): string[] => {
  const outputs = (node as { generatedOutputs?: unknown }).generatedOutputs;
  if (!Array.isArray(outputs)) return [];

  return outputs.flatMap((output): string[] => {
    if (!output || typeof output !== 'object') return [];
    const candidate = output as { src?: unknown; frames?: unknown; deletedAt?: unknown };
    if (candidate.deletedAt) return [];

    const frames = Array.isArray(candidate.frames) ? candidate.frames.filter(isNonEmptyString) : [];
    if (frames.length > 0) {
      const index = Math.floor(frame);
      const safeIndex = ((index % frames.length) + frames.length) % frames.length;
      return frames[safeIndex] ? [frames[safeIndex]] : [];
    }

    const src = getNonEmptyString(candidate.src);
    return src ? [src] : [];
  });
};

const getVideoFrameCacheKey = (src: string, frame: number) => `${src}:${Math.round(frame)}`;

const getVideoFrameCacheSource = (key: string): string | null => {
  const separatorIndex = key.lastIndexOf(':');
  if (separatorIndex <= 0) return null;
  const frameText = key.slice(separatorIndex + 1);
  if (!/^\d+$/.test(frameText)) return null;
  return key.slice(0, separatorIndex);
};

const getVideoFrameCacheFrame = (key: string): number | null => {
  const separatorIndex = key.lastIndexOf(':');
  if (separatorIndex <= 0) return null;
  const frame = Number.parseInt(key.slice(separatorIndex + 1), 10);
  return Number.isFinite(frame) ? frame : null;
};

const VIDEO_FRAME_WINDOW_BEFORE = 1;
const VIDEO_FRAME_WINDOW_AFTER = 5;
const VIDEO_STALE_FRAME_PADDING = 2;

type PrefetchDirection = 1 | -1;

const isVideoFrameWindowRelevant = (
  frames: number[],
  currentFrame: number,
  backgroundPrefetchFrameWindow: number,
): boolean => {
  const latestFrame = Math.max(0, Math.round(currentFrame));
  const staleDistance =
    Math.max(VIDEO_FRAME_WINDOW_BEFORE, VIDEO_FRAME_WINDOW_AFTER) +
    Math.max(backgroundPrefetchFrameWindow, 0) +
    VIDEO_STALE_FRAME_PADDING;

  return frames.some((targetFrame) => Math.abs(targetFrame - latestFrame) <= staleDistance);
};

const isFrameInsideDecodeWindow = (frames: number[], frame: number): boolean => {
  const roundedFrame = Math.max(0, Math.round(frame));
  return frames.some((targetFrame) => targetFrame === roundedFrame);
};

const buildVideoDecodeWindowFrames = (frame: number, hasPriorityFrame: boolean): number[] => {
  const roundedFrame = Math.max(0, Math.round(frame));
  const start = Math.max(0, roundedFrame - VIDEO_FRAME_WINDOW_BEFORE);
  const end = Math.max(start, roundedFrame + VIDEO_FRAME_WINDOW_AFTER);
  const frames: number[] = [];

  if (hasPriorityFrame) {
    frames.push(roundedFrame);
    for (let candidate = roundedFrame + 1; candidate <= end; candidate += 1) {
      frames.push(candidate);
    }
    for (let candidate = roundedFrame - 1; candidate >= start; candidate -= 1) {
      frames.push(candidate);
    }
    return frames;
  }

  for (let candidate = start; candidate <= end; candidate += 1) {
    frames.push(candidate);
  }
  return frames;
};

const buildBackgroundPrefetchOffsets = (
  mode: BackgroundPrefetchMode,
  frameWindow: number,
  autoDirection: PrefetchDirection,
): number[] => {
  const offsets: number[] = [];
  for (let step = 1; step <= frameWindow; step += 1) {
    if (mode === 'bidirectional') {
      offsets.push(step, -step);
    } else if (mode === 'auto') {
      offsets.push(step * autoDirection);
    } else {
      offsets.push(step);
    }
  }
  return offsets;
};

const disposeVideoDecodeSession = (session: VideoDecodeSession) => {
  session.disposed = true;
  session.video.pause();
  session.video.src = '';
  session.video.load();
  URL.revokeObjectURL(session.objectUrl);
};

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
  const pendingVideoFrameKeysBySrcRef = useRef(new Map<string, Set<string>>());
  const videoDecodeSessionsRef = useRef(new Map<string, VideoDecodeSession>());
  const queuedVideoDecodeWindowsRef = useRef(new Map<number, QueuedVideoDecodeWindow>());
  const canceledVideoDecodeWindowIdsRef = useRef(new Set<number>());
  const nextVideoDecodeWindowIdRef = useRef(1);
  const [mediaUpdateTrigger, setMediaUpdateTrigger] = useState(0);
  const currentFrameRef = useRef(currentFrame);
  const autoPrefetchDirectionRef = useRef<PrefetchDirection>(1);

  // Keep FPS in a ref to access it inside the cached loadAsset function without re-creating it
  const fpsRef = useRef(fps);
  useEffect(() => {
    fpsRef.current = fps;
  }, [fps]);

  useEffect(() => {
    const previousFrame = currentFrameRef.current;
    if (currentFrame > previousFrame) {
      autoPrefetchDirectionRef.current = 1;
    } else if (currentFrame < previousFrame) {
      autoPrefetchDirectionRef.current = -1;
    }
    currentFrameRef.current = currentFrame;
  }, [currentFrame]);

  const bumpMediaUpdateTrigger = useCallback(() => {
    setMediaUpdateTrigger((value) => value + 1);
  }, []);

  // Update cache limit if preference changes
  useEffect(() => {
    textureCacheRef.current.setLimit(effectiveMaxCacheSizeMB);
    textureCacheRef.current.setFrameLimit(effectiveFrameLimit);
    bumpMediaUpdateTrigger();
  }, [bumpMediaUpdateTrigger, effectiveFrameLimit, effectiveMaxCacheSizeMB]);

  const videoSrcsInProject = useMemo(() => {
    const srcs = new Set<string>();
    nodes.forEach((node) => {
      if (!isVideoFileNode(node)) return;
      getNodeAssetIds(node).forEach((id) => srcs.add(id));
    });
    return srcs;
  }, [nodes]);

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
    return nodes.filter(
      (node) =>
        node.type === NodeType.MEDIA_SOURCE && (node as MediaSourceNode).mediaKind === 'video',
    ) as MediaSourceNode[];
  }, [nodes]);
  const activeTimelineCacheNode = useMemo(() => {
    if (
      selectedNode?.type === NodeType.IMAGE_SEQUENCE ||
      (selectedNode?.type === NodeType.MEDIA_SOURCE &&
        (selectedNode as MediaSourceNode).mediaKind === 'video')
    ) {
      return selectedNode as ImageSequenceNode | MediaSourceNode;
    }
    return sequenceNodes[0] ?? videoNodes[0];
  }, [selectedNode, sequenceNodes, videoNodes]);

  const getSequenceFrameIndex = useCallback((node: ImageSequenceNode, frame: number) => {
    if (node.frames.length === 0) return null;
    const idx = Math.floor(frame) % node.frames.length;
    return (idx + node.frames.length) % node.frames.length;
  }, []);
  const getVideoFrameKey = useCallback((src: string, frame: number) => {
    return getVideoFrameCacheKey(src, frame);
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

  const setPendingVideoFrames = useCallback(
    (src: string, frames: number[]) => {
      const pendingVideoFrames = pendingVideoFramesRef.current;
      const pendingVideoFrameKeysBySrc = pendingVideoFrameKeysBySrcRef.current;
      const previousKeys = pendingVideoFrameKeysBySrc.get(src) ?? new Set<string>();
      const nextKeys = new Set(frames.map((frame) => getVideoFrameKey(src, frame)));
      const didChange =
        previousKeys.size !== nextKeys.size ||
        Array.from(previousKeys).some((key) => !nextKeys.has(key));
      if (!didChange) return;

      previousKeys.forEach((key) => pendingVideoFrames.delete(key));

      if (nextKeys.size > 0) {
        nextKeys.forEach((key) => pendingVideoFrames.add(key));
        pendingVideoFrameKeysBySrc.set(src, nextKeys);
      } else {
        pendingVideoFrameKeysBySrc.delete(src);
      }

      bumpMediaUpdateTrigger();
    },
    [bumpMediaUpdateTrigger, getVideoFrameKey],
  );

  const refreshPendingVideoFramesForSrc = useCallback(
    (src: string) => {
      const frames: number[] = [];
      pendingVideoFrameLoadsRef.current.forEach((_promise, key) => {
        if (getVideoFrameCacheSource(key) !== src) return;
        const frame = getVideoFrameCacheFrame(key);
        if (frame !== null) frames.push(frame);
      });
      setPendingVideoFrames(src, frames);
    },
    [setPendingVideoFrames],
  );

  const isCurrentFrameInPendingVideoArea = useCallback(
    (queuedWindow: QueuedVideoDecodeWindow, frame: number) => {
      if (isFrameInsideDecodeWindow(queuedWindow.frames, frame)) return true;

      const frameKey = getVideoFrameKey(queuedWindow.src, frame);
      const pendingCurrentFrameLoad = pendingVideoFrameLoadsRef.current.get(frameKey);
      return !!pendingCurrentFrameLoad && pendingCurrentFrameLoad === queuedWindow.promise;
    },
    [getVideoFrameKey],
  );

  const cancelQueuedVideoWindow = useCallback(
    (requestId: number, queuedWindow: QueuedVideoDecodeWindow) => {
      canceledVideoDecodeWindowIdsRef.current.add(requestId);
      queuedVideoDecodeWindowsRef.current.delete(requestId);
      queuedWindow.frames.forEach((frame) => {
        const frameKey = getVideoFrameKey(queuedWindow.src, frame);
        if (pendingVideoFrameLoadsRef.current.get(frameKey) === queuedWindow.promise) {
          pendingVideoFrameLoadsRef.current.delete(frameKey);
        }
      });
    },
    [getVideoFrameKey],
  );

  const cancelStaleQueuedVideoWindowsForSrc = useCallback(
    (src: string, keepFrames: number[], anchorFrame: number) => {
      let didCancel = false;
      queuedVideoDecodeWindowsRef.current.forEach((queuedWindow, requestId) => {
        if (queuedWindow.src !== src || queuedWindow.started) return;
        if (queuedWindow.frames.some((frame) => keepFrames.includes(frame))) return;
        if (isFrameInsideDecodeWindow(queuedWindow.frames, anchorFrame)) return;

        cancelQueuedVideoWindow(requestId, queuedWindow);
        didCancel = true;
      });

      if (didCancel) {
        refreshPendingVideoFramesForSrc(src);
        bumpMediaUpdateTrigger();
      }
    },
    [bumpMediaUpdateTrigger, cancelQueuedVideoWindow, refreshPendingVideoFramesForSrc],
  );

  const promoteQueuedVideoWindow = useCallback(
    (src: string, promise: Promise<void>, priorityFrames: number[], anchorFrame: number) => {
      queuedVideoDecodeWindowsRef.current.forEach((queuedWindow) => {
        if (queuedWindow.src !== src || queuedWindow.promise !== promise || queuedWindow.started) {
          return;
        }

        const originalFrames = new Set(queuedWindow.frames);
        const promotedFrames = priorityFrames.filter((frame) => originalFrames.has(frame));
        if (promotedFrames.length > 0) {
          const nextFrames = [
            ...promotedFrames,
            ...queuedWindow.frames.filter((frame) => !promotedFrames.includes(frame)),
          ];
          queuedWindow.frames.splice(0, queuedWindow.frames.length, ...nextFrames);
        }
        queuedWindow.anchorFrame = anchorFrame;
        queuedWindow.priority = 'required';
      });
    },
    [],
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

            const onSeeked = () => {
              // Snapshot the current frame to cache for better performance
              captureVideoFrame(src, video);

              texture.needsUpdate = true;
              bumpMediaUpdateTrigger();
            };

            video.addEventListener('seeked', onSeeked);

            cache.add(src, texture, video, createdUrl);

            // Seek to the start to guarantee the first frame is fully decoded
            // before the render loop picks up this texture. Without this,
            // QuickTime / H.264 videos may not have a painted frame after
            // `loadeddata`, causing a black viewport on first load.
            // The `onSeeked` handler will call `bumpMediaUpdateTrigger` once
            // the frame is actually decoded, so we skip the immediate bump
            // for video assets.
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
    [bumpMediaUpdateTrigger, captureVideoFrame],
  );

  const requestVideoFrame = useCallback(
    async (src: string, frame: number, options: VideoFrameRequestOptions = {}) => {
      if (!src) return;

      const priority = options.priority ?? 'required';
      const roundedFrame = Math.max(0, Math.round(frame));
      const frameKey = getVideoFrameKey(src, roundedFrame);
      if (textureCacheRef.current.has(frameKey)) return;

      const decodeFrames = buildVideoDecodeWindowFrames(roundedFrame, priority === 'required');
      if (priority === 'required') {
        cancelStaleQueuedVideoWindowsForSrc(src, decodeFrames, Math.round(currentFrameRef.current));
      }

      const existingLoad = pendingVideoFrameLoadsRef.current.get(frameKey);
      if (existingLoad) {
        if (priority === 'required') {
          promoteQueuedVideoWindow(
            src,
            existingLoad,
            decodeFrames,
            Math.round(currentFrameRef.current),
          );
        }
        await existingLoad;
        return;
      }

      const windowFrames: number[] = [];
      for (const candidate of decodeFrames) {
        const candidateKey = getVideoFrameKey(src, candidate);
        if (textureCacheRef.current.has(candidateKey)) continue;
        if (pendingVideoFrameLoadsRef.current.has(candidateKey)) continue;
        windowFrames.push(candidate);
      }

      if (windowFrames.length === 0) return;

      const requestId = nextVideoDecodeWindowIdRef.current;
      nextVideoDecodeWindowIdRef.current += 1;

      const pendingLoad = (async () => {
        try {
          let session = videoDecodeSessionsRef.current.get(src);
          if (!session || session.disposed) {
            const blob = await getAsset(src);
            if (!blob) return;

            const objectUrl = URL.createObjectURL(blob);
            const video = document.createElement('video');
            video.src = objectUrl;
            video.muted = true;
            video.playsInline = true;
            video.preload = 'auto';
            video.crossOrigin = 'anonymous';

            const ready = new Promise<void>((resolve, reject) => {
              video.onloadeddata = () => resolve();
              video.onerror = () => reject(new Error('Video failed to load.'));
              video.load();
            });

            session = {
              video,
              objectUrl,
              ready,
              queue: Promise.resolve(),
              disposed: false,
            };
            videoDecodeSessionsRef.current.set(src, session);
          }

          const decodeWindow = session.queue.then(async () => {
            if (!session || session.disposed) return;
            if (canceledVideoDecodeWindowIdsRef.current.has(requestId)) return;
            await session.ready;
            if (session.disposed) return;
            if (canceledVideoDecodeWindowIdsRef.current.has(requestId)) return;

            const isStillRelevant = isVideoFrameWindowRelevant(
              windowFrames,
              currentFrameRef.current,
              backgroundPrefetchFrameWindow,
            );

            const queuedWindow = queuedVideoDecodeWindowsRef.current.get(requestId);
            if (
              priority !== 'required' &&
              !isStillRelevant &&
              (!queuedWindow ||
                !isCurrentFrameInPendingVideoArea(queuedWindow, currentFrameRef.current))
            ) {
              return;
            }
            if (queuedWindow) queuedWindow.started = true;

            const { video } = session;
            const currentFps = fpsRef.current || 30;
            const tolerance = 0.5 / currentFps;

            for (const targetFrame of windowFrames) {
              const targetKey = getVideoFrameKey(src, targetFrame);
              if (textureCacheRef.current.has(targetKey)) continue;
              if (session.disposed) return;

              const targetTime = Math.max(
                0,
                Math.min(targetFrame / currentFps + 0.0001, video.duration || Infinity),
              );

              if (Math.abs(video.currentTime - targetTime) > tolerance) {
                await new Promise<void>((resolve, reject) => {
                  video.onseeked = () => resolve();
                  video.onerror = () => reject(new Error('Video failed to seek.'));
                  video.currentTime = targetTime;
                });
              }

              if (textureCacheRef.current.has(targetKey)) continue;

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
              textureCacheRef.current.add(targetKey, frameTex, undefined, undefined, targetFrame);
              bumpMediaUpdateTrigger();
            }
          });

          session.queue = decodeWindow.catch(() => {});
          await decodeWindow;
        } catch (error) {
          console.error('Failed to capture temporal video frame:', src, roundedFrame, error);
        } finally {
          queuedVideoDecodeWindowsRef.current.delete(requestId);
          canceledVideoDecodeWindowIdsRef.current.delete(requestId);
          windowFrames.forEach((loadedFrame) => {
            const loadedFrameKey = getVideoFrameKey(src, loadedFrame);
            if (pendingVideoFrameLoadsRef.current.get(loadedFrameKey) === pendingLoad) {
              pendingVideoFrameLoadsRef.current.delete(loadedFrameKey);
            }
          });
          refreshPendingVideoFramesForSrc(src);
          bumpMediaUpdateTrigger();
        }
      })();

      queuedVideoDecodeWindowsRef.current.set(requestId, {
        src,
        frames: windowFrames,
        promise: pendingLoad,
        started: false,
        anchorFrame: Math.round(currentFrameRef.current),
        priority,
      });
      windowFrames.forEach((loadedFrame) => {
        pendingVideoFrameLoadsRef.current.set(getVideoFrameKey(src, loadedFrame), pendingLoad);
      });
      refreshPendingVideoFramesForSrc(src);
      bumpMediaUpdateTrigger();
      await pendingLoad;
    },
    [
      backgroundPrefetchFrameWindow,
      bumpMediaUpdateTrigger,
      cancelStaleQueuedVideoWindowsForSrc,
      getVideoFrameKey,
      isCurrentFrameInPendingVideoArea,
      promoteQueuedVideoWindow,
      refreshPendingVideoFramesForSrc,
    ],
  );

  // Track which nodes had a src change so we can force a mediaUpdateTrigger
  // bump. The render loop runs in useLayoutEffect (before this effect), so
  // when loadAsset finds the texture already in cache it returns without
  // bumping the trigger — meaning the render loop never gets a second pass
  // to pick up the new texture key.
  const prevSrcMapRef = useRef(new Map<string, string>());

  useEffect(() => {
    let anySrcChanged = false;

    nodes.forEach((node) => {
      getGeneratedOutputAssetIdsAt(node, currentFrame).forEach((assetId) => {
        loadAsset(assetId);
      });

      // Preload all image output assets (e.g., ONNX multi-output models)
      // so textures are immediately available when the user switches outputs.
      const nodeOutputs = (node as { outputs?: Array<{ kind?: string; src?: string }> }).outputs;
      if (nodeOutputs) {
        for (const output of nodeOutputs) {
          if (output.kind === 'image' && output.src) {
            loadAsset(output.src);
          }
        }
      }

      const flags = nodeFlags(node.type);
      const frameAssetId = getFrameAssetIdAt(node, currentFrame);
      if (frameAssetId) {
        loadAsset(frameAssetId);
      } else if (flags.isMediaNode && !flags.isLooping) {
        const src = getNodeSrc(node);
        if (src) {
          const prevSrc = prevSrcMapRef.current.get(node.id);
          if (prevSrc !== src) {
            anySrcChanged = true;
            prevSrcMapRef.current.set(node.id, src);
          }
          loadAsset(src);
        }
      } else if (flags.isMediaNode && flags.isLooping) {
        const src = getNodeSrc(node);
        if (src) {
          const prevSrc = prevSrcMapRef.current.get(node.id);
          if (prevSrc !== src) {
            anySrcChanged = true;
            prevSrcMapRef.current.set(node.id, src);
          }
          loadAsset(src);
        }
      }
    });

    if (anySrcChanged) {
      bumpMediaUpdateTrigger();
    }

    const currentIds = new Set(nodes.map((n) => n.id));
    for (const id of prevSrcMapRef.current.keys()) {
      if (!currentIds.has(id)) prevSrcMapRef.current.delete(id);
    }
  }, [currentFrame, nodes, loadAsset, bumpMediaUpdateTrigger]);

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
    if (videoSrcsInProject.size === 0) return;
    const frame = Math.max(0, Math.round(currentFrame));
    videoSrcsInProject.forEach((src) => {
      void requestVideoFrame(src, frame, { priority: 'required' });
    });
  }, [currentFrame, requestVideoFrame, videoSrcsInProject]);

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

        if (isVideoFileNode(sourceNode)) {
          const [assetId] = getNodeAssetIds(sourceNode);
          if (assetId) void requestVideoFrame(assetId, targetFrame, { priority: 'required' });
          return;
        }

        const sourceFrames = getFrameAssetIds(sourceNode);
        if (sourceFrames.length > 0) {
          const frameAssetId = getFrameAssetIdAt(sourceNode, targetFrame);
          if (frameAssetId) loadAsset(frameAssetId);
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

    const offsets = buildBackgroundPrefetchOffsets(
      backgroundPrefetchMode,
      backgroundPrefetchFrameWindow,
      autoPrefetchDirectionRef.current,
    );

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
    if (backgroundPrefetchMode === 'on_demand') return;
    if (backgroundPrefetchFrameWindow <= 0) return;
    if (videoNodes.length === 0) return;

    const targetNodes =
      selectedNode?.type === NodeType.MEDIA_SOURCE &&
      (selectedNode as MediaSourceNode).mediaKind === 'video'
        ? [selectedNode as MediaSourceNode]
        : videoNodes;

    const offsets = buildBackgroundPrefetchOffsets(
      backgroundPrefetchMode,
      backgroundPrefetchFrameWindow,
      autoPrefetchDirectionRef.current,
    );

    const maxCandidates =
      cacheBudgetMode === 'frame_count'
        ? Math.max(0, maxCachedFrames - targetNodes.length)
        : Number.POSITIVE_INFINITY;
    if (maxCandidates === 0) return;

    const candidates: Array<{ src: string; frame: number }> = [];
    const scheduled = new Set<string>();

    for (const offset of offsets) {
      for (const node of targetNodes) {
        if (!node.src) continue;
        const frame = Math.max(0, Math.round(currentFrame + offset));
        const frameKey = getVideoFrameKey(node.src, frame);
        if (scheduled.has(frameKey)) continue;
        if (
          textureCacheRef.current.has(frameKey) ||
          pendingVideoFrameLoadsRef.current.has(frameKey)
        ) {
          continue;
        }

        scheduled.add(frameKey);
        candidates.push({ src: node.src, frame });

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
          await requestVideoFrame(candidate.src, candidate.frame, { priority: 'prefetch' });
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
    getVideoFrameKey,
    maxCachedFrames,
    requestVideoFrame,
    selectedNode,
    videoNodes,
  ]);

  useEffect(() => {
    textureCacheRef.current.prune(assetIdsInProject, (cacheKey) => {
      const source = getVideoFrameCacheSource(cacheKey);
      return source !== null && videoSrcsInProject.has(source);
    });
  }, [assetIdsInProject, videoSrcsInProject]);

  useEffect(() => {
    const dynamicVideoSrcs = nodes
      .filter((node) => node.type !== NodeType.MEDIA_SOURCE && isVideoFileNode(node))
      .flatMap((node) => getNodeAssetIds(node));
    const activeVideoSrcs = new Set([
      ...videoNodes.map((node) => node.src).filter(Boolean),
      ...dynamicVideoSrcs,
    ]);
    let changed = false;

    pendingVideoFrameKeysBySrcRef.current.forEach((frameKeys, src) => {
      if (activeVideoSrcs.has(src)) return;
      pendingVideoFrameKeysBySrcRef.current.delete(src);
      frameKeys.forEach((frameKey) => pendingVideoFramesRef.current.delete(frameKey));
      changed = true;
    });

    videoDecodeSessionsRef.current.forEach((session, src) => {
      if (activeVideoSrcs.has(src)) return;
      disposeVideoDecodeSession(session);
      videoDecodeSessionsRef.current.delete(src);
      changed = true;
    });

    queuedVideoDecodeWindowsRef.current.forEach((queuedWindow, requestId) => {
      if (activeVideoSrcs.has(queuedWindow.src)) return;
      cancelQueuedVideoWindow(requestId, queuedWindow);
      changed = true;
    });

    if (changed) {
      bumpMediaUpdateTrigger();
    }
  }, [bumpMediaUpdateTrigger, cancelQueuedVideoWindow, nodes, videoNodes]);

  useEffect(() => {
    const sessions = videoDecodeSessionsRef.current;
    const queuedWindows = queuedVideoDecodeWindowsRef.current;
    const canceledWindows = canceledVideoDecodeWindowIdsRef.current;
    return () => {
      sessions.forEach(disposeVideoDecodeSession);
      sessions.clear();
      queuedWindows.clear();
      canceledWindows.clear();
    };
  }, []);

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
      } else if (
        activeTimelineCacheNode?.type === NodeType.MEDIA_SOURCE &&
        (activeTimelineCacheNode as MediaSourceNode).mediaKind === 'video'
      ) {
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
