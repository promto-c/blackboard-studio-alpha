// @vitest-environment jsdom
import React, { useMemo, useRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HotkeyProvider } from './provider';
import {
  useHotkeyScope,
  useKeyPressed,
  useRegisterHotkeyCommands,
  useRegisterHotkeys,
} from './provider';
import type {
  HotkeyBinding,
  HotkeyCommand,
  HotkeyExecutionContext,
  KeyboardSnapshot,
} from './types';

const getActiveView = (scopeId: KeyboardSnapshot['activeScopeId']) => {
  if (scopeId.startsWith('flow')) return 'flow';
  if (scopeId.startsWith('timeline')) return 'timeline';
  if (scopeId === 'viewport') return 'viewport';
  return 'global';
};

const buildContext = ({
  keyboard,
  target,
  isTextEntry,
}: {
  keyboard: KeyboardSnapshot;
  target: EventTarget | null;
  isTextEntry: boolean;
}): HotkeyExecutionContext => ({
  actions: {},
  activeScopeId: keyboard.activeScopeId,
  activeScopePath: keyboard.activeScopePath,
  activeTab: null,
  activeView: getActiveView(keyboard.activeScopeId),
  activeViewportTool: null,
  currentFrame: 0,
  flowMode: keyboard.activeScopeId === 'flow' ? 'list' : null,
  isDrawing: false,
  isTextEntry,
  keyboard,
  maxFrames: 0,
  modifiers: keyboard.modifiers,
  selectedNode: null,
  selectedNodeId: null,
  selectedNodeType: null,
  selectedRotoPathIds: [],
  selectedRotoPointRefs: [],
  recentRotoPointRefs: [],
  selectedViewerTargetId: keyboard.activeScopeId.startsWith('flow') ? 'node-1' : null,
  target,
  timelineMode: keyboard.activeScopeId.startsWith('timeline') ? 'dopesheet' : null,
  viewerSlot: null,
});

const Fixture: React.FC = () => {
  const flowRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [events, setEvents] = useState<string[]>([]);
  const isSpacePressed = useKeyPressed('Space');

  useHotkeyScope({ id: 'flow', ref: flowRef });
  useHotkeyScope({ id: 'viewport', ref: viewportRef });
  useHotkeyScope({ id: 'timeline', ref: timelineRef });

  const commands = useMemo<HotkeyCommand[]>(
    () => [
      {
        id: 'viewer.activateSlot',
        run: () => {
          setEvents((current) => [...current, 'activate']);
          return true;
        },
      },
      {
        id: 'viewer.assignSlot',
        run: () => {
          setEvents((current) => [...current, 'assign']);
          return true;
        },
      },
      {
        id: 'timeline.step',
        run: () => {
          setEvents((current) => [...current, 'timeline']);
          return true;
        },
      },
    ],
    [],
  );

  const bindings = useMemo<HotkeyBinding[]>(
    () => [
      { keys: '1', command: 'viewer.activateSlot' },
      {
        keys: '1',
        command: 'viewer.assignSlot',
        scope: 'flow',
        weight: 200,
        when: (context) => context.selectedViewerTargetId !== null,
      },
      { keys: 'A', command: 'timeline.step', scope: 'viewport' },
      { keys: 'Z', command: 'timeline.step', scope: 'timeline' },
    ],
    [],
  );

  useRegisterHotkeyCommands('fixture.commands', commands);
  useRegisterHotkeys('fixture.bindings', bindings);

  return (
    <div>
      <div ref={flowRef} data-testid="flow">
        <button type="button">Flow</button>
        <input data-testid="flow-input" aria-label="Flow name" />
      </div>
      <div ref={viewportRef} data-testid="viewport">
        <svg data-testid="viewport-overlay" viewBox="0 0 10 10">
          <path data-testid="viewport-overlay-path" d="M0 0L10 10" />
        </svg>
        <button type="button">Viewport</button>
      </div>
      <div ref={timelineRef} data-testid="timeline">
        <button type="button" data-testid="timeline-button">
          Timeline
        </button>
      </div>
      <output data-testid="events">{events.join(',')}</output>
      <output data-testid="space-state">{isSpacePressed ? 'down' : 'up'}</output>
    </div>
  );
};

describe('HotkeyProvider integration', () => {
  it('switches active scope by pointer and focus, and tracks pressed keys', () => {
    render(
      <HotkeyProvider buildContext={buildContext}>
        <Fixture />
      </HotkeyProvider>,
    );

    fireEvent.pointerDown(screen.getByTestId('flow'));
    fireEvent.keyDown(window, { key: '1', code: 'Digit1' });
    expect(screen.getByTestId('events').textContent).toBe('assign');

    fireEvent.pointerDown(screen.getByTestId('viewport'));
    fireEvent.keyDown(window, { key: '1', code: 'Digit1' });
    expect(screen.getByTestId('events').textContent).toBe('assign,activate');

    fireEvent.pointerDown(screen.getByTestId('flow'));
    fireEvent.focusIn(screen.getByTestId('timeline-button'));
    fireEvent.keyDown(window, { key: 'z', code: 'KeyZ' });
    expect(screen.getByTestId('events').textContent).toBe('assign,activate,timeline');

    fireEvent.focusOut(screen.getByTestId('timeline-button'), { relatedTarget: document.body });
    fireEvent.pointerDown(screen.getByTestId('viewport-overlay-path'));
    fireEvent.keyDown(window, { key: 'a', code: 'KeyA' });
    expect(screen.getByTestId('events').textContent).toBe('assign,activate,timeline,timeline');

    expect(screen.getByTestId('space-state').textContent).toBe('up');
    fireEvent.keyDown(window, { key: ' ', code: 'Space' });
    expect(screen.getByTestId('space-state').textContent).toBe('down');
    fireEvent.keyUp(window, { key: ' ', code: 'Space' });
    expect(screen.getByTestId('space-state').textContent).toBe('up');
  });

  it('blurs focused text entry when the pointer moves to non-text viewport content', () => {
    render(
      <HotkeyProvider buildContext={buildContext}>
        <Fixture />
      </HotkeyProvider>,
    );

    const input = screen.getByTestId('flow-input');
    input.focus();
    expect(document.activeElement).toBe(input);

    fireEvent.pointerDown(screen.getByTestId('viewport-overlay-path'), { button: 1 });
    expect(document.activeElement).not.toBe(input);

    fireEvent.keyDown(window, { key: 'a', code: 'KeyA' });
    expect(screen.getByTestId('events').textContent).toBe('timeline');
  });
});
