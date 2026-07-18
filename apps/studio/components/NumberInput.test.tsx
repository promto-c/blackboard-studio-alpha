// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { NumberInput, type NumberInputChangeSource } from '@blackboard/ui';

function NumberInputHarness({
  onApply,
  onInteractionStart,
  onInteractionEnd,
  min = 0,
  max = 20,
}: {
  onApply: (value: number, source: NumberInputChangeSource) => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
  min?: number;
  max?: number;
}) {
  const [value, setValue] = useState(10);
  return (
    <NumberInput
      aria-label="Value"
      value={value}
      min={min}
      max={max}
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

  it('applies keyboard and focused-wheel steps at the selection caret', () => {
    const onApply = vi.fn();
    render(<NumberInputHarness onApply={onApply} />);
    const input = screen.getByRole('spinbutton', { name: 'Value' });

    act(() => input.focus());
    (input as HTMLInputElement).select();
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onApply).toHaveBeenLastCalledWith(11, 'keyboard');

    const wheelEvent = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 1,
    });
    fireEvent(input, wheelEvent);
    expect(onApply).toHaveBeenLastCalledWith(10, 'wheel');
    expect(wheelEvent.defaultPrevented).toBe(true);
  });

  it('steps the digit immediately left of the active text caret', () => {
    const onApply = vi.fn();
    render(<NumberInputHarness max={100} onApply={onApply} />);
    const input = screen.getByRole('spinbutton', { name: 'Value' }) as HTMLInputElement;

    act(() => input.focus());
    fireEvent.change(input, { target: { value: '12.345' } });

    input.setSelectionRange(4, 4);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onApply).toHaveBeenLastCalledWith(12.445, 'keyboard');
    expect(input.value).toBe('12.445');
    expect(input.selectionStart).toBe(4);

    fireEvent.change(input, { target: { value: '12.345' } });
    input.setSelectionRange(4, 4);
    const wheelEvent = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 1,
    });
    fireEvent(input, wheelEvent);

    expect(onApply).toHaveBeenLastCalledWith(12.245, 'wheel');
    expect(input.value).toBe('12.245');
    expect(input.selectionStart).toBe(4);
    expect(wheelEvent.defaultPrevented).toBe(true);
  });

  it('handles caret boundaries, punctuation, and negative signs', () => {
    const onApply = vi.fn();
    render(<NumberInputHarness min={-100} max={100} onApply={onApply} />);
    const input = screen.getByRole('spinbutton', { name: 'Value' }) as HTMLInputElement;

    act(() => input.focus());

    fireEvent.change(input, { target: { value: '12.345' } });
    input.setSelectionRange(0, 0);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onApply).toHaveBeenLastCalledWith(22.345, 'keyboard');

    fireEvent.change(input, { target: { value: '12.345' } });
    input.setSelectionRange(6, 6);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onApply).toHaveBeenLastCalledWith(12.346, 'keyboard');

    fireEvent.change(input, { target: { value: '12.345' } });
    input.setSelectionRange(3, 3);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onApply).toHaveBeenLastCalledWith(13.345, 'keyboard');

    fireEvent.change(input, { target: { value: '-12.345' } });
    input.setSelectionRange(3, 3);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onApply).toHaveBeenLastCalledWith(-11.345, 'keyboard');
  });

  it('always uses the right edge as the caret when text is selected', () => {
    const onApply = vi.fn();
    render(<NumberInputHarness max={100} onApply={onApply} />);
    const input = screen.getByRole('spinbutton', { name: 'Value' }) as HTMLInputElement;

    act(() => input.focus());
    fireEvent.change(input, { target: { value: '12.345' } });
    input.setSelectionRange(1, 4, 'forward');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onApply).toHaveBeenLastCalledWith(12.445, 'keyboard');
    expect(input.selectionDirection).toBe('forward');

    fireEvent.change(input, { target: { value: '12.345' } });
    input.setSelectionRange(1, 4, 'backward');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onApply).toHaveBeenLastCalledWith(12.445, 'keyboard');
    expect(input.selectionDirection).toBe('backward');
  });

  it('preserves the caret precision when a fractional step produces trailing zeroes', () => {
    const onApply = vi.fn();
    render(<NumberInput aria-label="Precise value" value={1.01} onValueChange={onApply} />);
    const input = screen.getByRole('spinbutton', { name: 'Precise value' }) as HTMLInputElement;

    act(() => input.focus());
    input.setSelectionRange(4, 4);
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    expect(onApply).toHaveBeenLastCalledWith(1, 'keyboard');
    expect(input.value).toBe('1.00');
    expect(input.selectionStart).toBe(4);
  });

  it('extends decimal precision when ArrowRight moves beyond the value', () => {
    const onApply = vi.fn();
    render(<NumberInput aria-label="Extend precision" value={10.12} onValueChange={onApply} />);
    const input = screen.getByRole('spinbutton', { name: 'Extend precision' }) as HTMLInputElement;

    act(() => input.focus());
    input.setSelectionRange(input.value.length, input.value.length);
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    expect(input.value).toBe('10.120');
    expect(input.selectionStart).toBe(6);
    expect(onApply).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'ArrowRight' });
    expect(input.value).toBe('10.1200');
    expect(input.selectionStart).toBe(7);
    expect(onApply).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.value).toBe('10.1201');
    expect(onApply).toHaveBeenLastCalledWith(10.1201, 'keyboard');
  });

  it('starts decimal precision when ArrowRight moves beyond an integer', () => {
    const onApply = vi.fn();
    render(<NumberInput aria-label="Integer precision" value={10} onValueChange={onApply} />);
    const input = screen.getByRole('spinbutton', { name: 'Integer precision' }) as HTMLInputElement;

    act(() => input.focus());
    input.setSelectionRange(input.value.length, input.value.length);
    fireEvent.keyDown(input, { key: 'ArrowRight' });

    expect(input.value).toBe('10.0');
    expect(input.selectionStart).toBe(4);
    expect(onApply).not.toHaveBeenCalled();
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
