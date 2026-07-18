// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ViewportWindowLabels } from './ViewportWindowLabels';

describe('ViewportWindowLabels', () => {
  it('keeps labels screen-sized while reporting native data-window changes', () => {
    const { container } = render(
      <ViewportWindowLabels
        visible
        zoom={0.25}
        displayWindowRect={{ x: 0, y: 0, width: 1080, height: 1920 }}
        dataWindowRect={{
          x: 20,
          y: 30,
          width: 800,
          height: 1200,
          nativeWidth: 640,
          nativeHeight: 960,
        }}
        showDataWindow
        dataWindowIsHandled
      />,
    );

    const displayLabel = container.querySelector<HTMLElement>(
      '[data-viewport-window-label="display"]',
    );
    const dataLabel = container.querySelector<HTMLElement>('[data-viewport-window-label="data"]');

    expect(displayLabel?.style.transform).toBe('translate(-4px, -100%) scale(4)');
    expect(dataLabel?.title).toContain('Native before this node: 640 x 960');
  });
});
