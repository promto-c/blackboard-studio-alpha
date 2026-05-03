import { describe, expect, it } from 'vitest';
import { compileHotkeyBinding, findHotkeyConflicts, resolveHotkeyBinding } from './resolver';
import type { HotkeyContext } from './types';

const createEvent = (overrides: Partial<KeyboardEvent> = {}): KeyboardEvent =>
  ({
    altKey: false,
    ctrlKey: false,
    key: 'g',
    metaKey: false,
    repeat: false,
    shiftKey: false,
    ...overrides,
  }) as KeyboardEvent;

const createContext = (overrides: Partial<HotkeyContext> = {}): HotkeyContext => ({
  activeScopeId: 'global',
  activeScopePath: ['global'],
  activeTab: null,
  activeView: 'global',
  activeViewportTool: null,
  currentFrame: 0,
  flowMode: null,
  isDrawing: false,
  isTextEntry: false,
  keyboard: {
    activeScopeId: 'global',
    activeScopePath: ['global'],
    focusedScopeId: null,
    modifiers: {
      alt: false,
      ctrl: false,
      meta: false,
      mod: false,
      shift: false,
    },
    pointerScopeId: null,
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

describe('hotkey resolver', () => {
  it('prefers higher weight and deeper active scope', () => {
    const globalBinding = compileHotkeyBinding(
      'global',
      { command: 'global.run', keys: 'G', scope: 'global' },
      1,
    );
    const flowBinding = compileHotkeyBinding(
      'flow',
      { command: 'flow.run', keys: 'G', scope: 'flow', weight: 300 },
      2,
    );

    const result = resolveHotkeyBinding(
      [globalBinding, flowBinding].filter(Boolean) as NonNullable<typeof globalBinding>[],
      createEvent({ key: 'g' }),
      createContext({
        activeScopeId: 'flow',
        activeScopePath: ['global', 'flow'],
        activeView: 'flow',
        flowMode: 'list',
      }),
    );

    expect(result.map((binding) => binding.command)).toEqual(['flow.run', 'global.run']);
  });

  it('suppresses bindings in text inputs unless explicitly allowed', () => {
    const blocked = compileHotkeyBinding('blocked', { command: 'blocked', keys: 'G' }, 1);
    const allowed = compileHotkeyBinding(
      'allowed',
      { command: 'allowed', keys: 'G', allowInTextEntry: true, weight: 200 },
      2,
    );

    const result = resolveHotkeyBinding(
      [blocked, allowed].filter(Boolean) as NonNullable<typeof blocked>[],
      createEvent({ key: 'g' }),
      createContext({ isTextEntry: true }),
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.command).toBe('allowed');
  });

  it('applies when predicates before resolving candidates', () => {
    const disabled = compileHotkeyBinding(
      'timeline',
      {
        command: 'timeline.run',
        keys: 'Z',
        scope: 'timeline',
        when: (context) => context.timelineMode === 'graph',
      },
      1,
    );

    const result = resolveHotkeyBinding(
      [disabled].filter(Boolean) as NonNullable<typeof disabled>[],
      createEvent({ key: 'z' }),
      createContext({
        activeScopeId: 'timeline.dopesheet',
        activeScopePath: ['global', 'timeline', 'timeline.dopesheet'],
        activeView: 'timeline',
        timelineMode: 'dopesheet',
      }),
    );

    expect(result).toHaveLength(0);
  });

  it('reports same-combo same-weight conflicts on overlapping scopes', () => {
    const left = compileHotkeyBinding(
      'left',
      { command: 'left.run', keys: 'G', scope: 'viewport', weight: 200 },
      1,
    );
    const right = compileHotkeyBinding(
      'right',
      { command: 'right.run', keys: 'G', scope: ['viewport', 'global'], weight: 200 },
      2,
    );

    const conflicts = findHotkeyConflicts(
      [left, right].filter(Boolean) as NonNullable<typeof left>[],
    );

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.combo).toBe('g');
  });
});
