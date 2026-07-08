// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SegmentedControl } from './SegmentedControl';

describe('SegmentedControl', () => {
  afterEach(() => vi.restoreAllMocks());

  it('moves one shared glass indicator when the selection changes', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function () {
      return this.textContent === 'Sequence' ? 80 : 4;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(() => 72);

    const options = [
      { value: 'image', label: 'Image' },
      { value: 'sequence', label: 'Sequence' },
    ];
    const { rerender } = render(
      <SegmentedControl options={options} value="image" onChange={vi.fn()} />,
    );

    const control = screen.getByRole('radiogroup');
    expect(screen.getAllByTestId('segment-indicator')).toHaveLength(1);
    expect(control.style.getPropertyValue('--bb-segment-indicator-x')).toBe('4px');

    rerender(<SegmentedControl options={options} value="sequence" onChange={vi.fn()} />);

    expect(control.style.getPropertyValue('--bb-segment-indicator-x')).toBe('80px');
    expect(control.dataset.segmentMoving).toBe('true');
    expect(control.dataset.segmentDirection).toBe('forward');
  });

  it('keeps unsupported options visible but non-interactive', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        options={[
          { value: 'shape', label: 'Shape' },
          { value: 'layer', label: 'Layer', disabled: true },
        ]}
        value="shape"
        onChange={onChange}
      />,
    );

    const layerOption = screen.getByRole('radio', { name: 'Layer' });
    expect((layerOption as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(layerOption);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders supporting text while preserving explicit accessible labels', () => {
    render(
      <SegmentedControl
        ariaLabel="Scene size mode"
        options={[
          {
            value: 'scene',
            label: 'Keep Scene',
            description: '3840 × 2160',
            ariaLabel: 'Keep Scene, 3840 by 2160',
          },
        ]}
        value="scene"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('radiogroup', { name: 'Scene size mode' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Keep Scene, 3840 by 2160' })).toBeTruthy();
    expect(screen.getByText('3840 × 2160')).toBeTruthy();
  });
});
