import React from 'react';
import type { GeneratedOutput } from '@blackboard/types';
import * as Icons from '@blackboard/icons';
import { useAssetObjectUrl } from '../hooks/useAssetObjectUrl';

export const ComfyOutputThumbnail: React.FC<{
  output: GeneratedOutput;
  active: boolean;
  onClick: () => void;
}> = ({ output, active, onClick }) => {
  const imageUrl = useAssetObjectUrl(output.src);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative h-14 w-14 shrink-0 overflow-hidden rounded-md border bg-gray-800 transition ${
        active
          ? 'border-primary-300 ring-1 ring-primary-300/50'
          : 'border-white/10 hover:border-white/30'
      }`}
      title={output.prompt || output.label || 'Comfy output'}
      aria-pressed={active}
    >
      {imageUrl ? (
        <img src={imageUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-gray-500">
          <Icons.Photo className="h-5 w-5" />
        </div>
      )}
      {active ? (
        <span className="absolute right-1 top-1 rounded-full bg-primary-300 p-0.5 text-gray-950">
          <Icons.Check className="h-2.5 w-2.5" />
        </span>
      ) : null}
    </button>
  );
};
