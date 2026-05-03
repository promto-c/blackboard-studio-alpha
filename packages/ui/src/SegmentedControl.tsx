import React from 'react';

interface SegmentOption {
  value: string | number;
  label: string;
}

interface SegmentedControlProps {
  options: SegmentOption[];
  value: string | number;
  onChange: (value: string | number) => void;
}

const SegmentedControl: React.FC<SegmentedControlProps> = ({ options, value, onChange }) => {
  return (
    <div className="flex items-center gap-1 p-1 bg-gray-900 rounded-lg text-xs w-full">
      {options.map((opt) => (
        <button
          key={String(opt.value)}
          onClick={() => onChange(opt.value)}
          className={`flex-1 text-center px-2 py-1.5 rounded-md transition-colors duration-200 ease-in-out font-medium
                        ${
                          value === opt.value
                            ? 'bg-gray-700 text-white shadow'
                            : 'text-gray-400 hover:text-white'
                        }
                    `}
          aria-pressed={value === opt.value}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
};

export default SegmentedControl;
