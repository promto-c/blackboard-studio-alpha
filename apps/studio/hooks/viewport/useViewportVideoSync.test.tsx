// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { NodeType, type AnyNode } from '@blackboard/types';
import type { TextureCacheEntry } from '@/utils/textureCache';
import { useViewportVideoSync } from './useViewportVideoSync';

const videoNode = {
  id: 'video',
  type: NodeType.MEDIA_SOURCE,
  name: 'Video',
  enabled: true,
  mediaKind: 'video',
  src: 'video-asset',
} as AnyNode;

const createVideo = (paused: boolean) =>
  ({
    paused,
    currentTime: 0,
    pause: vi.fn(),
    play: vi.fn(() => Promise.resolve()),
  }) as unknown as HTMLVideoElement;

const createEntry = (id: string, video?: HTMLVideoElement): TextureCacheEntry => ({
  id,
  texture: new THREE.Texture(),
  video,
  sizeBytes: 4,
  lastAccess: 0,
});

describe('useViewportVideoSync', () => {
  it('pauses the hidden live decoder when the requested frame is cached', () => {
    const video = createVideo(false);
    const entries = new Map([
      ['video-asset', createEntry('video-asset', video)],
      ['video-asset:12', createEntry('video-asset:12')],
    ]);

    renderHook(() =>
      useViewportVideoSync({
        nodes: [videoNode],
        currentFrame: 12,
        isPlaying: true,
        fps: 24,
        textureCacheRef: { current: { get: (key: string) => entries.get(key) } },
      }),
    );

    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.play).not.toHaveBeenCalled();
  });

  it('pauses a decoder when its node leaves the active viewer graphs', () => {
    const video = createVideo(false);
    const entries = new Map([['video-asset', createEntry('video-asset', video)]]);
    const initialProps = { nodes: [videoNode] };
    const { rerender } = renderHook(
      ({ nodes }: typeof initialProps) =>
        useViewportVideoSync({
          nodes,
          currentFrame: 0,
          isPlaying: true,
          fps: 24,
          textureCacheRef: { current: { get: (key: string) => entries.get(key) } },
        }),
      { initialProps },
    );

    rerender({ nodes: [] });

    expect(video.pause).toHaveBeenCalledOnce();
  });
});
