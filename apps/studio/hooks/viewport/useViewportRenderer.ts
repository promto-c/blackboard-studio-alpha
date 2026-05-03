import type { RefObject } from 'react';
import { useEffect, useState } from 'react';
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
) => {
  const [gl, setGl] = useState<THREE.WebGLRenderer | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const renderer = createStudioRenderer({
      canvas: canvasRef.current,
      alpha: true,
      preserveDrawingBuffer: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      pixelRatio: window.devicePixelRatio,
    });
    setGl(renderer);

    return () => {
      renderer.dispose();
      onDispose?.();
    };
  }, [canvasRef, onDispose]);

  useEffect(() => {
    if (!gl) return;
    gl.setSize(viewportSize.width, viewportSize.height);
  }, [gl, viewportSize.width, viewportSize.height]);

  return gl;
};
