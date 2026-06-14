import { useCallback, useEffect, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import type { SceneNode } from '@blackboard/types';

export type ViewportPixelInfo = {
  x: number;
  y: number;
  color: [number, number, number, number];
};

const PIXEL_INFO_COLOR_EPSILON = 1 / 65535;

const arePixelInfoEqual = (
  left: ViewportPixelInfo | null,
  right: ViewportPixelInfo | null,
): boolean => {
  if (left === right) return true;
  if (!left || !right) return false;
  if (left.x !== right.x || left.y !== right.y) return false;
  return left.color.every(
    (channel, index) => Math.abs(channel - right.color[index]) <= PIXEL_INFO_COLOR_EPSILON,
  );
};

export type ViewportPixelInfoSetter = React.Dispatch<
  React.SetStateAction<ViewportPixelInfo | null>
>;

type UseViewportPixelInspectorOptions = {
  gl: THREE.WebGLRenderer | null;
  finalCompBufferRef: RefObject<THREE.WebGLRenderTarget | null>;
  sceneNode: SceneNode | null | undefined;
  hasRenderableOutput: boolean;
  isLoading: boolean;
  isPlaying: boolean;
  mouseScenePos: { x: number; y: number } | null;
  viewerNodeId: string | null | undefined;
  pixelInfo: ViewportPixelInfo | null;
  setPixelInfo: ViewportPixelInfoSetter;
};

export const useViewportPixelInspector = ({
  gl,
  finalCompBufferRef,
  sceneNode,
  hasRenderableOutput,
  isLoading,
  isPlaying,
  mouseScenePos,
  viewerNodeId,
  pixelInfo: _pixelInfo,
  setPixelInfo,
}: UseViewportPixelInspectorOptions) => {
  const pixelReadBuffer8Ref = useRef(new Uint8Array(4));
  const pixelReadBuffer16Ref = useRef(new Uint16Array(4));
  const pixelReadBuffer32Ref = useRef(new Float32Array(4));
  const pixelInfoRef = useRef<ViewportPixelInfo | null>(_pixelInfo);
  const mouseScenePosRef = useRef(mouseScenePos);
  const isPlayingRef = useRef(isPlaying);

  useEffect(() => {
    mouseScenePosRef.current = mouseScenePos;
  }, [mouseScenePos]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const setMouseScenePosRef = useCallback((nextMouseScenePos: { x: number; y: number } | null) => {
    mouseScenePosRef.current = nextMouseScenePos;
  }, []);

  const setPixelInfoIfChanged = useCallback(
    (nextPixelInfo: ViewportPixelInfo | null) => {
      if (arePixelInfoEqual(pixelInfoRef.current, nextPixelInfo)) return;
      pixelInfoRef.current = nextPixelInfo;
      setPixelInfo(nextPixelInfo);
    },
    [setPixelInfo],
  );

  const clearPixelInfo = useCallback(() => {
    setPixelInfoIfChanged(null);
  }, [setPixelInfoIfChanged]);

  const readPixelColor = useCallback(
    (
      renderTarget: THREE.WebGLRenderTarget,
      x: number,
      y: number,
    ): [number, number, number, number] => {
      if (!gl) return [0, 0, 0, 0];
      const textureType = renderTarget.texture.type;

      if (textureType === THREE.FloatType) {
        const buffer = pixelReadBuffer32Ref.current;
        gl.readRenderTargetPixels(renderTarget, x, y, 1, 1, buffer);
        return [buffer[0], buffer[1], buffer[2], buffer[3]];
      }

      if (textureType === THREE.HalfFloatType) {
        const buffer = pixelReadBuffer16Ref.current;
        gl.readRenderTargetPixels(renderTarget, x, y, 1, 1, buffer);
        return [
          THREE.DataUtils.fromHalfFloat(buffer[0]),
          THREE.DataUtils.fromHalfFloat(buffer[1]),
          THREE.DataUtils.fromHalfFloat(buffer[2]),
          THREE.DataUtils.fromHalfFloat(buffer[3]),
        ];
      }

      const buffer = pixelReadBuffer8Ref.current;
      gl.readRenderTargetPixels(renderTarget, x, y, 1, 1, buffer);
      return [buffer[0] / 255, buffer[1] / 255, buffer[2] / 255, buffer[3] / 255];
    },
    [gl],
  );

  const updatePixelInfoAtScenePos = useCallback(
    (scenePos: { x: number; y: number } | null) => {
      if (!scenePos || !gl || !sceneNode || !finalCompBufferRef.current || !hasRenderableOutput) {
        setPixelInfoIfChanged(null);
        return;
      }

      if (isLoading) {
        return;
      }

      const sceneX = Math.floor(scenePos.x + sceneNode.width / 2);
      const sceneY = Math.floor(scenePos.y + sceneNode.height / 2);

      if (sceneX < 0 || sceneX >= sceneNode.width || sceneY < 0 || sceneY >= sceneNode.height) {
        setPixelInfoIfChanged(null);
        return;
      }

      const color = readPixelColor(
        finalCompBufferRef.current,
        sceneX,
        sceneNode.height - 1 - sceneY,
      );
      setPixelInfoIfChanged({
        x: sceneX,
        y: sceneY,
        color,
      });
    },
    [
      finalCompBufferRef,
      gl,
      hasRenderableOutput,
      isLoading,
      readPixelColor,
      sceneNode,
      setPixelInfoIfChanged,
    ],
  );

  const refreshPixelInfoAfterRender = useCallback(() => {
    if (!isPlayingRef.current) {
      updatePixelInfoAtScenePos(mouseScenePosRef.current);
    }
  }, [updatePixelInfoAtScenePos]);

  useEffect(() => {
    if (isPlaying) return;
    updatePixelInfoAtScenePos(mouseScenePos);
  }, [isPlaying, mouseScenePos, updatePixelInfoAtScenePos, viewerNodeId]);

  useEffect(() => {
    if (!sceneNode || !hasRenderableOutput) {
      setPixelInfoIfChanged(null);
    }
  }, [hasRenderableOutput, sceneNode, setPixelInfoIfChanged]);

  return {
    pixelInfo: _pixelInfo,
    clearPixelInfo,
    setMouseScenePosRef,
    updatePixelInfoAtScenePos,
    refreshPixelInfoAfterRender,
  };
};
