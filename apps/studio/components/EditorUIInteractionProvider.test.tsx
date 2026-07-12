// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NumberInput, Slider } from '@blackboard/ui';
import { EditorUIInteractionProvider } from './EditorUIInteractionProvider';

const mocks = vi.hoisted(() => ({
  beginHistoryInteraction: vi.fn(),
  endHistoryInteraction: vi.fn(),
}));

vi.mock('@/state/editorContext', () => ({
  useEditorActions: () => mocks,
}));

function Harness() {
  const [value, setValue] = useState(10);

  return (
    <EditorUIInteractionProvider>
      <NumberInput aria-label="History value" value={value} step={1} onValueChange={setValue} />
    </EditorUIInteractionProvider>
  );
}

function SliderHarness() {
  const [value, setValue] = useState(10);

  return (
    <EditorUIInteractionProvider>
      <Slider label="Scale" value={value} min={0} max={20} step={1} onChange={setValue} />
    </EditorUIInteractionProvider>
  );
}

describe('EditorUIInteractionProvider', () => {
  beforeEach(() => vi.clearAllMocks());

  it('coalesces an entire numeric scrub through one editor history interaction', () => {
    render(<Harness />);
    const input = screen.getByRole('spinbutton', { name: 'History value' });
    Object.defineProperties(input, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn(() => true) },
      releasePointerCapture: { value: vi.fn() },
    });

    fireEvent.pointerDown(input, { button: 0, pointerId: 1, clientX: 40 });
    fireEvent.pointerMove(input, { pointerId: 1, clientX: 46 });
    fireEvent.pointerMove(input, { pointerId: 1, clientX: 52 });
    fireEvent.pointerUp(input, { pointerId: 1, clientX: 52 });

    expect(mocks.beginHistoryInteraction).toHaveBeenCalledTimes(1);
    expect(mocks.endHistoryInteraction).toHaveBeenCalledTimes(1);
    expect(mocks.endHistoryInteraction).toHaveBeenCalledWith(
      mocks.beginHistoryInteraction.mock.calls[0][0],
    );
  });

  it('closes an active history interaction when the control unmounts', () => {
    const { unmount } = render(<Harness />);
    const input = screen.getByRole('spinbutton', { name: 'History value' });
    Object.defineProperty(input, 'setPointerCapture', { value: vi.fn() });

    fireEvent.pointerDown(input, { button: 0, pointerId: 1, clientX: 40 });
    fireEvent.pointerMove(input, { pointerId: 1, clientX: 46 });
    unmount();

    expect(mocks.beginHistoryInteraction).toHaveBeenCalledTimes(1);
    expect(mocks.endHistoryInteraction).toHaveBeenCalledTimes(1);
    expect(mocks.endHistoryInteraction).toHaveBeenCalledWith(
      mocks.beginHistoryInteraction.mock.calls[0][0],
    );
  });

  it('coalesces a complete slider gesture through the same shared interaction system', () => {
    render(<SliderHarness />);
    const slider = screen.getByRole('slider', { name: 'Scale' });

    fireEvent.pointerDown(slider, { button: 0, pointerId: 1 });
    fireEvent.input(slider, { target: { value: '12' } });
    fireEvent.input(slider, { target: { value: '14' } });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(mocks.beginHistoryInteraction).toHaveBeenCalledTimes(1);
    expect(mocks.endHistoryInteraction).toHaveBeenCalledTimes(1);
    expect(mocks.endHistoryInteraction).toHaveBeenCalledWith(
      mocks.beginHistoryInteraction.mock.calls[0][0],
    );
  });
});
