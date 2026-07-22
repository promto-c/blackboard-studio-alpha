// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/pwa/pwaLifecycle', () => ({
  snapshot: { isStandalone: false, isNewInstall: false },
  subscribeToPwa: () => () => {},
  registerPwa: () => {},
  requestPwaInstall: async () => 'dismissed' as const,
  checkForPwaUpdate: async () => {},
  applyPwaUpdate: () => {},
}));

import { nodeRegistry } from '@/nodes/registry';
import { NodeType, type AnyNode, type RotoNode } from '@blackboard/types';
import type { NodeDefinition } from '@/nodes/NodeDefinition';
import {
  createBaseCommands,
  getEffectBindingsForSelection,
  baseBindings,
  shouldPreventBrowserZoomGesture,
  shouldPreventNativeDragOrSelection,
} from './studioHotkeys';
import { getInitialState } from '@/state/editor/initialState';
import { compileHotkeyBinding, resolveHotkeyBinding } from './resolver';
import type { HotkeyContext, HotkeyExecutionContext } from './types';
import {
  addSegmentationPoint,
  getSegmentationSession,
  resetSegmentationSession,
} from '@/services/segmentation/segmentationSession';

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
  it('routes undo and redo to Smart Mask prompts while a segmentation tool is active', () => {
    const nodeId = 'roto-smart-mask-hotkey-test';
    const undo = vi.fn();
    const redo = vi.fn();
    addSegmentationPoint(nodeId, { x: 10, y: 20, label: 'include' });

    const context = {
      ...createContext({
        activeViewportTool: 'segment-point',
        selectedNodeId: nodeId,
        selectedNodeType: NodeType.ROTO,
      }),
      actions: { undo, redo },
    } as HotkeyExecutionContext;
    const commands = createBaseCommands();

    commands.find((command) => command.id === 'history.undo')!.run(context, undefined);
    expect(getSegmentationSession(nodeId).promptHistoryIndex).toBe(0);
    expect(undo).not.toHaveBeenCalled();

    commands.find((command) => command.id === 'history.redo')!.run(context, undefined);
    expect(getSegmentationSession(nodeId).promptHistoryIndex).toBe(1);
    expect(redo).not.toHaveBeenCalled();

    resetSegmentationSession(nodeId);
  });

  it('returns no effect bindings without a selected node', () => {
    expect(getEffectBindingsForSelection(null)).toEqual([]);
  });

  it('maps tool hotkeys to viewport tool commands', () => {
    const selectedNode = {
      id: 'roto-1',
      name: 'Roto',
      type: NodeType.ROTO,
      enabled: true,
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
    const setHierarchySelection = vi.fn();
    const setSelectedRotoPointRefs = vi.fn();
    const command = createBaseCommands().find(
      (item) => item.id === 'viewport.activateOrToggleRotoSelectMode',
    );
    const selectedNode = {
      id: 'roto-1',
      name: 'Roto',
      type: NodeType.ROTO,
      enabled: true,
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
          setHierarchySelection,
          setSelectedRotoPointRefs,
        },
      } as HotkeyExecutionContext,
      undefined,
    );

    expect(result).toBe(true);
    expect(setActiveViewportTool).not.toHaveBeenCalled();
    expect(setHierarchySelection).toHaveBeenCalledWith('', [], ['shape-1']);
    expect(setSelectedRotoPointRefs).toHaveBeenCalledWith([
      { pathId: 'shape-1', pointIndex: 0 },
      { pathId: 'shape-1', pointIndex: 2 },
    ]);
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
            enabled: true,
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
    const setHierarchySelection = vi.fn();
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
            enabled: true,
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
          setHierarchySelection,
        },
      } as HotkeyExecutionContext,
      undefined,
    );

    expect(result).toBe(true);
    expect(setActiveViewportTool).not.toHaveBeenCalled();
    expect(setHierarchySelection).toHaveBeenCalledWith('', [], ['shape-1']);
  });

  it('defaults explicit effect hotkeys to node-level weight 300', () => {
    const dummyType = 'test.effect.hotkeys';
    const dummyNode: NodeDefinition = {
      type: dummyType,
      name: 'Dummy',
      category: 'Effect',
      renderMode: 'shader',
      processingDomain: 'scene_linear',
      IconComponent: () => null,
      AdjustmentComponent: () => null,
      getInitialNodeProps: () => ({}),
      hotkeys: [{ command: 'dummy.run', keys: 'H', scope: 'viewport' }],
    };

    nodeRegistry.set(dummyType, dummyNode);
    try {
      const selectedNode = {
        id: 'dummy-1',
        name: 'Dummy',
        type: dummyType,
        enabled: true,
      } as unknown as AnyNode;
      const bindings = getEffectBindingsForSelection(selectedNode);
      expect(bindings).toContainEqual({
        command: 'dummy.run',
        keys: 'H',
        scope: 'viewport',
        weight: 300,
      });
    } finally {
      nodeRegistry.delete(dummyType);
    }
  });

  it('keeps frame stepping bindings global across active views', () => {
    const lookup = new Map(baseBindings.map((binding) => [binding.keys, binding]));

    expect(lookup.get('Mod+S')).toMatchObject({
      command: 'history.checkpointCurrent',
      repeat: false,
      allowInTextEntry: true,
    });

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

    expect(lookup.get('C')).toMatchObject({
      command: 'timeline.goToRecentFrame',
      weight: 400,
      repeat: false,
    });
    expect(lookup.get('C')?.scope).toBeUndefined();

    expect(lookup.get('J')).toMatchObject({
      command: 'timeline.playBackward',
      weight: 400,
      repeat: false,
    });
    expect(lookup.get('J')?.scope).toBeUndefined();

    expect(lookup.get('K')).toMatchObject({
      command: 'timeline.pausePlayback',
      weight: 400,
      repeat: false,
    });
    expect(lookup.get('K')?.scope).toBeUndefined();

    expect(lookup.get('L')).toMatchObject({
      command: 'timeline.playForward',
      weight: 400,
      repeat: false,
    });
    expect(lookup.get('L')?.scope).toBeUndefined();

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

  it('activates viewer slots once per number-key press', () => {
    const slotBindings = baseBindings.filter(
      (binding) => binding.command === 'viewer.activateSlot',
    );

    expect(slotBindings).toHaveLength(4);
    expect(slotBindings.every((binding) => binding.repeat === false)).toBe(true);
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
        enabled: true,
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

  it('resolves list node D/G shortcuts from the parent flow scope', () => {
    const compiledBindings = baseBindings
      .map((binding, index) => compileHotkeyBinding('test', binding, index + 1))
      .filter(Boolean) as NonNullable<ReturnType<typeof compileHotkeyBinding>>[];

    const selectionContext = createContext({
      activeScopeId: 'flow',
      activeScopePath: ['global', 'flow'],
      activeView: 'flow',
      flowMode: 'list',
      selectedNodeId: 'node-1',
      selectedNode: {
        id: 'node-1',
        type: NodeType.GRADE,
        enabled: true,
      } as AnyNode,
      selectedNodeType: NodeType.GRADE,
    });

    expect(
      resolveHotkeyBinding(
        compiledBindings,
        createEvent({ key: 'd', code: 'KeyD' }),
        selectionContext,
      )[0].command,
    ).toBe('flow.toggleNodeEnabled');
    expect(
      resolveHotkeyBinding(
        compiledBindings,
        createEvent({ key: 'g', code: 'KeyG' }),
        selectionContext,
      )[0].command,
    ).toBe('flow.groupSelectedNodes');
  });

  it('keeps viewport alpha toggles above effect tool bindings', () => {
    const selectedNode = {
      id: 'warp-1',
      name: 'Pin Warp',
      type: NodeType.WARP,
      enabled: true,
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

  it('runs Ctrl+S as a current checkpoint command', () => {
    const checkpointCurrentHistoryEntry = vi.fn();
    const command = createBaseCommands().find((item) => item.id === 'history.checkpointCurrent');

    expect(command).toBeDefined();

    const result = command!.run(
      {
        ...createContext(),
        actions: {
          checkpointCurrentHistoryEntry,
        },
      } as unknown as HotkeyExecutionContext,
      undefined,
    );

    expect(result).toBe(true);
    expect(checkpointCurrentHistoryEntry).toHaveBeenCalledOnce();
  });

  it('prioritizes C for recent-frame navigation above effect tool bindings', () => {
    const selectedNode = {
      id: 'paint-1',
      name: 'Paint',
      type: NodeType.PAINT,
      enabled: true,
    } as AnyNode;

    const compiledBindings = [...baseBindings, ...getEffectBindingsForSelection(selectedNode)]
      .map((binding, index) => compileHotkeyBinding('test', binding, index + 1))
      .filter(Boolean) as NonNullable<ReturnType<typeof compileHotkeyBinding>>[];

    const result = resolveHotkeyBinding(
      compiledBindings,
      createEvent({ key: 'c', code: 'KeyC' }),
      createContext(),
    );

    expect(result[0]).toMatchObject({
      command: 'timeline.goToRecentFrame',
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

  it('allows native drag from explicitly draggable controls and their children', () => {
    const root = document.createElement('div');
    const card = document.createElement('div');
    const thumbnail = document.createElement('img');
    card.draggable = true;
    card.appendChild(thumbnail);
    root.appendChild(card);

    expect(shouldPreventNativeDragOrSelection(card, root)).toBe(false);
    expect(shouldPreventNativeDragOrSelection(thumbnail, root)).toBe(false);
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
