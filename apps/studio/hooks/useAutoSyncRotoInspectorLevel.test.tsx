// @vitest-environment jsdom

import { useState } from 'react';
import { renderHook, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NodeType, type AnyNode, type RotoNode } from '@blackboard/types';
import { useAutoSyncRotoInspectorLevel } from './useAutoSyncRotoInspectorLevel';

const createRotoNode = (id: string, pathIds: string[]): AnyNode =>
  ({
    id,
    type: NodeType.ROTO,
    name: `Roto ${id}`,
    paths: pathIds.map((pathId) => ({ id: pathId })),
  }) as unknown as RotoNode;

const createBlurNode = (id: string): AnyNode =>
  ({
    id,
    type: NodeType.BLUR,
    name: `Blur ${id}`,
  }) as AnyNode;

describe('useAutoSyncRotoInspectorLevel', () => {
  it('activates shape inspector when the roto selection changes to one path', () => {
    const rotoNode = createRotoNode('roto-1', ['shape-1', 'shape-2']);

    const { result, rerender } = renderHook(
      ({
        selectedNode,
        selectedRotoLayerIds,
        selectedRotoPathIds,
      }: {
        selectedNode?: AnyNode;
        selectedRotoLayerIds: string[];
        selectedRotoPathIds: string[];
      }) => {
        const [level, setLevel] = useState<'node' | 'shape'>('node');
        useAutoSyncRotoInspectorLevel({
          selectedNode,
          selectedRotoLayerIds,
          selectedRotoPathIds,
          setRotoInspectorLevel: setLevel,
        });
        return { level, setLevel };
      },
      {
        initialProps: {
          selectedNode: rotoNode,
          selectedRotoLayerIds: [],
          selectedRotoPathIds: [],
        },
      },
    );

    expect(result.current.level).toBe('node');

    act(() => {
      rerender({
        selectedNode: rotoNode,
        selectedRotoLayerIds: [],
        selectedRotoPathIds: ['shape-1'],
      });
    });

    expect(result.current.level).toBe('shape');
  });

  it('activates layer inspector when the roto selection changes to one layer', () => {
    const rotoNode = {
      ...createRotoNode('roto-1', []),
      layers: [{ id: 'layer-1', name: 'Layer 1' }],
    } as unknown as RotoNode;

    const { result, rerender } = renderHook(
      ({
        selectedNode,
        selectedRotoLayerIds,
        selectedRotoPathIds,
      }: {
        selectedNode?: AnyNode;
        selectedRotoLayerIds: string[];
        selectedRotoPathIds: string[];
      }) => {
        const [level, setLevel] = useState<'node' | 'shape' | 'layer'>('node');
        useAutoSyncRotoInspectorLevel({
          selectedNode,
          selectedRotoLayerIds,
          selectedRotoPathIds,
          setRotoInspectorLevel: setLevel,
        });
        return { level, setLevel };
      },
      {
        initialProps: {
          selectedNode: rotoNode,
          selectedRotoLayerIds: [],
          selectedRotoPathIds: [],
        },
      },
    );

    expect(result.current.level).toBe('node');

    act(() => {
      rerender({
        selectedNode: rotoNode,
        selectedRotoLayerIds: ['layer-1'],
        selectedRotoPathIds: [],
      });
    });

    expect(result.current.level).toBe('layer');
  });

  it('does not override a manual toggle until the selection changes again', () => {
    const rotoNode = createRotoNode('roto-1', ['shape-1', 'shape-2']);
    const initialSelection = ['shape-1'];
    const emptyLayerSelection: string[] = [];

    const { result, rerender } = renderHook(
      ({
        selectedRotoLayerIds,
        selectedRotoPathIds,
      }: {
        selectedRotoLayerIds: string[];
        selectedRotoPathIds: string[];
      }) => {
        const [level, setLevel] = useState<'node' | 'shape'>('node');
        useAutoSyncRotoInspectorLevel({
          selectedNode: rotoNode,
          selectedRotoLayerIds,
          selectedRotoPathIds,
          setRotoInspectorLevel: setLevel,
        });
        return { level, setLevel };
      },
      {
        initialProps: {
          selectedRotoLayerIds: emptyLayerSelection,
          selectedRotoPathIds: initialSelection,
        },
      },
    );

    expect(result.current.level).toBe('shape');

    act(() => {
      result.current.setLevel('node');
    });

    expect(result.current.level).toBe('node');

    act(() => {
      rerender({
        selectedRotoLayerIds: emptyLayerSelection,
        selectedRotoPathIds: initialSelection,
      });
    });

    expect(result.current.level).toBe('node');

    act(() => {
      rerender({
        selectedRotoLayerIds: emptyLayerSelection,
        selectedRotoPathIds: ['shape-2'],
      });
    });

    expect(result.current.level).toBe('shape');
  });

  it('re-activates shape inspector when the same single shape is intentionally reselected', () => {
    const rotoNode = createRotoNode('roto-1', ['shape-1', 'shape-2']);

    const { result, rerender } = renderHook(
      ({
        selectedRotoLayerIds,
        selectedRotoPathIds,
      }: {
        selectedRotoLayerIds: string[];
        selectedRotoPathIds: string[];
      }) => {
        const [level, setLevel] = useState<'node' | 'shape'>('node');
        useAutoSyncRotoInspectorLevel({
          selectedNode: rotoNode,
          selectedRotoLayerIds,
          selectedRotoPathIds,
          setRotoInspectorLevel: setLevel,
        });
        return { level, setLevel };
      },
      {
        initialProps: {
          selectedRotoLayerIds: [],
          selectedRotoPathIds: ['shape-1'],
        },
      },
    );

    act(() => {
      result.current.setLevel('node');
    });

    expect(result.current.level).toBe('node');

    act(() => {
      rerender({ selectedRotoLayerIds: [], selectedRotoPathIds: ['shape-1'] });
    });

    expect(result.current.level).toBe('shape');
  });

  it('falls back to node inspector for multi-select and non-roto nodes', () => {
    const rotoNode = createRotoNode('roto-1', ['shape-1', 'shape-2']);
    const blurNode = createBlurNode('blur-1');

    const { result, rerender } = renderHook(
      ({
        selectedNode,
        selectedRotoLayerIds,
        selectedRotoPathIds,
      }: {
        selectedNode?: AnyNode;
        selectedRotoLayerIds: string[];
        selectedRotoPathIds: string[];
      }) => {
        const [level, setLevel] = useState<'node' | 'shape'>('shape');
        useAutoSyncRotoInspectorLevel({
          selectedNode,
          selectedRotoLayerIds,
          selectedRotoPathIds,
          setRotoInspectorLevel: setLevel,
        });
        return level;
      },
      {
        initialProps: {
          selectedNode: rotoNode,
          selectedRotoLayerIds: [],
          selectedRotoPathIds: ['shape-1', 'shape-2'],
        },
      },
    );

    expect(result.current).toBe('node');

    act(() => {
      rerender({
        selectedNode: blurNode,
        selectedRotoLayerIds: [],
        selectedRotoPathIds: ['shape-1'],
      });
    });

    expect(result.current).toBe('node');
  });

  it('falls back to node inspector when layers are part of the selection', () => {
    const rotoNode = createRotoNode('roto-1', ['shape-1', 'shape-2']);

    const { result } = renderHook(
      ({
        selectedRotoLayerIds,
        selectedRotoPathIds,
      }: {
        selectedRotoLayerIds: string[];
        selectedRotoPathIds: string[];
      }) => {
        const [level, setLevel] = useState<'node' | 'shape'>('shape');
        useAutoSyncRotoInspectorLevel({
          selectedNode: rotoNode,
          selectedRotoLayerIds,
          selectedRotoPathIds,
          setRotoInspectorLevel: setLevel,
        });
        return level;
      },
      {
        initialProps: {
          selectedRotoLayerIds: ['layer-1'],
          selectedRotoPathIds: ['shape-1'],
        },
      },
    );

    expect(result.current).toBe('node');
  });
});
