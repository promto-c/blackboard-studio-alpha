// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeType, type RotoNode, type SceneNode } from '@blackboard/types';
import { useViewportRotoMasks } from './useViewportRotoMasks';

const { createRotoMaskLayersMock, disposeRotoMaskLayersMock } = vi.hoisted(() => ({
  createRotoMaskLayersMock: vi.fn(),
  disposeRotoMaskLayersMock: vi.fn(),
}));

vi.mock('@/utils/rotoMaskTexture', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/rotoMaskTexture')>();
  return {
    ...actual,
    createRotoMaskLayers: createRotoMaskLayersMock,
    disposeRotoMaskLayers: disposeRotoMaskLayersMock,
  };
});

const sceneNode: SceneNode = {
  id: 'scene',
  type: NodeType.SCENE,
  name: 'Scene',
  enabled: true,
  width: 3840,
  height: 2160,
  bitDepth: 16,
  colorSpace: 'Linear',
  startFrame: 0,
  maxFrames: 100,
  fps: 24,
};

const createRotoNode = (id: string): RotoNode => ({
  id,
  type: NodeType.ROTO,
  name: id,
  enabled: true,
  invert: false,
  paths: [],
});

describe('useViewportRotoMasks', () => {
  beforeEach(() => {
    createRotoMaskLayersMock.mockReset();
    disposeRotoMaskLayersMock.mockReset();
    createRotoMaskLayersMock.mockImplementation(() => [
      {
        texture: new THREE.Texture(),
        feather: 0,
        opacity: 1,
        operation: 'add',
      },
    ]);
  });

  it('uses a proxy only for the edited node and reuses unchanged Roto resources', () => {
    const rotoA = createRotoNode('roto-a');
    const rotoB = createRotoNode('roto-b');
    const bumpMediaUpdate = vi.fn();
    const initialProps = {
      nodes: [rotoA, rotoB],
      sceneNode,
      viewportSize: { width: 1934, height: 1321 },
      currentFrame: 10,
      optimizedPreviewActive: false,
      editingPreviewActive: false,
      editingNodeId: null,
      maxDimension: 1280,
      sampleLimit: 8,
      rotoPointWeightMode: 'global' as const,
      suspendMaskUpdatesWhileEditing: false,
      bumpMediaUpdate,
    };
    const { result, rerender } = renderHook((props) => useViewportRotoMasks(props), {
      initialProps,
    });

    expect(createRotoMaskLayersMock).toHaveBeenCalledTimes(2);
    expect(result.current.current.get(rotoA.id)).toMatchObject({ width: 3840, height: 2160 });
    expect(result.current.current.get(rotoB.id)).toMatchObject({ width: 3840, height: 2160 });

    rerender({
      ...initialProps,
      optimizedPreviewActive: true,
      editingPreviewActive: true,
      editingNodeId: rotoA.id,
    });

    expect(createRotoMaskLayersMock).toHaveBeenCalledTimes(3);
    expect(result.current.current.get(rotoA.id)).toMatchObject({ width: 1280, height: 720 });
    expect(result.current.current.get(rotoB.id)).toMatchObject({ width: 3840, height: 2160 });
    expect(bumpMediaUpdate).toHaveBeenCalledOnce();

    const editedRotoA = { ...rotoA, paths: [...rotoA.paths] };
    rerender({
      ...initialProps,
      nodes: [editedRotoA, rotoB],
      optimizedPreviewActive: true,
      editingPreviewActive: true,
      editingNodeId: rotoA.id,
    });

    expect(createRotoMaskLayersMock).toHaveBeenCalledTimes(4);
    const firstInteractiveCache = createRotoMaskLayersMock.mock.calls[2]?.[3]?.textureCache;
    const updatedInteractiveCache = createRotoMaskLayersMock.mock.calls[3]?.[3]?.textureCache;
    expect(updatedInteractiveCache).toBe(firstInteractiveCache);
    expect(bumpMediaUpdate).toHaveBeenCalledOnce();

    rerender({
      ...initialProps,
      nodes: [editedRotoA, rotoB],
    });

    expect(createRotoMaskLayersMock).toHaveBeenCalledTimes(5);
    expect(result.current.current.get(rotoA.id)).toMatchObject({ width: 3840, height: 2160 });
    expect(createRotoMaskLayersMock.mock.calls[4]?.[3]?.textureCache).not.toBe(
      firstInteractiveCache,
    );
    expect(bumpMediaUpdate).toHaveBeenCalledTimes(2);

    rerender({
      ...initialProps,
      nodes: [editedRotoA, rotoB],
      optimizedPreviewActive: true,
      editingPreviewActive: true,
      editingNodeId: rotoA.id,
    });

    expect(createRotoMaskLayersMock).toHaveBeenCalledTimes(6);
    expect(createRotoMaskLayersMock.mock.calls[5]?.[3]?.textureCache).toBe(firstInteractiveCache);
    expect(bumpMediaUpdate).toHaveBeenCalledTimes(3);
  });

  it('uses the proxy for every Roto node during temporal preview', () => {
    const rotoA = createRotoNode('roto-a');
    const rotoB = createRotoNode('roto-b');
    const { result } = renderHook(() =>
      useViewportRotoMasks({
        nodes: [rotoA, rotoB],
        sceneNode,
        viewportSize: { width: 1920, height: 1080 },
        currentFrame: 12,
        optimizedPreviewActive: true,
        editingPreviewActive: false,
        editingNodeId: null,
        maxDimension: 1280,
        sampleLimit: 8,
        rotoPointWeightMode: 'global',
        suspendMaskUpdatesWhileEditing: false,
        bumpMediaUpdate: vi.fn(),
      }),
    );

    expect(result.current.current.get(rotoA.id)).toMatchObject({ width: 1280, height: 720 });
    expect(result.current.current.get(rotoB.id)).toMatchObject({ width: 1280, height: 720 });
  });

  it('does not prepare or update an invisible alpha mask during an edit', () => {
    const roto = createRotoNode('roto');
    const baseProps = {
      nodes: [roto],
      sceneNode,
      viewportSize: { width: 1920, height: 1080 },
      currentFrame: 12,
      optimizedPreviewActive: false,
      editingPreviewActive: true,
      editingNodeId: roto.id,
      maxDimension: 1280,
      sampleLimit: 8,
      rotoPointWeightMode: 'global' as const,
      suspendMaskUpdatesWhileEditing: true,
      bumpMediaUpdate: vi.fn(),
    };
    const { result, rerender } = renderHook((props) => useViewportRotoMasks(props), {
      initialProps: baseProps,
    });

    expect(createRotoMaskLayersMock).not.toHaveBeenCalled();
    expect(result.current.current.has(roto.id)).toBe(false);

    const editedRoto = { ...roto, paths: [...roto.paths] };
    rerender({ ...baseProps, nodes: [editedRoto] });
    expect(createRotoMaskLayersMock).not.toHaveBeenCalled();

    rerender({
      ...baseProps,
      nodes: [editedRoto],
      editingPreviewActive: false,
      editingNodeId: null,
      suspendMaskUpdatesWhileEditing: false,
    });
    expect(createRotoMaskLayersMock).toHaveBeenCalledOnce();
    expect(result.current.current.has(roto.id)).toBe(true);
  });

  it('does not prepare an alpha-dead Roto mask when the frame changes', () => {
    const roto = createRotoNode('roto');
    const bypassNodeIds = new Set([roto.id]);
    const baseProps = {
      nodes: [roto],
      sceneNode,
      viewportSize: { width: 1920, height: 1080 },
      currentFrame: 12,
      optimizedPreviewActive: false,
      editingPreviewActive: false,
      editingNodeId: null,
      maxDimension: 1280,
      sampleLimit: 8,
      rotoPointWeightMode: 'global' as const,
      bypassNodeIds,
      suspendMaskUpdatesWhileEditing: false,
      bumpMediaUpdate: vi.fn(),
    };
    const { result, rerender } = renderHook((props) => useViewportRotoMasks(props), {
      initialProps: baseProps,
    });

    expect(createRotoMaskLayersMock).not.toHaveBeenCalled();
    expect(result.current.current.has(roto.id)).toBe(false);

    rerender({ ...baseProps, currentFrame: 13 });
    expect(createRotoMaskLayersMock).not.toHaveBeenCalled();
  });
});
