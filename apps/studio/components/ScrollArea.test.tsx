// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react';
import { ScrollArea } from '@blackboard/ui';
import { describe, expect, it } from 'vitest';

const defineScrollMetrics = (
  viewport: HTMLElement,
  { clientHeight, scrollHeight }: { clientHeight: number; scrollHeight: number },
) => {
  Object.defineProperties(viewport, {
    clientHeight: { configurable: true, value: clientHeight },
    scrollHeight: { configurable: true, value: scrollHeight },
  });
};

describe('ScrollArea edge fades', () => {
  it('masks content to transparency only where more vertical content exists', () => {
    const { container } = render(
      <ScrollArea axis="y" fadeEdges>
        Content
      </ScrollArea>,
    );
    const viewport = container.querySelector<HTMLElement>('.bb-scroll-area__viewport');
    expect(viewport).not.toBeNull();

    defineScrollMetrics(viewport!, { clientHeight: 100, scrollHeight: 300 });

    viewport!.scrollTop = 0;
    fireEvent.scroll(viewport!);
    expect(viewport!.style.maskImage).toContain('rgba(0, 0, 0, 1.000) 0');
    expect(viewport!.style.maskImage).toContain('rgba(0, 0, 0, 0.000) 100%');

    viewport!.scrollTop = 12;
    fireEvent.scroll(viewport!);
    expect(viewport!.style.maskImage).toContain('rgba(0, 0, 0, 0.500) 0');

    viewport!.scrollTop = 100;
    fireEvent.scroll(viewport!);
    expect(viewport!.style.maskImage).toContain('rgba(0, 0, 0, 0.000) 0');
    expect(viewport!.style.maskImage).toContain('rgba(0, 0, 0, 0.000) 100%');

    viewport!.scrollTop = 188;
    fireEvent.scroll(viewport!);
    expect(viewport!.style.maskImage).toContain('rgba(0, 0, 0, 0.500) 100%');

    viewport!.scrollTop = 200;
    fireEvent.scroll(viewport!);
    expect(viewport!.style.maskImage).toContain('rgba(0, 0, 0, 0.000) 0');
    expect(viewport!.style.maskImage).toContain('rgba(0, 0, 0, 1.000) 100%');
  });

  it('does not mask content that fits', () => {
    const { container } = render(
      <ScrollArea axis="y" fadeEdges>
        Content
      </ScrollArea>,
    );
    const viewport = container.querySelector<HTMLElement>('.bb-scroll-area__viewport');
    expect(viewport).not.toBeNull();

    defineScrollMetrics(viewport!, { clientHeight: 100, scrollHeight: 100 });
    fireEvent.scroll(viewport!);

    expect(viewport!.style.maskImage).toBe('');
  });

  it('composites backdrop blur and transparency on the same scroll surface', () => {
    const { container } = render(
      <ScrollArea axis="y" fadeEdges={{ backdropBlur: 8 }}>
        Content
      </ScrollArea>,
    );
    const viewport = container.querySelector<HTMLElement>('.bb-scroll-area__viewport');
    expect(viewport).not.toBeNull();

    defineScrollMetrics(viewport!, { clientHeight: 100, scrollHeight: 300 });
    viewport!.scrollTop = 0;
    fireEvent.scroll(viewport!);

    expect(viewport!.style.backdropFilter).toBe('blur(8px)');
    expect(viewport!.style.backgroundColor).toBe('');
    expect(viewport!.style.maskImage).toContain('rgba(0, 0, 0, 0.000) 100%');
    expect(container.querySelector('[data-scroll-edge-blur]')).toBeNull();
  });
});
