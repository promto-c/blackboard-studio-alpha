import type { RefObject } from 'react';
import { useEffect, useLayoutEffect, useState } from 'react';
import * as THREE from 'three';
import { createStudioRenderer } from '@blackboard/renderer';

interface ViewportSize {
  width: number;
  height: number;
}

export const useViewportRenderer = (
  canvasRef: RefObject<HTMLCanvasElement>,
  viewportSize: ViewportSize,
  onDispose?: () => void,
  onError?: (message: string | null) => void,
) => {
  const [gl, setGl] = useState<THREE.WebGLRenderer | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    let renderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = createStudioRenderer({
        canvas: canvasRef.current,
        alpha: true,
        preserveDrawingBuffer: true,
        antialias: false,
        depth: false,
        stencil: false,
        // The viewport pipeline renders at an explicit scene or viewport
        // resolution. Applying devicePixelRatio again can turn a 4K compare
        // surface into an 8K drawing buffer and multiply preserved-buffer RAM.
        pixelRatio: 1,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Blackboard Studio requires WebGL2 support.';
      console.error('Could not initialize viewport renderer:', error);
      setGl(null);
      onError?.(message);
      return;
    }

    onError?.(null);
    setGl(renderer);

    return () => {
      renderer?.dispose();
      onDispose?.();
    };
  }, [canvasRef, onDispose, onError]);

  useLayoutEffect(() => {
    if (!gl) return;
    gl.setSize(viewportSize.width, viewportSize.height);
  }, [gl, viewportSize.width, viewportSize.height]);

  return gl;
};
