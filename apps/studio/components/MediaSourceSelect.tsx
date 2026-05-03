import React from 'react';
import { type MediaSourceOption, isUpstreamMediaSourceId } from '@/utils/mediaSourceSelection';

interface MediaSourceSelectProps {
  value: string;
  options: MediaSourceOption[];
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  upstreamHint?: React.ReactNode;
}

const DEFAULT_UPSTREAM_HINT = 'Use the rendered result of every node before this node.';

const MediaSourceSelect: React.FC<MediaSourceSelectProps> = ({
  value,
  options,
  onChange,
  label = 'Source',
  placeholder = 'Select Source...',
  upstreamHint = DEFAULT_UPSTREAM_HINT,
}) => {
  return (
    <div className="space-y-1">
      <label className="text-[10px] text-gray-400 font-medium">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-gray-800 border border-gray-700 text-xs text-white rounded px-2 py-1 focus:ring-1 focus:ring-primary-500 outline-none"
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {isUpstreamMediaSourceId(value) && upstreamHint ? (
        <p className="text-[10px] text-gray-500">{upstreamHint}</p>
      ) : null}
    </div>
  );
};

export default MediaSourceSelect;
