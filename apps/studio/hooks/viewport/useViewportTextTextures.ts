import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { NodeType, type AnyNode, type TextNode } from '@blackboard/types';
import { getValueAtFrame } from '@blackboard/renderer';

interface TextTextureEntry {
  texture: THREE.Texture;
  width: number;
  height: number;
  key: string;
}

interface UseViewportTextTexturesOptions {
  nodes: AnyNode[];
  currentFrame: number;
  bumpMediaUpdate: () => void;
}

export const useViewportTextTextures = ({
  nodes,
  currentFrame,
  bumpMediaUpdate,
}: UseViewportTextTexturesOptions) => {
  const textTexturesRef = useRef<Map<string, TextTextureEntry>>(new Map());

  useEffect(() => {
    const textNodes = nodes.filter((node) => node.type === NodeType.TEXT) as TextNode[];
    const nextTextures = new Map<string, TextTextureEntry>();
    let didUpdate = false;

    textNodes.forEach((node) => {
      const fontSizeAtFrame = getValueAtFrame(node.fontSize, currentFrame);
      const rotationAtFrame = getValueAtFrame(node.rotation, currentFrame);
      const key = [
        node.text,
        node.fontFamily,
        fontSizeAtFrame,
        rotationAtFrame,
        node.color.join(','),
      ].join('|');

      const existing = textTexturesRef.current.get(node.id);
      if (existing && existing.key === key) {
        nextTextures.set(node.id, existing);
        return;
      }

      if (existing) {
        existing.texture.dispose();
        didUpdate = true;
      }

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const FONT_PADDING = 1.2;
      const font = `${fontSizeAtFrame}px ${node.fontFamily}`;
      ctx.font = font;
      const metrics = ctx.measureText(node.text);
      const textWidth = metrics.width;
      const textHeight = fontSizeAtFrame;
      const rad = (rotationAtFrame * Math.PI) / 180;
      const cos = Math.abs(Math.cos(rad));
      const sin = Math.abs(Math.sin(rad));
      const canvasWidth = Math.ceil(textWidth * cos + textHeight * sin);
      const canvasHeight = Math.ceil(textWidth * sin + textHeight * cos);

      canvas.width = canvasWidth * FONT_PADDING;
      canvas.height = canvasHeight * FONT_PADDING;
      ctx.font = font;
      ctx.fillStyle = `rgb(${node.color.map((c) => c * 255).join(',')})`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(rad);
      ctx.fillText(node.text, 0, 0);

      const texture = new THREE.CanvasTexture(canvas);
      texture.needsUpdate = true;

      nextTextures.set(node.id, {
        texture,
        width: canvas.width,
        height: canvas.height,
        key,
      });
      didUpdate = true;
    });

    textTexturesRef.current.forEach((entry, id) => {
      if (!nextTextures.has(id)) {
        entry.texture.dispose();
        didUpdate = true;
      }
    });

    textTexturesRef.current = nextTextures;
    if (didUpdate) bumpMediaUpdate();
  }, [nodes, currentFrame, bumpMediaUpdate]);

  return textTexturesRef;
};
