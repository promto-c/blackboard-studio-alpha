// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { effectRegistry } from '@/effects/effectRegistry';
import { NodeType, type AnyNode, type RotoNode } from '@blackboard/types';
import type { EffectDefinition } from '@/effects/EffectDefinition';
import {
  createBaseCommands,
  getEffectBindingsForSelection,
  baseBindings,
  shouldPreventBrowserZoomGesture,
  shouldPreventNativeDragOrSelection,
} from './studioHotkeys';
import { getInitialState } from '@blackboard/state';
import { compileHotkeyBinding, resolveHotkeyBinding } from './resolver';
import type { HotkeyContext, HotkeyExecutionContext } from './types';

const createEvent = (overrides: Partial<KeyboardEvent> = {}): KeyboardEvent =>
  ({
    altKey: false,
    ctrlKey: false,
    key: 'a',
    metaKey: false,
    repeat: false,
    shiftKey: false,
    ...overrides,
  }) as KeyboardEvent;

const createContext = (overrides: Partial<HotkeyContext> = {}): HotkeyContext => ({
  activeScopeId: 'viewport',
  activeScopePath: ['global', 'viewport'],
  activeTab: null,
  activeView: 'viewport',
  activeViewportTool: null,
  currentFrame: 0,
  flowMode: null,
  isDrawing: false,
  isTextEntry: false,
  keyboard: {
    activeScopeId: 'viewport',
    activeScopePath: ['global', 'viewport'],
    focusedScopeId: null,
    modifiers: {
      alt: false,
      ctrl: false,
      meta: false,
      mod: false,
      shift: false,
    },
    pointerScopeId: 'viewport',
    pressedCodes: new Set<string>(),
    pressedKeys: new Set<string>(),
  },
  maxFrames: 0,
  modifiers: {
    alt: false,
    ctrl: false,
    meta: false,
    mod: false,
    shift: false,
  },
  selectedNode: null,
  selectedNodeId: null,
  selectedNodeType: null,
  selectedRotoPathIds: [],
  selectedRotoPointRefs: [],
  recentRotoPointRefs: [],
  selectedViewerTargetId: null,
  target: null,
  timelineMode: null,
  viewerSlot: null,
  ...overrides,
});

