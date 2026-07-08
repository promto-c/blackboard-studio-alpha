// @vitest-environment jsdom

import { act, render } from '@testing-library/react';
import { useRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useViewportProximity, type ViewportProximity } from './useNearViewport';

let observerCallback: IntersectionObserverCallback;
let observerOptions: IntersectionObserverInit | undefined;

class IntersectionObserverMock {
  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    observerCallback = callback;
    observerOptions = options;
  }
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
  takeRecords = vi.fn(() => []);
  root = null;
  rootMargin = '';
  thresholds = [];
}

function Harness({ onChange }: { onChange: (value: ViewportProximity) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const proximity = useViewportProximity(ref, { rootMargin: '320px' });
  onChange(proximity);
  return (
    <div className="bb-scroll-area__viewport" data-testid="root">
      <div ref={ref} data-testid="card" />
    </div>
  );
}

describe('useViewportProximity', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', IntersectionObserverMock);
  });

  it('uses the custom ScrollArea viewport and distinguishes near from visible', () => {
    let proximity: ViewportProximity = 'outside';
    const view = render(<Harness onChange={(value) => (proximity = value)} />);
    const root = view.getByTestId('root');
    const card = view.getByTestId('card');
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 500,
      left: 0,
      right: 500,
      width: 500,
      height: 500,
      x: 0,
      y: 0,
      toJSON: () => undefined,
    });
    expect(observerOptions?.root).toBe(root);
    expect(observerOptions?.rootMargin).toBe('320px');

    act(() => {
      observerCallback(
        [
          {
            isIntersecting: true,
            target: card,
            boundingClientRect: {
              top: 600,
              bottom: 700,
              left: 0,
              right: 100,
            },
          } as unknown as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      );
    });
    expect(proximity).toBe('near');

    act(() => {
      observerCallback(
        [
          {
            isIntersecting: true,
            target: card,
            boundingClientRect: {
              top: 100,
              bottom: 200,
              left: 0,
              right: 100,
            },
          } as unknown as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      );
    });
    expect(proximity).toBe('visible');

    act(() => {
      observerCallback(
        [{ isIntersecting: false, target: card } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
    expect(proximity).toBe('outside');
  });
});
