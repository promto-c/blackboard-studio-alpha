import React, { useState, useEffect } from 'react';
import { getAsset } from '@/state/assetStorage';
import { AiVariant } from '@blackboard/types';

const Spinner: React.FC<{ className?: string }> = ({ className = 'h-6 w-6' }) => (
  <svg
    className={`animate-spin ${className} text-white`}
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

interface AiVariantPreviewProps {
  variant: AiVariant;
  isActive: boolean;
  onClick: () => void;
}

const AiVariantPreview: React.FC<AiVariantPreviewProps> = ({ variant, isActive, onClick }) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;

    const loadImage = async () => {
      if (variant.status) {
        setImageUrl(null);
        return;
      }
      try {
        const blob = await getAsset(variant.src);
        if (blob) {
          objectUrl = URL.createObjectURL(blob);
          setImageUrl(objectUrl);
        }
      } catch (error) {
        console.error(`Failed to load asset ${variant.src}`, error);
      }
    };

    loadImage();

    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [variant.src, variant.status]);

  const renderOverlay = () => {
    if (!variant.status) return null;

    return (
      <div className="absolute inset-0 bg-gray-800/80 backdrop-blur-sm flex flex-col items-center justify-center text-white font-semibold">
        {variant.status === 'queued' && (
          <>
            <span className="text-2xl font-mono">#{variant.queuePosition}</span>
            <span className="text-xs mt-1">Queued</span>
          </>
        )}
        {variant.status === 'generating' && (
          <>
            <Spinner />
            <span className="text-xs mt-2">Generating...</span>
          </>
        )}
        {variant.status === 'error' && (
          <>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6 text-red-400"
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
            <span className="text-xs mt-2">Error</span>
          </>
        )}
      </div>
    );
  };

  return (
    <button
      onClick={onClick}
      disabled={!!variant.status}
      className={`relative rounded aspect-square w-full h-auto overflow-hidden focus:outline-none ring-2 ring-offset-2 ring-offset-gray-800 transition-all ${
        isActive ? 'ring-primary-500' : 'ring-transparent'
      } ${variant.status ? 'cursor-not-allowed' : 'cursor-pointer'}`}
    >
      {imageUrl ? (
        <img src={imageUrl} alt="Generated variant" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full bg-gray-700" />
      )}
      {renderOverlay()}
    </button>
  );
};

export default AiVariantPreview;
