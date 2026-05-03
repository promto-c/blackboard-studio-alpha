import React, { useMemo } from 'react';

interface ColorPickerProps {
  label: string;
  value: [number, number, number]; // RGB, 0-1 range
  onChange: (value: [number, number, number]) => void;
  alpha?: number;
  onAlphaChange?: (value: number) => void;
  alphaLabel?: string;
}

const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));

const ColorPicker: React.FC<ColorPickerProps> = ({
  label,
  value,
  onChange,
  alpha,
  onAlphaChange,
  alphaLabel = 'A',
}) => {
  const hexValue = useMemo(() => {
    const [r, g, b] = value.map((c) => Math.round(c * 255));
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase()}`;
  }, [value]);
  const resolvedAlpha = clampUnit(alpha ?? 1);
  const alphaPercent = Math.round(resolvedAlpha * 100);
  const showAlphaControl = typeof alpha === 'number' && typeof onAlphaChange === 'function';

  const handleHexChange = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    onChange([r, g, b]);
  };

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-gray-400">{label}</label>
      <div className="flex items-center gap-2">
        <div
          className="relative h-8 w-8 overflow-hidden rounded-md border-2 border-gray-600"
          style={{
            backgroundImage:
              'linear-gradient(45deg, rgba(255,255,255,0.08) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.08) 75%), linear-gradient(45deg, rgba(255,255,255,0.08) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.08) 75%)',
            backgroundPosition: '0 0, 4px 4px',
            backgroundSize: '8px 8px',
          }}
        >
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundColor: `rgba(${Math.round(value[0] * 255)}, ${Math.round(value[1] * 255)}, ${Math.round(value[2] * 255)}, ${resolvedAlpha})`,
            }}
          />
          <input
            type="color"
            value={hexValue}
            onChange={(e) => handleHexChange(e.target.value)}
            className="absolute -top-1 -left-1 w-12 h-12 cursor-pointer"
          />
        </div>
        <span className="min-w-0 flex-1 truncate text-xs font-mono text-gray-300">{hexValue}</span>
        {showAlphaControl ? (
          <label className="flex items-center gap-1 rounded-md border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-gray-300">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">
              {alphaLabel}
            </span>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={alphaPercent}
              onChange={(event) => onAlphaChange(clampUnit(Number(event.target.value) / 100))}
              className="w-12 border-0 bg-transparent p-0 text-right font-mono text-[11px] text-gray-100 outline-none"
            />
            <span className="text-[10px] text-gray-500">%</span>
          </label>
        ) : null}
      </div>
    </div>
  );
};

export default ColorPicker;
