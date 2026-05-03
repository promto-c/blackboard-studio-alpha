import React from 'react';
import { formatHotkeyCombo } from '@/hotkeys';

interface HotkeyBadgeProps {
  combo: string;
  className?: string;
}

const HotkeyBadge: React.FC<HotkeyBadgeProps> = ({ combo, className = '' }) => {
  const keys = formatHotkeyCombo(combo);
  if (!keys.length) return null;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-lg border border-white/15 bg-gray-950/70 px-1.5 py-0.5 text-[10px] text-gray-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_2px_6px_rgba(0,0,0,0.4)] ${className}`}
    >
      {keys.map((key, index) => (
        <React.Fragment key={`${key}-${index}`}>
          <kbd className="min-w-[1.2rem] rounded-md border border-white/20 bg-gradient-to-b from-white/15 to-white/0 px-1 py-[1px] text-center font-mono font-semibold leading-none text-gray-100">
            {key}
          </kbd>
          {index < keys.length - 1 && <span className="text-gray-400">+</span>}
        </React.Fragment>
      ))}
    </span>
  );
};

export default HotkeyBadge;
