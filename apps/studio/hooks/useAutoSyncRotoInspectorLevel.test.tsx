// @vitest-environment jsdom

import { useState } from 'react';
import { renderHook, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NodeType, type AnyNode, type RotoNode } from '@blackboard/types';
import {
  useAutoSyncRotoInspectorLevel,
  type RotoInspectorLevel,
} from './useAutoSyncRotoInspectorLevel';

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

type TestOptions = {
  selectedNode?: AnyNode;
  hierarchySelections: Record<string, { layerIds: string[]; itemIds: string[] }>;
  selectedNodeId: string | null;
};

describe('useAutoSyncRotoInspectorLevel', () => {
  it('activates shape inspector when the roto selection changes to one path', () => {
    const rotoNode = createRotoNode('roto-1', ['shape-1', 'shape-2']);

    const { result, rerender } = renderHook(
      (options: TestOptions) => {
        const [level, setLevel] = useState<RotoInspectorLevel>('node');
        useAutoSyncRotoInspectorLevel({
          selectedNode: options.selectedNode,
          hierarchySelections: options.hierarchySelections,
          selectedNodeId: options.selectedNodeId,
          setRotoInspectorLevel: setLevel,
        });
        return { level, setLevel };
      },
      {
        initialProps: {
          selectedNode: rotoNode,
          hierarchySelections: { 'roto-1': { layerIds: [], itemIds: [] } },
          selectedNodeId: 'roto-1',
        },
      },
    );

    expect(result.current.level).toBe('node');

    act(() => {
      rerender({
        selectedNode: rotoNode,
        hierarchySelections: { 'roto-1': { layerIds: [], itemIds: ['shape-1'] } },
        selectedNodeId: 'roto-1',
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
      (options: TestOptions) => {
        const [level, setLevel] = useState<RotoInspectorLevel>('node');
        useAutoSyncRotoInspectorLevel({
          selectedNode: options.selectedNode,
          hierarchySelections: options.hierarchySelections,
          selectedNodeId: options.selectedNodeId,
          setRotoInspectorLevel: setLevel,
        });
        return { level, setLevel };
      },
      {
        initialProps: {
          selectedNode: rotoNode,
          hierarchySelections: { 'roto-1': { layerIds: [], itemIds: [] } },
          selectedNodeId: 'roto-1',
        },
      },
    );

    expect(result.current.level).toBe('node');

    act(() => {
      rerender({
        selectedNode: rotoNode,
        hierarchySelections: { 'roto-1': { layerIds: ['layer-1'], itemIds: [] } },
        selectedNodeId: 'roto-1',
      });
    });

    expect(result.current.level).toBe('layer');
  });

  it('does not override a manual toggle until the selection changes again', () => {
    const rotoNode = createRotoNode('roto-1', ['shape-1', 'shape-2']);

    // Use stable references so the hook detects no selection change
    const shape1Selections = { 'roto-1': { layerIds: [], itemIds: ['shape-1'] as string[] } };
    const shape2Selections = { 'roto-1': { layerIds: [], itemIds: ['shape-2'] as string[] } };

    const { result, rerender } = renderHook(
      (options: TestOptions) => {
        const [level, setLevel] = useState<RotoInspectorLevel>('node');
        useAutoSyncRotoInspectorLevel({
          selectedNode: rotoNode,
          hierarchySelections: options.hierarchySelections,
          selectedNodeId: options.selectedNodeId,
          setRotoInspectorLevel: setLevel,
        });
        return { level, setLevel };
      },
      {
        initialProps: {
          hierarchySelections: shape1Selections,
          selectedNodeId: 'roto-1',
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
        hierarchySelections: shape1Selections,
        selectedNodeId: 'roto-1',
      });
    });

    expect(result.current.level).toBe('node');

    act(() => {
      rerender({
        hierarchySelections: shape2Selections,
        selectedNodeId: 'roto-1',
      });
    });

    expect(result.current.level).toBe('shape');
  });

  it('re-activates shape inspector when the same single shape is intentionally reselected', () => {
    const rotoNode = createRotoNode('roto-1', ['shape-1', 'shape-2']);

    const { result, rerender } = renderHook(
      (options: TestOptions) => {
        const [level, setLevel] = useState<RotoInspectorLevel>('node');
        useAutoSyncRotoInspectorLevel({
          selectedNode: rotoNode,
          hierarchySelections: options.hierarchySelections,
          selectedNodeId: options.selectedNodeId,
          setRotoInspectorLevel: setLevel,
        });
        return { level, setLevel };
      },
      {
        initialProps: {
          hierarchySelections: { 'roto-1': { layerIds: [], itemIds: ['shape-1'] } },
          selectedNodeId: 'roto-1',
        },
      },
    );

    act(() => {
      result.current.setLevel('node');
    });

    expect(result.current.level).toBe('node');

    act(() => {
      rerender({
        hierarchySelections: { 'roto-1': { layerIds: [], itemIds: ['shape-1'] } },
        selectedNodeId: 'roto-1',
      });
    });

    expect(result.current.level).toBe('shape');
  });

  it('falls back to node inspector for multi-select and non-roto nodes', () => {
    const rotoNode = createRotoNode('roto-1', ['shape-1', 'shape-2']);
    const blurNode = createBlurNode('blur-1');

    const { result, rerender } = renderHook(
      (options: TestOptions) => {
        const [level, setLevel] = useState<RotoInspectorLevel>('shape');
        useAutoSyncRotoInspectorLevel({
          selectedNode: options.selectedNode,
          hierarchySelections: options.hierarchySelections,
          selectedNodeId: options.selectedNodeId,
          setRotoInspectorLevel: setLevel,
        });
        return level;
      },
      {
        initialProps: {
          selectedNode: rotoNode,
          hierarchySelections: { 'roto-1': { layerIds: [], itemIds: ['shape-1', 'shape-2'] } },
          selectedNodeId: 'roto-1',
        },
      },
    );

    expect(result.current).toBe('node');

    act(() => {
      rerender({
        selectedNode: blurNode,
        hierarchySelections: { blurNode: { layerIds: [], itemIds: ['shape-1'] } },
        selectedNodeId: 'blur-1',
      });
    });

    expect(result.current).toBe('node');
  });

  it('falls back to node inspector when layers are part of the selection', () => {
    const rotoNode = createRotoNode('roto-1', ['shape-1', 'shape-2']);

    const { result } = renderHook(
      (options: TestOptions) => {
        const [level, setLevel] = useState<RotoInspectorLevel>('shape');
        useAutoSyncRotoInspectorLevel({
          selectedNode: rotoNode,
          hierarchySelections: options.hierarchySelections,
          selectedNodeId: options.selectedNodeId,
          setRotoInspectorLevel: setLevel,
        });
        return level;
      },
      {
        initialProps: {
          hierarchySelections: { 'roto-1': { layerIds: ['layer-1'], itemIds: ['shape-1'] } },
          selectedNodeId: 'roto-1',
        },
      },
    );

    expect(result.current).toBe('node');
  });
});
