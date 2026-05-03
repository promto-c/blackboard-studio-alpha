import React, { useState, useEffect, useRef } from 'react';
import { renderStackToDataURL } from '@/utils/thumbnailRenderer';
import { AnyNode, SceneNode } from '@blackboard/types';
import { useEditorSelector } from '@/state/editorContext';

interface Props {
  stack: AnyNode[];
  sceneNode: SceneNode;
  /** When set, render only this frame instead of following the current playback frame. */
  staticFrame?: number;
}

const THUMBNAIL_DEBOUNCE_MS = 200;

const Spinner: React.FC = () => (
  <svg
    className="animate-spin h-5 w-5 text-gray-400"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
  >
    <circle
      className="opacity-25"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
    ></circle>
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    ></path>
  </svg>
);

const LiveThumbnail: React.FC<Props> = React.memo(({ stack, sceneNode, staticFrame }) => {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const currentFrame = useEditorSelector((s) => s.currentFrame);
  const isFrameScrubbing = useEditorSelector((s) => s.isFrameScrubbing);
  const [deferredFrame, setDeferredFrame] = useState(currentFrame);
  const effectiveFrame = staticFrame !== undefined ? staticFrame : deferredFrame;
  const generationRef = useRef(0);

  useEffect(() => {
    if (staticFrame !== undefined) {
      setDeferredFrame(staticFrame);
      return;
    }

    if (!isFrameScrubbing) {
      setDeferredFrame(currentFrame);
    }
  }, [currentFrame, isFrameScrubbing, staticFrame]);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    let isCancelled = false;

    // Debounce thumbnail generation to avoid rapid re-renders
    // when properties are being adjusted continuously
    const timeoutId = setTimeout(async () => {
      if (isCancelled) return;
      try {
        const url = await renderStackToDataURL(stack, sceneNode, effectiveFrame);
        if (!isCancelled && generationRef.current === generation) {
          setDataUrl(url);
        }
      } catch (error) {
        console.error('Thumbnail generation failed for node:', stack[0].name, error);
        if (!isCancelled && generationRef.current === generation) {
          setDataUrl((prev) => prev ?? 'error');
        }
      }
    }, THUMBNAIL_DEBOUNCE_MS);

    return () => {
      isCancelled = true;
      clearTimeout(timeoutId);
    };
  }, [stack, sceneNode, effectiveFrame]);

  if (dataUrl === 'error') {
    return (
      <div
        className="w-full h-full flex items-center justify-center bg-red-900/50"
        title="Error generating thumbnail"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4 text-red-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </div>
    );
  }

  if (!dataUrl) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <img
      src={dataUrl}
      alt={`${stack[0].name} thumbnail`}
      className="w-full h-full object-contain"
    />
  );
});

LiveThumbnail.displayName = 'LiveThumbnail';

export default LiveThumbnail;
