import React from 'react';
import useAssetPreviewUrl from '@/hooks/useAssetPreviewUrl';

const ImageIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={1.5}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
    />
  </svg>
);

const ImageThumbnail: React.FC<{ assetId: string; className?: string }> = ({
  assetId,
  className,
}) => {
  const imageUrl = useAssetPreviewUrl(assetId, 320);

  if (!imageUrl) {
    return (
      <div className={`flex items-center justify-center bg-gray-700/50 text-gray-500 ${className}`}>
        <ImageIcon className="w-6 h-6" />
      </div>
    );
  }

  return <img src={imageUrl} alt="Node thumbnail" className={`object-contain ${className}`} />;
};

export default ImageThumbnail;
