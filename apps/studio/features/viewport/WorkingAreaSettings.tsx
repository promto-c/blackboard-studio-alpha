import { NumberInput, ToggleSwitch } from '@blackboard/ui';
import type { NormalizedRect, SceneNode, ViewportWorkingArea } from '@blackboard/types';
import { getWorkingAreaCoverage, resolveWorkingAreaPixelRect } from './workingArea';

export function WorkingAreaSettings({
  scene,
  workingArea,
  onChange,
  onEnabledChange,
  onReset,
}: {
  scene: Pick<SceneNode, 'width' | 'height'>;
  workingArea: ViewportWorkingArea;
  onChange: (rect: NormalizedRect) => void;
  onEnabledChange: (enabled: boolean) => void;
  onReset: () => void;
}) {
  const pixels = resolveWorkingAreaPixelRect({ enabled: true, rect: workingArea.rect }, scene)!;
  const coverage = getWorkingAreaCoverage(pixels, scene);
  const updatePixels = (changes: Partial<typeof pixels>) => {
    const next = { ...pixels, ...changes };
    const x = Math.max(0, Math.min(scene.width - 1, next.x));
    const y = Math.max(0, Math.min(scene.height - 1, next.y));
    const width = Math.max(1, Math.min(scene.width - x, next.width));
    const height = Math.max(1, Math.min(scene.height - y, next.height));
    onChange({
      x: x / scene.width,
      y: y / scene.height,
      width: width / scene.width,
      height: height / scene.height,
    });
  };

  const centeredPreset = (scale: number) =>
    onChange({ x: (1 - scale) / 2, y: (1 - scale) / 2, width: scale, height: scale });

  return (
    <div className="p-1">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-white">Working Area</h3>
          <p className="mt-1 text-[10px] text-gray-500">Interactive processing region</p>
        </div>
        <ToggleSwitch
          checked={workingArea.enabled}
          onCheckedChange={onEnabledChange}
          size="sm"
          ariaLabel="Enable working area processing"
          trackClassName={
            workingArea.enabled
              ? 'border border-primary-300/30 bg-primary-500/50'
              : 'border border-white/10 bg-white/10'
          }
          thumbClassName="shadow-sm"
        />
      </div>
      <p className="mb-3 text-[11px] leading-4 text-gray-400">
        Limits interactive reads and GPU processing. The graph and final export remain full frame.
      </p>
      <div className="-mx-1 -mb-1 overflow-hidden rounded-lg border border-white/[0.08] bg-black/[0.12] divide-y divide-white/[0.08]">
        <section className="p-3">
          <div className="mb-2 grid grid-cols-2 gap-2">
            {(
              [
                ['X', 'x', scene.width - 1],
                ['Y', 'y', scene.height - 1],
                ['Width', 'width', scene.width],
                ['Height', 'height', scene.height],
              ] as const
            ).map(([label, key, max]) => (
              <label key={key} className="space-y-1 text-[10px] font-medium text-gray-400">
                <span>{label}</span>
                <NumberInput
                  value={pixels[key]}
                  min={key === 'width' || key === 'height' ? 1 : 0}
                  max={max}
                  step={1}
                  suffix="px"
                  onValueChange={(value) => updatePixels({ [key]: Math.round(value) })}
                />
              </label>
            ))}
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => centeredPreset(0.25)}
              className="rounded-md bg-white/[0.06] px-2 py-1 text-[10px] text-gray-300 hover:bg-white/10 hover:text-white"
            >
              Center 25%
            </button>
            <button
              type="button"
              onClick={() => centeredPreset(0.5)}
              className="rounded-md bg-white/[0.06] px-2 py-1 text-[10px] text-gray-300 hover:bg-white/10 hover:text-white"
            >
              Center 50%
            </button>
            <button
              type="button"
              onClick={onReset}
              className="rounded-md bg-white/[0.06] px-2 py-1 text-[10px] text-gray-300 hover:bg-white/10 hover:text-white"
            >
              Full frame
            </button>
          </div>
        </section>
        <section className="p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
              Interactive pixel budget
            </span>
            <span className="font-mono text-xs text-teal-200">{Math.round(coverage * 100)}%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-teal-400/70 transition-[width] duration-150"
              style={{ width: `${Math.max(1, coverage * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-[10px] leading-4 text-gray-500">
            GPU passes shade only this area. Compatible scene-sized stills also retain only these
            pixels; unsupported readers fall back to full decode.
          </p>
        </section>
      </div>
    </div>
  );
}
