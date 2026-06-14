import { useState, useEffect, memo } from 'react';
import { renderStackToDataURL } from '@/utils/thumbnailRenderer';
import { AnyNode, SceneNode } from '@blackboard/types';
import { useEditorSelector } from '@/state/editorContext';
import { useDebouncedAsync } from '@/hooks/useDebouncedAsync';
import { Spinner } from '@blackboard/ui';

interface Props {
  stack: AnyNode[];
  sceneNode: SceneNode;
  staticFrame?: number;
}

const THUMBNAIL_DEBOUNCE_MS = 200;

export const LiveThumbnail = memo(function LiveThumbnail({ stack, sceneNode, staticFrame }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const currentFrame = useEditorSelector((s) => s.currentFrame);
  const isFrameScrubbing = useEditorSelector((s) => s.isFrameScrubbing);
  const [deferredFrame, setDeferredFrame] = useState(currentFrame);
  const effectiveFrame = staticFrame !== undefined ? staticFrame : deferredFrame;

  useEffect(() => {
    if (staticFrame !== undefined) {
      setDeferredFrame(staticFrame);
      return;
    }

    if (!isFrameScrubbing) {
      setDeferredFrame(currentFrame);
    }
  }, [currentFrame, isFrameScrubbing, staticFrame]);

  const latestDataUrl = useDebouncedAsync(
    () => renderStackToDataURL(stack, sceneNode, effectiveFrame),
    [stack, sceneNode, effectiveFrame],
    {
      delay: THUMBNAIL_DEBOUNCE_MS,
      onError: (error) => {
        console.error('Thumbnail generation failed for node:', stack[0]?.name, error);
        setDataUrl((prev) => prev ?? 'error');
      },
    },
  );

  useEffect(() => {
    if (latestDataUrl !== undefined) {
      setDataUrl(latestDataUrl);
    }
  }, [latestDataUrl]);

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
        <Spinner className="h-5 w-5 text-gray-400" />
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
