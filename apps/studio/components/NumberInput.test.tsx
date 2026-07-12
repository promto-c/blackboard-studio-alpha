// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { NumberInput, type NumberInputChangeSource } from '@blackboard/ui';

function NumberInputHarness({
  onApply,
  onInteractionStart,
  onInteractionEnd,
}: {
  onApply: (value: number, source: NumberInputChangeSource) => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
}) {
  const [value, setValue] = useState(10);
  return (
    <NumberInput
      aria-label="Value"
      value={value}
      min={0}
      max={20}
      step={0.5}
      onInteractionStart={onInteractionStart}
      onInteractionEnd={onInteractionEnd}
      onValueChange={(nextValue, source) => {
        setValue(nextValue);
        onApply(nextValue, source);
      }}
    />
  );
}

describe('NumberInput', () => {
  it('keeps typed text as a draft and applies it on commit', () => {
    const onApply = vi.fn();
    render(<NumberInputHarness onApply={onApply} />);
    const input = screen.getByRole('spinbutton', { name: 'Value' });

    act(() => input.focus());
    fireEvent.change(input, { target: { value: '12.5' } });
    expect(onApply).not.toHaveBeenCalled();

    fireEvent.blur(input);
    expect(onApply).toHaveBeenCalledWith(12.5, 'commit');
  });

  it('does not emit a commit when focus leaves an unchanged value', () => {
    const onApply = vi.fn();
    render(<NumberInputHarness onApply={onApply} />);
    const input = screen.getByRole('spinbutton', { name: 'Value' });

    act(() => input.focus());
    fireEvent.blur(input);

    expect(onApply).not.toHaveBeenCalled();
  });

  it('applies keyboard and focused-wheel steps immediately', () => {
    const onApply = vi.fn();
    render(<NumberInputHarness onApply={onApply} />);
    const input = screen.getByRole('spinbutton', { name: 'Value' });

    act(() => input.focus());
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onApply).toHaveBeenLastCalledWith(10.5, 'keyboard');

    const wheelEvent = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 1,
    });
    fireEvent(input, wheelEvent);
    expect(onApply).toHaveBeenLastCalledWith(10, 'wheel');
    expect(wheelEvent.defaultPrevented).toBe(true);
  });

  it('renders a unit suffix inside the field without changing the numeric value', () => {
    const onApply = vi.fn();
    render(<NumberInput aria-label="Width" value={1920} suffix="px" onValueChange={onApply} />);

    const input = screen.getByRole('spinbutton', { name: 'Width' });
    const suffix = screen.getByText('px');

    expect((input as HTMLInputElement).value).toBe('1920');
    expect(input.className).toContain('!pr-10');
    expect(suffix.hasAttribute('data-number-input-suffix')).toBe(true);
    expect(suffix.getAttribute('aria-hidden')).toBe('true');
    expect(suffix.parentElement?.contains(input)).toBe(true);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('scrubs across the whole inactive field and keeps click-to-edit available', () => {
    const onApply = vi.fn();
    const lifecycle: string[] = [];
    render(
      <NumberInputHarness
        onApply={(value, source) => {
          lifecycle.push('change');
          onApply(value, source);
        }}
        onInteractionStart={() => lifecycle.push('start')}
        onInteractionEnd={() => lifecycle.push('end')}
      />,
    );
    const input = screen.getByRole('spinbutton', { name: 'Value' });
    Object.defineProperties(input, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn(() => true) },
      releasePointerCapture: { value: vi.fn() },
    });

    expect(input.className).toContain('bb-control-input');
    expect(input.className).toContain('!cursor-ew-resize');
    expect(input.className).not.toContain('!cursor-text');
    fireEvent.pointerDown(input, { button: 0, pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(input, { pointerId: 1, clientX: 108 });

    expect(onApply).toHaveBeenLastCalledWith(14, 'drag');
    expect(input.getAttribute('data-dragging')).toBe('true');

    fireEvent.pointerUp(input, { pointerId: 1, clientX: 108 });
    expect(input.getAttribute('data-dragging')).toBe('false');
    expect(document.body.style.cursor).toBe('');
    expect(lifecycle).toEqual(['start', 'change', 'end']);

    const animationFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });
    fireEvent.pointerDown(input, { button: 0, pointerId: 2, clientX: 100 });
    fireEvent.pointerUp(input, { pointerId: 2, clientX: 100 });
    expect(input.getAttribute('data-editing')).toBe('true');
    expect(input.className).toContain('!cursor-text');
    expect(document.activeElement).toBe(input);
    animationFrame.mockRestore();
  });
});
