import React, { useEffect, useMemo, useState } from 'react';
import * as Icons from '@blackboard/icons';
import { Badge, NumberInput, TextInput } from '@blackboard/ui';
import { ExecuteButton } from '@/components';
import { SlidingSegmentedControl } from '@/components/SlidingSegmentedControl';

interface NewProjectViewProps {
  onBack: () => void;
  onCreate: (name: string, width: number, height: number) => void;
}

type PresetCategory = 'all' | 'video' | 'social' | 'photo' | 'display' | 'saved';

interface ProjectPreset {
  name: string;
  width: number;
  height: number;
  category?: Exclude<PresetCategory, 'all' | 'saved'>;
}

interface PresetCategoryOption {
  id: PresetCategory;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}

const DEFAULT_PRESETS: ProjectPreset[] = [
  { name: 'Full HD', width: 1920, height: 1080, category: 'video' },
  { name: '4K UHD', width: 3840, height: 2160, category: 'video' },
  { name: 'DCI 4K', width: 4096, height: 2160, category: 'video' },
  { name: 'Vertical video', width: 1080, height: 1920, category: 'social' },
  { name: 'Square post', width: 1080, height: 1080, category: 'social' },
  { name: 'Portrait post', width: 1080, height: 1350, category: 'social' },
  { name: 'Photo 3:2', width: 3000, height: 2000, category: 'photo' },
  { name: 'A4 portrait', width: 2480, height: 3508, category: 'photo' },
  { name: 'Laptop 16:10', width: 2560, height: 1600, category: 'display' },
  { name: 'Ultrawide', width: 3440, height: 1440, category: 'display' },
  { name: 'Super ultrawide', width: 5120, height: 1440, category: 'display' },
];

const PRESET_CATEGORIES: PresetCategoryOption[] = [
  { id: 'all', label: 'All', Icon: Icons.Sparkles },
  { id: 'video', label: 'Video', Icon: Icons.Video },
  { id: 'social', label: 'Social', Icon: Icons.Portrait },
  { id: 'photo', label: 'Photo & print', Icon: Icons.Photo },
  { id: 'display', label: 'Display', Icon: Icons.ComputerDesktop },
];

const CUSTOM_PRESETS_KEY = 'blackboard-studio-custom-presets';

const greatestCommonDivisor = (first: number, second: number): number => {
  let a = first;
  let b = second;
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a;
};

const getAspectRatioLabel = (width: number | null, height: number | null): string => {
  if (!width || !height) return 'Invalid size';
  const divisor = greatestCommonDivisor(width, height);
  const ratioWidth = width / divisor;
  const ratioHeight = height / divisor;

  if (ratioWidth > 100 || ratioHeight > 100) {
    return `${(width / height).toFixed(2)}:1`;
  }
  return `${ratioWidth}:${ratioHeight}`;
};

const getOrientation = (
  width: number | null,
  height: number | null,
): 'Landscape' | 'Portrait' | 'Square' | 'Custom' => {
  if (!width || !height) return 'Custom';
  if (width === height) return 'Square';
  return width > height ? 'Landscape' : 'Portrait';
};

const getPresetKey = (preset: ProjectPreset): string =>
  `${preset.name}-${preset.width}-${preset.height}`;

const readCustomPresets = (): ProjectPreset[] => {
  try {
    const storedPresets = localStorage.getItem(CUSTOM_PRESETS_KEY);
    if (!storedPresets) return [];

    const parsed: unknown = JSON.parse(storedPresets);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (preset): preset is ProjectPreset =>
        typeof preset === 'object' &&
        preset !== null &&
        typeof preset.name === 'string' &&
        typeof preset.width === 'number' &&
        Number.isInteger(preset.width) &&
        preset.width > 0 &&
        typeof preset.height === 'number' &&
        Number.isInteger(preset.height) &&
        preset.height > 0,
    );
  } catch (error) {
    console.error('Failed to load custom presets:', error);
    return [];
  }
};

