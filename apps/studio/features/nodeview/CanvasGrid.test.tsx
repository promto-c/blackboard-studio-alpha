// @vitest-environment jsdom

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import CanvasGrid from './CanvasGrid';

describe('CanvasGrid', () => {
  it('tracks canvas pan and zoom', () => {
    const { container } = render(<CanvasGrid zoom={2} panX={48} panY={-24} />);
    const grid = container.firstElementChild as HTMLElement;

    expect(grid.style.backgroundSize).toBe('48px 48px');
    expect(grid.style.backgroundPosition).toBe('48px -24px');
  });
});
