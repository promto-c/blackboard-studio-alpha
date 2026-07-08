import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertFloatRenderTargetSupport,
  createStudioRenderer,
} from '../../../packages/renderer/src/webgl';

const { webGLRendererMock, webGLRenderTargetMock, rawShaderMaterialMock } = vi.hoisted(() => ({
  webGLRendererMock: vi.fn(),
  webGLRenderTargetMock: vi.fn(),
  rawShaderMaterialMock: vi.fn(),
}));

vi.mock('three', () => ({
  GLSL3: '300 es',
  NoColorSpace: '',
  FloatType: 1015,
  HalfFloatType: 1016,
  RGBAFormat: 1023,
  RawShaderMaterial: rawShaderMaterialMock,
  WebGLRenderer: webGLRendererMock,
  WebGLRenderTarget: webGLRenderTargetMock,
}));

const createCanvasMock = (context: unknown): HTMLCanvasElement =>
  ({
    getContext: vi.fn(() => context),
  }) as unknown as HTMLCanvasElement;

describe('createStudioRenderer', () => {
  beforeEach(() => {
    webGLRendererMock.mockReset();
    webGLRenderTargetMock.mockReset();
    webGLRenderTargetMock.mockImplementation(function WebGLRenderTarget() {
      return { dispose: vi.fn() };
    });
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
      outputColorSpace: 'srgb',
    };
    const canvas = createCanvasMock(context);
    webGLRendererMock.mockImplementation(function WebGLRenderer() {
      return renderer;
    });

    expect(createStudioRenderer({ canvas, pixelRatio: 2 })).toBe(renderer);
    expect(canvas.getContext).toHaveBeenCalledWith(
      'webgl2',
      expect.objectContaining({ premultipliedAlpha: false }),
    );
    expect(webGLRendererMock).toHaveBeenCalledWith(
      expect.objectContaining({
        canvas: expect.any(Object),
        context,
        premultipliedAlpha: false,
      }),
    );
    expect(renderer.setPixelRatio).toHaveBeenCalledWith(2);
    expect(renderer.outputColorSpace).toBe('srgb');
  });

  it('rejects required float formats when real framebuffer creation is incomplete', () => {
    const previousTarget = { name: 'previous' };
    const context = {
      FRAMEBUFFER: 0x8d40,
      FRAMEBUFFER_COMPLETE: 0x8cd5,
      checkFramebufferStatus: vi.fn(() => 0x8cdd),
    };
    const renderer = {
      extensions: { has: vi.fn(() => true) },
      getContext: vi.fn(() => context),
      getRenderTarget: vi.fn(() => previousTarget),
      setRenderTarget: vi.fn(),
    };

    expect(() => assertFloatRenderTargetSupport(renderer as never)).toThrow(
      'RGBA16F render targets',
    );
    expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(previousTarget);
  });

  it('probes both required float framebuffer formats', () => {
    const context = {
      FRAMEBUFFER: 0x8d40,
      FRAMEBUFFER_COMPLETE: 0x8cd5,
      checkFramebufferStatus: vi.fn(() => 0x8cd5),
    };
    const renderer = {
      extensions: { has: vi.fn(() => true) },
      getContext: vi.fn(() => context),
      getRenderTarget: vi.fn(() => null),
      setRenderTarget: vi.fn(),
    };

    assertFloatRenderTargetSupport(renderer as never);
    assertFloatRenderTargetSupport(renderer as never);

    expect(webGLRenderTargetMock).toHaveBeenCalledTimes(2);
    expect(webGLRenderTargetMock).toHaveBeenNthCalledWith(
      1,
      1,
      1,
      expect.objectContaining({ type: 1016 }),
    );
    expect(webGLRenderTargetMock).toHaveBeenNthCalledWith(
      2,
      1,
      1,
      expect.objectContaining({ type: 1015 }),
    );
    expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(null);
  });
});
