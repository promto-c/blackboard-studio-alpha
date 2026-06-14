import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStudioRenderer } from '../../../packages/renderer/src/webgl';

const { webGLRendererMock, rawShaderMaterialMock } = vi.hoisted(() => ({
  webGLRendererMock: vi.fn(),
  rawShaderMaterialMock: vi.fn(),
}));

vi.mock('three', () => ({
  GLSL3: '300 es',
  RawShaderMaterial: rawShaderMaterialMock,
  WebGLRenderer: webGLRendererMock,
}));

const createCanvasMock = (context: unknown): HTMLCanvasElement =>
  ({
    getContext: vi.fn(() => context),
  }) as unknown as HTMLCanvasElement;

describe('createStudioRenderer', () => {
  beforeEach(() => {
    webGLRendererMock.mockReset();
  });

  it('fails before constructing Three renderer when WebGL returns a lost context', () => {
    const context = {
      getContextAttributes: vi.fn(() => null),
    };

    expect(() => createStudioRenderer({ canvas: createCanvasMock(context) })).toThrow(
      'Blackboard Studio could not initialize WebGL2 because the context is lost.',
    );
    expect(webGLRendererMock).not.toHaveBeenCalled();
  });

  it('constructs a WebGL2 Three renderer when the context is usable', () => {
    const context = {
      getContextAttributes: vi.fn(() => ({ alpha: true })),
    };
    const renderer = {
      capabilities: { isWebGL2: true },
      setPixelRatio: vi.fn(),
    };
    webGLRendererMock.mockImplementation(function WebGLRenderer() {
      return renderer;
    });

    expect(createStudioRenderer({ canvas: createCanvasMock(context), pixelRatio: 2 })).toBe(
      renderer,
    );
    expect(webGLRendererMock).toHaveBeenCalledWith(
      expect.objectContaining({
        canvas: expect.any(Object),
        context,
      }),
    );
    expect(renderer.setPixelRatio).toHaveBeenCalledWith(2);
  });
});
