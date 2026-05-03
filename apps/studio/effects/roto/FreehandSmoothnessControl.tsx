import React, { forwardRef } from 'react';
import { Slider } from '@/components';
import * as Icons from '@blackboard/icons';

interface FreehandSmoothnessControlProps {
  epsilon: number;
  onChange: (value: number) => void;
  onCommit: () => void;
  position: { top: number; left: number };
  isUpdate?: boolean;
}

const FreehandSmoothnessControl = forwardRef<HTMLDivElement, FreehandSmoothnessControlProps>(
  ({ epsilon, onChange, onCommit, position, isUpdate }, ref) => {
    return (
      <div
        ref={ref}
        className="absolute z-30 glass-component bg-gray-900/60 backdrop-blur-xl border border-white/10 rounded-lg shadow-lg p-3 w-56 pointer-events-auto animate-[fadeIn_150ms_ease-out]"
        style={{ top: position.top, left: position.left }}
        onMouseDown={(e) => e.stopPropagation()} // Prevent viewport pan
      >
        <div className="flex items-center gap-2">
          <div className="flex-1">
            {isUpdate ? (
              <div className="px-2 py-1">
                <p className="text-[10px] font-bold text-primary-400 uppercase tracking-tight">
                  Point Count Locked
                </p>
                <p className="text-[9px] text-gray-400 leading-tight">
                  Updating vertices to match shape history
                </p>
              </div>
            ) : (
              <Slider
                label="Smoothness"
                value={epsilon}
                min={0.1}
                max={15}
                step={0.1}
                onChange={onChange}
                onReset={() => onChange(2)}
              />
            )}
          </div>
          <button
            onClick={onCommit}
            className="p-2 bg-primary-600 hover:bg-primary-700 rounded-md text-white transition-colors"
            title="Confirm Shape"
          >
            <Icons.Check className="h-5 w-5" />
          </button>
        </div>
      </div>
    );
  },
);

export default FreehandSmoothnessControl;