function CanvasThumbnail({
  width,
  height,
  size = 'card',
}: {
  width: number;
  height: number;
  size?: 'card' | 'preview';
}) {
  const maxWidth = size === 'preview' ? 230 : 76;
  const maxHeight = size === 'preview' ? 132 : 48;
  const scale = Math.min(maxWidth / width, maxHeight / height);

  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-sm border ${
        size === 'preview'
          ? 'border-primary-200/35 bg-primary-300/15 shadow-[0_0_36px_rgba(45,212,191,0.12)]'
          : 'border-white/15 bg-white/10'
      }`}
      style={{
        width: Math.max(width * scale, size === 'preview' ? 12 : 6),
        height: Math.max(height * scale, size === 'preview' ? 12 : 6),
      }}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-white/25" />
    </div>
  );
}

function PresetCard({
  preset,
  isSelected,
  onSelect,
  onDelete,
}: {
  preset: ProjectPreset;
  isSelected: boolean;
  onSelect: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="group relative min-w-0">
      <button
        type="button"
        aria-pressed={isSelected}
        onClick={onSelect}
        className={`flex h-full min-h-32 w-full flex-col rounded-xl border p-3 text-left transition duration-150 focus-visible:ring-2 focus-visible:ring-primary-300/50 ${
          isSelected
            ? 'border-primary-300/55 bg-primary-400/[0.09] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
            : 'border-white/[0.08] bg-white/[0.025] hover:border-white/15 hover:bg-white/[0.055]'
        }`}
      >
        <div className="flex h-14 w-full items-center justify-center">
          <CanvasThumbnail width={preset.width} height={preset.height} />
        </div>
        <div className="mt-2 min-w-0">
          <span
            className={`block truncate text-xs font-semibold ${
              isSelected ? 'text-primary-100' : 'text-gray-200'
            }`}
          >
            {preset.name}
          </span>
          <p className="mt-1 font-mono text-[10px] text-gray-500">
            {preset.width.toLocaleString()} × {preset.height.toLocaleString()}
          </p>
        </div>
      </button>

      {isSelected ? (
        <Icons.Check className="pointer-events-none absolute right-2.5 top-2.5 h-4 w-4 text-primary-300 drop-shadow-[0_1px_3px_rgba(45,212,191,0.35)]" />
      ) : null}

      {onDelete ? (
        <button
          type="button"
          onClick={onDelete}
          className={`group/remove absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-md transition hover:bg-rose-400/10 hover:text-rose-300 focus-visible:bg-rose-400/10 focus-visible:text-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300/40 ${
            isSelected ? 'text-primary-300/70' : 'text-gray-600'
          }`}
          title={`Remove ${preset.name} from saved presets`}
          aria-label={`Remove ${preset.name} from saved presets`}
        >
          <Icons.Star className="h-3.5 w-3.5 transition-opacity group-hover/remove:opacity-0 group-focus-visible/remove:opacity-0" />
          <Icons.Trash className="absolute h-3.5 w-3.5 opacity-0 transition-opacity group-hover/remove:opacity-100 group-focus-visible/remove:opacity-100" />
        </button>
      ) : null}
    </div>
  );
}

function NewProjectView({ onBack, onCreate }: NewProjectViewProps) {
  const [projectName, setProjectName] = useState('Untitled Project');
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [customPresets, setCustomPresets] = useState<ProjectPreset[]>([]);
  const [activeCategory, setActiveCategory] = useState<PresetCategory>('all');

  useEffect(() => {
    setCustomPresets(readCustomPresets());
  }, []);

  const numericWidth = width;
  const numericHeight = height;

  const selectedPreset = useMemo(() => {
    if (!numericWidth || !numericHeight) return null;
    return [...customPresets, ...DEFAULT_PRESETS].find(
      (preset) => preset.width === numericWidth && preset.height === numericHeight,
    );
  }, [customPresets, numericHeight, numericWidth]);

  const visiblePresets = useMemo(() => {
    if (activeCategory === 'saved') return customPresets;
    const defaults =
      activeCategory === 'all'
        ? DEFAULT_PRESETS
        : DEFAULT_PRESETS.filter((preset) => preset.category === activeCategory);
    return activeCategory === 'all' ? [...customPresets, ...defaults] : defaults;
  }, [activeCategory, customPresets]);

  const categoryOptions = useMemo(
    () =>
      customPresets.length > 0
        ? [...PRESET_CATEGORIES, { id: 'saved' as const, label: 'Saved', Icon: Icons.Star }]
        : PRESET_CATEGORIES,
    [customPresets.length],
  );

  const isValid = projectName.trim().length > 0 && !!numericWidth && !!numericHeight;
  const canSavePreset =
    !!numericWidth &&
    !!numericHeight &&
    ![...customPresets, ...DEFAULT_PRESETS].some(
      (preset) => preset.width === numericWidth && preset.height === numericHeight,
    );

  const saveCustomPresets = (presets: ProjectPreset[]) => {
    setCustomPresets(presets);
    localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(presets));
  };

  const handlePresetClick = (preset: ProjectPreset) => {
    setWidth(preset.width);
    setHeight(preset.height);
  };

  const handleSavePreset = () => {
    if (!numericWidth || !numericHeight || !canSavePreset) return;
    const nextPresets = [
      ...customPresets,
      {
        name: `Custom ${numericWidth.toLocaleString()} × ${numericHeight.toLocaleString()}`,
        width: numericWidth,
        height: numericHeight,
      },
    ];
    saveCustomPresets(nextPresets);
    setActiveCategory('saved');
  };

  const handleDeletePreset = (presetToDelete: ProjectPreset) => {
    const nextPresets = customPresets.filter(
      (preset) => getPresetKey(preset) !== getPresetKey(presetToDelete),
    );
    saveCustomPresets(nextPresets);
    if (nextPresets.length === 0 && activeCategory === 'saved') {
      setActiveCategory('all');
    }
  };

  const handleSwapDimensions = () => {
    setWidth(height);
    setHeight(width);
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isValid || !numericWidth || !numericHeight) return;
    onCreate(projectName.trim(), numericWidth, numericHeight);
  };

  const orientation = getOrientation(numericWidth, numericHeight);
  const aspectRatio = getAspectRatioLabel(numericWidth, numericHeight);
  const displayWidth = numericWidth?.toLocaleString() ?? '—';
  const displayHeight = numericHeight?.toLocaleString() ?? '—';

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-auto w-full max-w-6xl pb-6"
      data-text-selection-scope
    >
      <header className="mb-5 flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-gray-400 transition hover:bg-gray-800 hover:text-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300/40"
        >
          <Icons.ChevronLeft className="h-4 w-4" />
          Back
        </button>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-white">Set up your canvas</h1>
          <p className="max-w-2xl text-sm text-gray-400">
            Choose a starting format or enter a custom size. Everything can still be adjusted in
            Studio.
          </p>
        </div>
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-w-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-gray-800/35 shadow-[0_22px_60px_rgba(0,0,0,0.18)]">
          <div className="border-b border-white/[0.07] px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-100">Choose a format</h2>
                <p className="mt-1 text-xs text-gray-500">
                  Production-ready sizes for common creative work
                </p>
              </div>
              <Badge
                variant="neutral"
                size="lg"
                className="border-white/[0.08] bg-gray-950/35 text-gray-500"
              >
                {visiblePresets.length} {visiblePresets.length === 1 ? 'preset' : 'presets'}
              </Badge>
            </div>

            <SlidingSegmentedControl<PresetCategory>
              options={categoryOptions.map(({ id, label, Icon }) => ({
                value: id,
                label,
                Icon,
                title: `${label} presets`,
              }))}
              value={activeCategory}
              onChange={setActiveCategory}
              ariaLabel="Preset categories"
              activeWidth={116}
              inactiveWidth={34}
              padding={8}
              selectionRadius={8}
              height={42}
              className="mt-4 !rounded-xl !border-white/[0.06] !bg-gray-950/45"
              itemClassName="!rounded-lg !px-2 !text-xs !font-medium !tracking-normal"
              iconClassName="h-3.5 w-3.5"
              activeIconClassName="text-primary-300"
              inactiveIconClassName="text-gray-600"
              labelMaxWidthClassName="max-w-20"
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5 p-4 sm:grid-cols-3 sm:p-5 xl:grid-cols-4">
            {visiblePresets.map((preset) => {
              const isCustom = customPresets.some(
                (customPreset) => getPresetKey(customPreset) === getPresetKey(preset),
              );
              return (
                <PresetCard
                  key={getPresetKey(preset)}
                  preset={preset}
                  isSelected={numericWidth === preset.width && numericHeight === preset.height}
                  onSelect={() => handlePresetClick(preset)}
                  onDelete={isCustom ? () => handleDeletePreset(preset) : undefined}
                />
              );
            })}
          </div>
        </section>

        <aside className="overflow-hidden rounded-2xl border border-white/[0.09] bg-gray-800/55 shadow-[0_22px_60px_rgba(0,0,0,0.22)] lg:sticky lg:top-6">
          <div
            className="relative flex h-48 items-center justify-center overflow-hidden border-b border-white/[0.07] bg-gray-950/55"
            style={{
              backgroundImage:
                'linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)',
              backgroundSize: '16px 16px',
            }}
          >
            <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-primary-500/[0.05] to-transparent" />
            {numericWidth && numericHeight ? (
              <CanvasThumbnail width={numericWidth} height={numericHeight} size="preview" />
            ) : (
              <div className="flex flex-col items-center gap-2 text-gray-600">
                <Icons.ExclamationCircle className="h-7 w-7" />
                <span className="text-xs">Enter a valid canvas size</span>
              </div>
            )}
            <div className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-gray-950/75 px-2 py-1 font-mono text-[10px] text-gray-400 backdrop-blur">
              <span>{displayWidth}</span>
              <span className="text-gray-700">×</span>
              <span>{displayHeight}</span>
              <span className="ml-1 text-primary-300/80">{aspectRatio}</span>
            </div>
          </div>

          <div className="space-y-5 p-5">
            <div>
              <label htmlFor="projectName" className="mb-2 block text-xs font-medium text-gray-300">
                Project name
              </label>
              <TextInput
                autoFocus
                id="projectName"
                value={projectName}
                onValueChange={setProjectName}
                placeholder="Name your project"
                aria-invalid={projectName.trim().length === 0}
              />
              {projectName.trim().length === 0 ? (
                <p className="mt-1.5 text-[11px] text-rose-300">Enter a project name.</p>
              ) : null}
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-xs font-medium text-gray-300">Canvas size</label>
                <button
                  type="button"
                  onClick={handleSwapDimensions}
                  className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[10px] font-medium text-gray-500 transition hover:bg-white/[0.05] hover:text-gray-200"
                  title="Swap width and height"
                >
                  <Icons.ArrowsRightLeft className="h-3 w-3" />
                  Swap
                </button>
              </div>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <NumberInput
                  id="projectWidth"
                  value={width}
                  onValueChange={setWidth}
                  normalizeValue={Math.round}
                  suffix="px"
                  placeholder="1920"
                  min="1"
                  step="1"
                  aria-label="Canvas width"
                  aria-invalid={!numericWidth}
                />
                <span className="text-xs text-gray-600">×</span>
                <NumberInput
                  id="projectHeight"
                  value={height}
                  onValueChange={setHeight}
                  normalizeValue={Math.round}
                  suffix="px"
                  placeholder="1080"
                  min="1"
                  step="1"
                  aria-label="Canvas height"
                  aria-invalid={!numericHeight}
                />
              </div>
              {!numericWidth || !numericHeight ? (
                <p className="mt-1.5 text-[11px] text-rose-300">
                  Width and height must be whole numbers greater than zero.
                </p>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-gray-950/30 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-gray-300">
                  {selectedPreset?.name ?? 'Custom format'}
                </p>
                <p className="mt-0.5 text-[10px] text-gray-600">
                  {orientation} · {aspectRatio}
                </p>
              </div>
              <button
                type="button"
                onClick={handleSavePreset}
                disabled={!canSavePreset}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.035] px-2.5 py-1.5 text-[10px] font-medium text-gray-400 transition hover:border-primary-300/25 hover:bg-primary-400/[0.08] hover:text-primary-200 disabled:opacity-35"
                title={
                  canSavePreset
                    ? 'Save this canvas size for future projects'
                    : 'This canvas size is already saved'
                }
              >
                <Icons.Star className="h-3 w-3" />
                Save preset
              </button>
            </div>
          </div>

          <div className="border-t border-white/[0.07] bg-gray-950/20 p-4">
            <ExecuteButton
              type="submit"
              disabled={!isValid}
              fullWidth
              variant="prominent"
              icon={false}
              trailingIcon={<Icons.ChevronRight className="h-3.5 w-3.5 shrink-0" />}
            >
              <span className="relative min-w-0 flex-1">
                <span className="block text-sm font-semibold text-primary-50 group-disabled/action:text-gray-500">
                  Create project
                </span>
                <span className="mt-0.5 block text-[10px] font-normal text-primary-200/65 group-disabled/action:text-gray-700">
                  Open a blank composition in Studio
                </span>
              </span>
            </ExecuteButton>
          </div>
        </aside>
      </div>
    </form>
  );
}

export default NewProjectView;
