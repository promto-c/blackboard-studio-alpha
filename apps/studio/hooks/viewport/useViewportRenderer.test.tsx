// @vitest-environment jsdom
import React, { StrictMode, useRef } from 'react';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useViewportRenderer } from './useViewportRenderer';

const { createStudioRendererMock } = vi.hoisted(() => ({
  createStudioRendererMock: vi.fn(),
}));

vi.mock('@blackboard/renderer', () => ({
  createStudioRenderer: createStudioRendererMock,
}));

interface MockRenderer {
  setSize: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  forceContextLoss: ReturnType<typeof vi.fn>;
}

const createMockRenderer = (): MockRenderer => ({
  setSize: vi.fn(),
  dispose: vi.fn(),
  forceContextLoss: vi.fn(),
});

function RendererProbe({
  onDispose,
  onError,
}: {
  onDispose: () => void;
  onError: (message: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useViewportRenderer(canvasRef, { width: 320, height: 240 }, onDispose, onError);

  return <canvas ref={canvasRef} />;
}

describe('useViewportRenderer', () => {
  beforeEach(() => {
    createStudioRendererMock.mockReset();
  });

  it('disposes the viewport renderer without forcing context loss during StrictMode cleanup', async () => {
    const renderers: MockRenderer[] = [];
    createStudioRendererMock.mockImplementation(() => {
      const renderer = createMockRenderer();
      renderers.push(renderer);
      return renderer;
    });

    const onDispose = vi.fn();
    const onError = vi.fn();
    const { unmount } = render(
      <StrictMode>
        <RendererProbe onDispose={onDispose} onError={onError} />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(
        renderers.some((renderer) =>
          renderer.setSize.mock.calls.some(([width, height]) => width === 320 && height === 240),
        ),
      ).toBe(true);
    });

    unmount();

    expect(renderers.some((renderer) => renderer.dispose.mock.calls.length > 0)).toBe(true);
    expect(renderers.some((renderer) => renderer.forceContextLoss.mock.calls.length > 0)).toBe(
      false,
    );
    expect(onDispose).toHaveBeenCalled();
  });
});
