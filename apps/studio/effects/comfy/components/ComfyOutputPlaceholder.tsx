import React from 'react';
import * as Icons from '@blackboard/icons';

export const ComfyOutputPlaceholder: React.FC<{
  label: string;
  detail?: string;
  active?: boolean;
}> = ({ label, detail, active = false }) => (
  <div
    className={`flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-md border border-dashed px-1.5 text-center ${
      active
        ? 'border-primary-300/45 bg-primary-300/[0.08] text-primary-100'
        : 'border-white/10 bg-gray-900/60 text-gray-500'
    }`}
    title={detail ?? label}
  >
    <Icons.CubeTransparent className={`h-4 w-4 ${active ? 'animate-pulse' : ''}`} />
    <span className="mt-0.5 max-w-full truncate text-[10px] font-medium">{label}</span>
  </div>
);
