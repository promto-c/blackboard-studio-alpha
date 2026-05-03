import React from 'react';

interface KeyframeButtonProps {
  isKeyframed: boolean;
  onClick: () => void;
  title?: string;
}

const KeyframeButton: React.FC<KeyframeButtonProps> = ({ isKeyframed, onClick, title }) => (
  <button
    onClick={onClick}
    title={title}
    className={`w-5 h-5 flex items-center justify-center rounded-sm transition-colors duration-150 group ${isKeyframed ? 'text-primary-400' : 'text-gray-500 hover:text-primary-400'}`}
    aria-label={isKeyframed ? 'Remove keyframe' : 'Add keyframe'}
  >
    <svg viewBox="0 0 16 16" className="w-3 h-3">
      <path
        d="M8 0L13 8L8 16L3 8L8 0Z"
        className={`transition-all duration-150 ${isKeyframed ? 'fill-current' : 'fill-transparent stroke-current group-hover:fill-primary-400/30'}`}
        strokeWidth="2"
      />
    </svg>
  </button>
);

export default KeyframeButton;
