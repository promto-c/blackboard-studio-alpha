// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RangeSlider } from '@blackboard/ui';

describe('RangeSlider', () => {
  it('exposes two accessible handles and supports keyboard refinement', () => {
    const onValueChange = vi.fn();
    render(
      <RangeSlider
        label="Saturation"
        value={[0.2, 0.8]}
        step={0.1}
        onValueChange={onValueChange}
      />,
    );

    expect(screen.getAllByRole('slider')).toHaveLength(2);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Saturation low' }), {
      key: 'ArrowRight',
    });
    expect(onValueChange).toHaveBeenCalledWith([0.3, 0.8]);
  });

  it('does not allow either handle to cross the configured gap', () => {
    const onValueChange = vi.fn();
    render(
      <RangeSlider
        label="Clip"
        value={[0.4, 0.5]}
        step={0.1}
        minGap={0.1}
        onValueChange={onValueChange}
      />,
    );

    fireEvent.keyDown(screen.getByRole('slider', { name: 'Clip low' }), {
      key: 'ArrowRight',
    });
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('drags the selected span as one range while preserving its width', () => {
    const onInteractionStart = vi.fn();
    const onInteractionEnd = vi.fn();
    const changes: Array<[number, number]> = [];
    function Harness() {
      const [value, setValue] = useState<[number, number]>([0.2, 0.6]);
      return (
        <RangeSlider
          label="Hue"
          value={value}
          step={0.1}
          onValueChange={(next) => {
            changes.push(next);
            setValue(next);
          }}
          onInteractionStart={onInteractionStart}
          onInteractionEnd={onInteractionEnd}
        />
      );
    }

    const { container } = render(<Harness />);
    const fill = container.querySelector<HTMLElement>('[data-range-fill]')!;
    const track = fill.parentElement as HTMLElement;
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      right: 100,
      top: 0,
      bottom: 28,
      width: 100,
      height: 28,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    Object.defineProperties(track, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn(() => true) },
      releasePointerCapture: { value: vi.fn() },
    });

    fireEvent.pointerDown(fill, { button: 0, pointerId: 1, clientX: 30 });
    fireEvent.pointerMove(track, { pointerId: 1, clientX: 50 });
    expect(changes.at(-1)).toEqual([0.4, 0.8]);

    fireEvent.pointerMove(track, { pointerId: 1, clientX: 120 });
    expect(changes.at(-1)).toEqual([0.6, 1]);
    fireEvent.pointerUp(track, { pointerId: 1, clientX: 120 });

    expect(onInteractionStart).toHaveBeenCalledTimes(1);
    expect(onInteractionEnd).toHaveBeenCalledTimes(1);
  });
});
