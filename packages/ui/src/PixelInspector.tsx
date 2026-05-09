import React from 'react';

interface PixelInfo {
  x: number;
  y: number;
  color: [number, number, number, number]; // RGBA values, normalized 0.0-1.0
}

interface PixelInspectorProps {
  info: PixelInfo | null;
  bitDepth: 8 | 16 | 32;
}

const formatValue = (value: number, bitDepth: 8 | 16 | 32): string => {
  if (bitDepth === 8) {
    return Math.round(value * 255)
      .toString()
      .padStart(3, ' ');
  }
  return value.toFixed(4);
};

const PixelInspector = React.memo(function PixelInspector({ info, bitDepth }: PixelInspectorProps) {
  if (!info) {
    return null;
  }

  const [r, g, b, a] = info.color;

  return (
    <div className="absolute bottom-4 left-4 z-30 glass-component bg-gray-900/50 backdrop-blur-xl border border-white/10 rounded-lg shadow-lg p-2 font-mono text-xs text-gray-200 pointer-events-none animate-[fadeIn_150ms_ease-out]">
      <div className="grid grid-cols-[auto_1fr] gap-x-2">
        <span className="text-gray-400">X:</span>
        <span>{info.x}</span>
        <span className="text-gray-400">Y:</span>
        <span>{info.y}</span>
      </div>
      <div className="border-t border-gray-700/50 my-1"></div>
      <div className="grid grid-cols-[auto_1fr] gap-x-2">
        <span className="text-red-400">R:</span>
        <span>{formatValue(r, bitDepth)}</span>
        <span className="text-green-400">G:</span>
        <span>{formatValue(g, bitDepth)}</span>
        <span className="text-blue-400">B:</span>
        <span>{formatValue(b, bitDepth)}</span>
        <span className="text-gray-400">A:</span>
        <span>{formatValue(a, bitDepth)}</span>
      </div>
    </div>
  );
});

export default PixelInspector;
