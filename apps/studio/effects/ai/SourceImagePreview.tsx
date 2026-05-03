import React from 'react';
import useAssetPreviewUrl from '@/hooks/useAssetPreviewUrl';
import { ImageNode } from '@blackboard/types';

interface SourceImagePreviewProps {
  node: ImageNode;
  isActive: boolean;
  onClick: () => void;
}

const SourceImagePreview: React.FC<SourceImagePreviewProps> = ({ node, isActive, onClick }) => {
  const imageUrl = useAssetPreviewUrl(node.src, 256);

  return (
    <button
      onClick={onClick}
      className={`relative rounded aspect-square w-20 h-20 flex-shrink-0 overflow-hidden focus:outline-none ring-2 ring-offset-2 ring-offset-gray-800 transition-all ${
        isActive ? 'ring-primary-500' : 'ring-transparent'
      } bg-gray-900`}
      title={node.name}
    >
      {imageUrl ? (
        <img src={imageUrl} alt={node.name} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full bg-gray-700" />
      )}
      <div className="absolute bottom-0 left-0 right-0 p-1 bg-black/50 text-white text-xs truncate">
        {node.name}
      </div>
    </button>
  );
};

export default SourceImagePreview;