describe('studio hotkey effect bindings', () => {
  it('returns no effect bindings without a selected node', () => {
    expect(getEffectBindingsForSelection(null)).toEqual([]);
  });

  it('adapts legacy toolHotkeys to viewport tool commands', () => {
    const selectedNode = {
      id: 'roto-1',
      name: 'Roto',
      type: NodeType.ROTO,
      visible: true,
    } as AnyNode;

    const bindings = getEffectBindingsForSelection(selectedNode);
    const selectBinding = bindings.find((binding) => binding.keys === 'q');

    expect(selectBinding).toMatchObject({
      scope: 'viewport',
      weight: 300,
    });
    expect(selectBinding?.command).toBe('viewport.activateOrToggleRotoSelectMode');
  });

  it('restores the recent roto point selection when Q is pressed again on the same shapes', () => {
    const setActiveViewportTool = vi.fn();
    const setSelectedRotoSelection = vi.fn();
    const command = createBaseCommands().find(
      (item) => item.id === 'viewport.activateOrToggleRotoSelectMode',
    );
    const selectedNode = {
      id: 'roto-1',
      name: 'Roto',
      type: NodeType.ROTO,
      visible: true,
      paths: [
        {
          id: 'shape-1',
          name: 'Shape 1',
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
          ],
        },
      ],
    } as unknown as RotoNode;

    expect(command).toBeDefined();

    const result = command!.run(
      {
        ...createContext({
          activeViewportTool: 'select',
          selectedNode,
          selectedNodeType: NodeType.ROTO,
          selectedRotoPathIds: ['shape-1'],
          recentRotoPointRefs: [
            { pathId: 'shape-1', pointIndex: 0 },
            { pathId: 'shape-1', pointIndex: 2 },
          ],
        }),
        actions: {
          setActiveViewportTool,
          setSelectedRotoSelection,
        },
      } as HotkeyExecutionContext,
      undefined,
    );

    expect(result).toBe(true);
    expect(setActiveViewportTool).not.toHaveBeenCalled();
    expect(setSelectedRotoSelection).toHaveBeenCalledWith({
      layerIds: [],
      pathIds: ['shape-1'],
      pointRefs: [
        { pathId: 'shape-1', pointIndex: 0 },
        { pathId: 'shape-1', pointIndex: 2 },
      ],
    });
  });

  it('does not toggle from shapes to points when there is no recent point selection', () => {
    const setActiveViewportTool = vi.fn();
    const setSelectedRotoSelection = vi.fn();
    const command = createBaseCommands().find(
      (item) => item.id === 'viewport.activateOrToggleRotoSelectMode',
    );

    expect(command).toBeDefined();

    const result = command!.run(
      {
        ...createContext({
          activeViewportTool: 'select',
          selectedNode: {
            id: 'roto-1',
            name: 'Roto',
            type: NodeType.ROTO,
            visible: true,
            paths: [
              {
                id: 'shape-1',
                name: 'Shape 1',
                points: [
                  { x: 0, y: 0 },
                  { x: 10, y: 0 },
                  { x: 10, y: 10 },
                ],
              },
            ],
          } as unknown as RotoNode,
          selectedNodeType: NodeType.ROTO,
          selectedRotoPathIds: ['shape-1'],
        }),
        actions: {
          setActiveViewportTool,
          setSelectedRotoSelection,
        },
      } as HotkeyExecutionContext,
      undefined,
    );

    expect(result).toBe(true);
    expect(setActiveViewportTool).not.toHaveBeenCalled();
    expect(setSelectedRotoSelection).not.toHaveBeenCalled();
  });

  it('toggles roto select from points back to shapes when Q is pressed again', () => {
    const setActiveViewportTool = vi.fn();
    const setSelectedRotoSelection = vi.fn();
    const command = createBaseCommands().find(
      (item) => item.id === 'viewport.activateOrToggleRotoSelectMode',
    );

    expect(command).toBeDefined();

    const result = command!.run(
      {
        ...createContext({
          activeViewportTool: 'select',
          selectedNode: {
            id: 'roto-1',
            name: 'Roto',
            type: NodeType.ROTO,
            visible: true,
          } as AnyNode,
          selectedNodeType: NodeType.ROTO,
          selectedRotoPathIds: ['shape-1'],
          selectedRotoPointRefs: [
            { pathId: 'shape-1', pointIndex: 0 },
            { pathId: 'shape-1', pointIndex: 2 },
          ],
        }),
        actions: {
          setActiveViewportTool,
          setSelectedRotoSelection,
        },
      } as HotkeyExecutionContext,
      undefined,
    );

    expect(result).toBe(true);
    expect(setActiveViewportTool).not.toHaveBeenCalled();
    expect(setSelectedRotoSelection).toHaveBeenCalledWith({
      layerIds: [],
      pathIds: ['shape-1'],
    });
  });

  it('defaults explicit effect hotkeys to node-level weight 300', () => {
    const dummyType = 'test.effect.hotkeys';
    const dummyEffect: EffectDefinition = {
      type: dummyType,
      name: 'Dummy',
      category: 'Effect',
      renderMode: 'shader',
      IconComponent: () => null,
      AdjustmentComponent: () => null,
      getInitialNodeProps: () => ({}),
      hotkeys: [{ command: 'dummy.run', keys: 'H', scope: 'viewport' }],
    };

    effectRegistry.set(dummyType, dummyEffect);
    try {
      const selectedNode = {
        id: 'dummy-1',
        name: 'Dummy',
        type: dummyType,
        visible: true,
      } as unknown as AnyNode;
      const bindings = getEffectBindingsForSelection(selectedNode);
      expect(bindings).toContainEqual({
        command: 'dummy.run',
        keys: 'H',
        scope: 'viewport',
        weight: 300,
      });
    } finally {
      effectRegistry.delete(dummyType);
    }
  });

  it('keeps frame stepping bindings global across active views', () => {
    const lookup = new Map(baseBindings.map((binding) => [binding.keys, binding]));

    expect(lookup.get('Z')).toMatchObject({
      command: 'timeline.seekRelativeFrame',
      args: { delta: -1 },
    });
    expect(lookup.get('Z')?.scope).toBeUndefined();

    expect(lookup.get('X')).toMatchObject({
      command: 'timeline.seekRelativeFrame',
      args: { delta: 1 },
    });
    expect(lookup.get('X')?.scope).toBeUndefined();

    expect(lookup.get('Shift+Z')).toMatchObject({
      command: 'timeline.seekVisibleKeyframe',
      args: { direction: 'prev' },
    });
    expect(lookup.get('Shift+Z')?.scope).toBeUndefined();

    expect(lookup.get('Shift+X')).toMatchObject({
      command: 'timeline.seekVisibleKeyframe',
      args: { direction: 'next' },
    });
    expect(lookup.get('Shift+X')?.scope).toBeUndefined();
  });

  it('binds Delete/Backspace in flow to delete the selected node', () => {
    const flowDelete = baseBindings.find(
      (binding) => binding.command === 'flow.deleteSelectedNode',
    );

    expect(flowDelete).toBeDefined();
    expect(flowDelete).toMatchObject({
      keys: ['Delete', 'Backspace'],
      scope: ['flow.list', 'flow.graph'],
    });

    const compiledBindings = baseBindings
      .map((binding, index) => compileHotkeyBinding('test', binding, index + 1))
      .filter(Boolean) as NonNullable<ReturnType<typeof compileHotkeyBinding>>[];

    const selectionContext = createContext({
      activeScopeId: 'flow.list',
      activeScopePath: ['global', 'flow', 'flow.list'],
      selectedNodeId: 'node-1',
      selectedNode: {
        id: 'node-1',
        type: NodeType.ROTO,
        visible: true,
      } as AnyNode,
      selectedNodeType: NodeType.ROTO,
    });

    const candidates = resolveHotkeyBinding(
      compiledBindings,
      createEvent({ key: 'Delete', code: 'Delete' }),
      selectionContext,
    );

    expect(candidates[0].command).toBe('flow.deleteSelectedNode');
  });

  it('keeps viewport alpha toggles above effect tool bindings', () => {
    const selectedNode = {
      id: 'warp-1',
      name: 'Pin Warp',
      type: NodeType.WARP,
      visible: true,
    } as AnyNode;

    const compiledBindings = [...baseBindings, ...getEffectBindingsForSelection(selectedNode)]
      .map((binding, index) => compileHotkeyBinding('test', binding, index + 1))
      .filter(Boolean) as NonNullable<ReturnType<typeof compileHotkeyBinding>>[];

    const result = resolveHotkeyBinding(compiledBindings, createEvent(), createContext());

    expect(result[0]).toMatchObject({
      command: 'viewer.toggleChannelsAlpha',
      weight: 400,
    });

    const shiftLookup = new Map(baseBindings.map((binding) => [binding.keys, binding]));
    expect(shiftLookup.get('Mod+A')).toMatchObject({
      command: 'viewport.selectAll',
      scope: 'viewport',
      weight: 400,
    });
    expect(shiftLookup.get('Shift+A')).toMatchObject({
      command: 'viewer.toggleAlphaOverlay',
      scope: 'viewport',
      weight: 400,
    });
  });

  it('resolves Ctrl+A in the viewport to select all instead of alpha toggle', () => {
    const compiledBindings = baseBindings
      .map((binding, index) => compileHotkeyBinding('test', binding, index + 1))
      .filter(Boolean) as NonNullable<ReturnType<typeof compileHotkeyBinding>>[];

    const result = resolveHotkeyBinding(
      compiledBindings,
      createEvent({ key: 'a', code: 'KeyA', ctrlKey: true }),
      createContext(),
    );

    expect(result[0]).toMatchObject({
      command: 'viewport.selectAll',
      weight: 400,
    });
  });

  it('binds stabilize toggle to D and uses new default stabilization config', () => {
    const lookup = new Map(baseBindings.map((binding) => [binding.keys, binding]));
    expect(lookup.get('S')).toMatchObject({
      command: 'viewport.toggleStabilize',
      scope: 'viewport',
    });

    const initialState = getInitialState();
    expect(initialState.stabilizationConfig).toEqual({
      translation: true,
      rotation: true,
      scale: true,
      affine: true,
      perspective: true,
      scope: 'full',
    });
  });

  it('prevents browser zoom gestures on the studio surface', () => {
    const root = document.createElement('div');
    const target = document.createElement('div');
    root.appendChild(target);

    expect(shouldPreventBrowserZoomGesture({ ctrlKey: true, metaKey: false, target }, root)).toBe(
      true,
    );
    expect(shouldPreventBrowserZoomGesture({ ctrlKey: false, metaKey: true, target }, root)).toBe(
      true,
    );
    expect(shouldPreventBrowserZoomGesture({ ctrlKey: false, metaKey: false, target }, root)).toBe(
      false,
    );
  });

  it('does not block zoom gestures originating from text inputs', () => {
    const root = document.createElement('div');
    const input = document.createElement('input');
    root.appendChild(input);

    expect(
      shouldPreventBrowserZoomGesture({ ctrlKey: true, metaKey: false, target: input }, root),
    ).toBe(false);
    expect(shouldPreventNativeDragOrSelection(input, root)).toBe(false);
  });

  it('allows native drag and selection in scoped read-only text', () => {
    const root = document.createElement('div');
    const scope = document.createElement('div');
    const paragraph = document.createElement('p');
    const button = document.createElement('button');
    scope.dataset.textSelectionScope = '';
    paragraph.textContent = 'Copyable render log';
    button.textContent = 'Do not select while pressing';
    scope.append(paragraph, button);
    root.appendChild(scope);

    expect(shouldPreventNativeDragOrSelection(paragraph, root)).toBe(false);
    expect(shouldPreventNativeDragOrSelection(button, root)).toBe(true);
  });

  it('prevents native drag and selection outside text entry and scoped text targets', () => {
    const root = document.createElement('div');
    const target = document.createElement('div');
    const outside = document.createElement('div');
    root.appendChild(target);

    expect(shouldPreventNativeDragOrSelection(target, root)).toBe(true);
    expect(shouldPreventNativeDragOrSelection(outside, root)).toBe(false);
  });
});
